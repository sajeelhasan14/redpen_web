"""Does a line follow from the line before it?

A step is called wrong only when the line claims to follow from the one above and
provably does not. A line may instead state something new (a given value, a
condition, a second quantity), so most disagreements are "unchecked", not "wrong".
"""
from typing import List, Optional

import sympy as sp
from sympy.core.function import AppliedUndef

from .equiv import RIGHT, UNCHECKED, WRONG, evaluate, prove_any, prove_equal, prove_equation
from .parse import ParsedLine

KINDS = ("rewrite", "differentiate", "integrate", "take_limit", "substitute", "evaluate", "unknown")
DECIMAL_TOLERANCE = 0.005


def _implicit(line: ParsedLine) -> bool:
    """True for work the line-to-line derivative check cannot follow: a derivative
    written as an unknown (dy_dx), or a real equation rather than a labelled value."""
    if any(s.name.startswith("d") and "_d" in s.name for s in line.value.free_symbols):
        return True
    label = line.label
    return label is not None and not isinstance(label, (sp.Symbol, AppliedUndef))


def _name(label: sp.Basic) -> Optional[str]:
    if isinstance(label, sp.Symbol):
        return label.name
    if isinstance(label, AppliedUndef):
        return label.func.__name__
    return None


def _claims_to_follow(kind: str, prev: ParsedLine, cur: ParsedLine) -> bool:
    """Can a disagreement between these two lines be an error? Only when the second
    is about the same thing as the first: an unlabelled or "= ..." line, the same
    label, or (for a derivative or integral step) the matching label, y then y'."""
    a, b = prev.label, cur.label
    if a is None or b is None:
        return True
    na, nb = _name(a), _name(b)
    if na is None or nb is None:
        return False  # one of them is a real equation, which may state a new fact
    if kind in ("differentiate", "integrate"):
        low, high = (na, nb) if kind == "differentiate" else (nb, na)
        return high == low + "'" or high.startswith("d%s_d" % low)
    if kind == "substitute":
        return na == nb  # f'(x) then f'(2)
    return a == b


def _only_a_constant_apart(prev: sp.Basic, cur: sp.Basic, declared: List[sp.Symbol]) -> bool:
    """"sin(x^2)" then "= sin(x^2) + C": the constant arriving a line late is not an error."""
    try:
        d = sp.simplify(evaluate(cur) - evaluate(prev))
    except Exception:
        return False
    return bool(d.free_symbols) and not (d.free_symbols & set(declared))


def _rounded(prev: sp.Basic, cur: sp.Basic) -> bool:
    """"30 pi" then "94.2": a decimal close to the exact value is rounding, not an error."""
    a, b = evaluate(prev), evaluate(cur)
    if a.free_symbols or b.free_symbols or not (a.atoms(sp.Float) or b.atoms(sp.Float)):
        return False
    try:
        x, y = float(sp.N(a)), float(sp.N(b))
    except Exception:
        return False
    return abs(x - y) <= DECIMAL_TOLERANCE * max(1.0, abs(x))


def _rewrite(prev: ParsedLine, cur: ParsedLine, declared: List[sp.Symbol]) -> str:
    by_value = prove_any(prev.value, cur.value)
    if by_value == RIGHT:
        return RIGHT
    both_equations = len(prev.sides) == 2 and len(cur.sides) == 2 and prev.label is not None and cur.label is not None
    if both_equations and prev.label != cur.label:
        # "x = -2" after "2x + 4 = 0", or "x^2 = 4" after "4/x^2 = 1". These can be
        # proven right, never wrong: the new equation may state a new fact.
        if isinstance(cur.label, sp.Symbol) and cur.label not in cur.value.free_symbols:
            at = {cur.label: cur.value}
            if prove_equal(prev.label.subs(at), prev.value.subs(at)) == RIGHT:
                return RIGHT
        if prove_equation(cur.label, cur.value, prev.label, prev.value) == RIGHT:
            return RIGHT
        return UNCHECKED
    if by_value == WRONG:
        # "x + 2" followed by "4" may be a limit or a substitution the student did
        # not write out. A bare number after an expression is never proof of an error.
        if prev.value.free_symbols and not cur.value.free_symbols:
            return UNCHECKED
        if _only_a_constant_apart(prev.value, cur.value, declared) or _rounded(prev.value, cur.value):
            return UNCHECKED
    return by_value


_FALLBACKS = ("rewrite", "differentiate", "integrate", "take_limit")


def check_transition(kind: str, prev: ParsedLine, cur: ParsedLine, variable: sp.Symbol,
                     substitution: Optional[dict] = None, declared: Optional[List[sp.Symbol]] = None) -> str:
    """The matcher's label for a step is a model's guess. Before a step is called
    wrong, every other kind of step is tried; any that is proven right wins."""
    declared = declared if declared is not None else [variable]
    outcome = _check(kind, prev, cur, variable, substitution, declared)
    if outcome == RIGHT:
        return RIGHT
    for other in _FALLBACKS:
        if other == kind:
            continue
        # A constant differentiates to 0 and any constant integrates 0, so these two
        # readings prove nothing unless the variable is really there.
        if other == "differentiate" and variable not in prev.value.free_symbols:
            continue
        if other == "integrate" and variable not in cur.value.free_symbols:
            continue
        if _check(other, prev, cur, variable, substitution, declared) == RIGHT:
            return RIGHT
    if outcome == WRONG and not _claims_to_follow(kind, prev, cur):
        return UNCHECKED
    return outcome


def _check(kind: str, prev: ParsedLine, cur: ParsedLine, variable: sp.Symbol,
           substitution: Optional[dict], declared: List[sp.Symbol]) -> str:
    if kind in ("rewrite", "evaluate"):
        return _rewrite(prev, cur, declared)
    if kind == "differentiate":
        if _implicit(prev) or _implicit(cur) or (prev.value.free_symbols - {variable}):
            return UNCHECKED
        return prove_equal(sp.diff(prev.value, variable), cur.value)
    if kind == "integrate":
        if isinstance(prev.value, sp.Integral):
            # Differentiate by the integral's own variable: after a substitution that is u, not x.
            own = prev.value.variables[0]
            by_integrand = prove_equal(sp.diff(cur.value, own), prev.value.function)
            definite = len(prev.value.limits[0]) == 3
            if by_integrand == RIGHT or not definite:
                return by_integrand
            # A definite integral may also be followed directly by its value.
            return prove_equal(prev.value, cur.value)
        return prove_equal(sp.diff(cur.value, variable), prev.value)
    if kind == "take_limit":
        if not prev.value.has(sp.Limit):
            return UNCHECKED
        return prove_equal(prev.value, cur.value)
    if kind == "substitute":
        if not substitution:
            return UNCHECKED
        return prove_equal(prev.value.subs(substitution), cur.value)
    return UNCHECKED
