"""Prove two expressions equal, prove them different, or admit neither."""
import random
from typing import Dict, List, Optional

import sympy as sp
from sympy.core.function import AppliedUndef

RIGHT, WRONG, UNCHECKED = "right", "wrong", "unchecked"
NEEDED = 8
ATTEMPTS = 60
TOL = 1e-8


def evaluate(expr: sp.Basic) -> sp.Basic:
    """Carry out any unevaluated derivative, integral or limit."""
    return expr.doit()


def _number(expr: sp.Basic, point: Dict[sp.Symbol, sp.Rational]) -> Optional[float]:
    try:
        v = sp.N(expr.subs(point), 30)
    except Exception:
        return None
    if not v.is_number or not v.is_finite or not v.is_real:
        return None
    return float(v)


def _points(symbols: List[sp.Symbol], seed: int, positive: bool = False):
    rng = random.Random(seed)
    low = 1 if positive else -40
    for _ in range(ATTEMPTS):
        yield {s: sp.Rational(rng.randint(low, 40), 8) for s in symbols}


def _differs_for_positive_values(a: sp.Basic, b: sp.Basic, symbols: List[sp.Symbol], seed: int) -> bool:
    """True when the two sides also differ with every symbol positive."""
    seen = 0
    for point in _points(symbols, seed, positive=True):
        va, vb = _number(a, point), _number(b, point)
        if va is None or vb is None:
            continue
        if not _close(va, vb):
            return True
        seen += 1
        if seen >= NEEDED:
            break
    return False


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= TOL * max(1.0, abs(a), abs(b))


def prove_equal(a: sp.Basic, b: sp.Basic, seed: int = 0) -> str:
    a, b = evaluate(a), evaluate(b)
    if a.atoms(AppliedUndef) or b.atoms(AppliedUndef):
        return UNCHECKED
    try:
        if sp.simplify(a - b) == 0:
            return RIGHT
    except Exception:
        pass
    symbols = sorted(a.free_symbols | b.free_symbols, key=lambda s: s.name)
    if not symbols:
        va, vb = _number(a, {}), _number(b, {})
        if va is None or vb is None:
            return UNCHECKED
        return RIGHT if _close(va, vb) else WRONG
    agree = differ = 0
    for point in _points(symbols, seed):
        va, vb = _number(a, point), _number(b, point)
        if va is None or vb is None:
            continue
        if _close(va, vb):
            agree += 1
        else:
            differ += 1
        if agree + differ >= NEEDED:
            break
    if differ >= 2:
        # sqrt(4x^2) and 2x differ only where x is negative. Lengths, radii and times
        # are positive, so a difference confined to negative values proves nothing.
        return WRONG if _differs_for_positive_values(a, b, symbols, seed) else UNCHECKED
    if differ == 0 and agree >= NEEDED:
        return RIGHT
    return UNCHECKED


def forms(expr: sp.Basic) -> List[sp.Basic]:
    """An unevaluated limit or integral, and the expression inside it. Students
    drop and restore the operator from line to line; either reading may match."""
    if isinstance(expr, sp.Limit):
        return [expr, expr.args[0]]
    if isinstance(expr, sp.Integral):
        return [expr, expr.function]
    return [expr]


def prove_any(a: sp.Basic, b: sp.Basic) -> str:
    """Right if any reading of a equals any reading of b; wrong only if every pairing is disproved."""
    results = [prove_equal(x, y) for x in forms(a) for y in forms(b)]
    if RIGHT in results:
        return RIGHT
    return WRONG if all(r == WRONG for r in results) else UNCHECKED


def _constant_multiple(f: sp.Basic, g: sp.Basic, symbols: List[sp.Symbol], seed: int) -> bool:
    ratios: List[float] = []
    for point in _points(symbols, seed):
        vf, vg = _number(f, point), _number(g, point)
        if vf is None or vg is None:
            continue
        if abs(vf) < TOL and abs(vg) < TOL:
            continue
        if abs(vf) < TOL or abs(vg) < TOL:
            return False
        ratios.append(vf / vg)
        if len(ratios) >= NEEDED:
            break
    return len(ratios) >= NEEDED and all(_close(r, ratios[0]) for r in ratios[1:])


def _implied(f: sp.Basic, g: sp.Basic, prefer: Optional[sp.Symbol]) -> str:
    """Solve f = 0 for one unknown and put each solution into g. RIGHT when every
    solution satisfies g = 0, WRONG when none does."""
    symbols = sorted(f.free_symbols, key=lambda s: s.name)
    if prefer is not None and prefer in f.free_symbols:
        symbols = [prefer] + [s for s in symbols if s != prefer]
    for s in symbols[:3]:
        try:
            solutions = sp.solve(f, s)
        except Exception:
            continue
        if not solutions:
            continue
        results = [prove_equal(g.subs(s, sol), sp.Integer(0)) for sol in solutions]
        if all(r == RIGHT for r in results):
            return RIGHT
        if all(r == WRONG for r in results):
            return WRONG
        return UNCHECKED
    return UNCHECKED


def prove_equation(l1: sp.Basic, r1: sp.Basic, l2: sp.Basic, r2: sp.Basic, seed: int = 0) -> str:
    """Is the student's equation (l1 = r1) the expected one (l2 = r2)?

    RIGHT when one is a non-zero constant multiple of the other, or when solving the
    student's equation gives values that satisfy the expected one (so a solved or
    rearranged form counts). WRONG only when the student's solutions fail the
    expected equation AND both mention the same unknowns: an equation with fewer
    unknowns may have had a given value put in early, which is not an error.
    """
    f, g = evaluate(l1 - r1), evaluate(l2 - r2)
    if f.atoms(AppliedUndef) or g.atoms(AppliedUndef):
        return UNCHECKED
    symbols = sorted(f.free_symbols | g.free_symbols, key=lambda s: s.name)
    if not symbols:
        return UNCHECKED
    if _constant_multiple(f, g, symbols, seed):
        return RIGHT
    implied = _implied(f, g, l1 if isinstance(l1, sp.Symbol) else None)
    if implied == RIGHT:
        return RIGHT
    if implied == WRONG and f.free_symbols == g.free_symbols:
        return WRONG
    return UNCHECKED
