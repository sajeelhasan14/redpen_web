"""Rubric point checks, including follow-through from the student's own values."""
import re
from typing import Dict, List, Optional

import sympy as sp

from .equiv import RIGHT, UNCHECKED, WRONG, evaluate, forms, prove_any, prove_equal, prove_equation
from sympy.core.function import AppliedUndef

from .parse import ParsedLine

TYPES = ("equivalent", "equation", "antiderivative", "exact_value")
MAX_SCAN = 6
_REF = re.compile(r"\{(P\d+)\}")

# Names a rubric author may use in `expected`. Rubrics are our own content and are trusted.
_NAMES = {
    name: getattr(sp, name)
    for name in (
        "diff", "integrate", "limit", "solve", "simplify", "expand", "factor", "sqrt", "sin", "cos", "tan",
        "sec", "csc", "cot", "asin", "acos", "atan", "exp", "log", "pi", "E", "oo", "Rational", "Abs", "Eq", "Symbol",
        "Limit", "Integral", "Derivative",
    )
}
_NAMES["ln"] = sp.log


def references(template: str) -> List[str]:
    return _REF.findall(template)


def eval_expected(template: str, variables: List[str], values: Dict[str, sp.Basic]) -> sp.Basic:
    names = dict(_NAMES)
    names.update({v: sp.Symbol(v) for v in variables})
    names.update(values)
    return sp.sympify(_REF.sub(r"\1", template), locals=names)


def materially_easier(student: sp.Basic, correct: sp.Basic, variables: List[sp.Symbol]) -> bool:
    """True when the student's wrong value makes the rest of the problem much simpler."""
    vs = set(variables)
    if (correct.free_symbols & vs) and not (student.free_symbols & vs):
        return True
    return sp.count_ops(student) < 0.5 * sp.count_ops(correct)


def compare(kind: str, line: ParsedLine, expected: sp.Basic, variable: sp.Symbol, declared: List[sp.Symbol],
            require_constant: bool = False):
    """Returns (outcome, note)."""
    if kind == "equivalent":
        return prove_any(line.value, expected), None
    if kind == "equation":
        if len(line.sides) < 2 or line.sides[-2] is None or not isinstance(expected, sp.Equality):
            return UNCHECKED, None
        return prove_equation(line.sides[-2], line.value, expected.lhs, expected.rhs), None
    if kind == "antiderivative":
        outcome = prove_equal(sp.diff(line.value, variable), expected)
        has_constant = bool(line.value.free_symbols - set(declared))
        return outcome, ("missing_constant" if require_constant and outcome == RIGHT and not has_constant else None)
    if kind == "exact_value":
        # A formula ("delta x = (b - a)/n") or an equation still to be solved
        # ("20 - 2x = 0") is not a value yet. It is not a wrong value either.
        label = line.label
        if label is not None and label.free_symbols and not isinstance(label, (sp.Symbol, AppliedUndef)):
            return UNCHECKED, None
        value = evaluate(line.value)
        if value.free_symbols:
            return UNCHECKED, None
        if value.atoms(sp.Float):
            # 3.75 is exactly 15/4 and earns the point; 0.333 for 1/3 is only close.
            if prove_equal(sp.nsimplify(value, rational=True), expected) == RIGHT:
                return RIGHT, None
            try:
                got, want = float(sp.N(value)), float(sp.N(evaluate(expected)))
            except Exception:
                return UNCHECKED, None
            if abs(got - want) <= 0.005 * max(1.0, abs(want)):
                return UNCHECKED, "inexact"
            return WRONG, None
        return prove_equal(value, expected), None
    return UNCHECKED, None


def correct_value(kind: str, expected: sp.Basic, variable: sp.Symbol) -> sp.Basic:
    """What a later point sees as this point's value when the student got it right."""
    if kind == "antiderivative":
        return sp.integrate(expected, variable)
    if kind == "equation" and isinstance(expected, sp.Equality):
        return expected.rhs
    return expected


def check_points(points: List[dict], lines: Dict[int, ParsedLine], variable: str, variables: List[str], guard):
    """`guard(fn)` runs fn under the per-check time limit and returns None on timeout or error."""
    var = sp.Symbol(variable)
    declared = [sp.Symbol(v) for v in variables]
    correct: Dict[str, sp.Basic] = {}
    student: Dict[str, sp.Basic] = {}
    outcomes: Dict[str, str] = {}
    results = []
    for p in points:
        pid, kind, template = p["id"], p["type"], p["expected"]
        start = p.get("line") if p.get("line") in lines else None
        line: Optional[ParsedLine] = lines.get(start) if start is not None else None
        result = {"id": pid, "outcome": UNCHECKED, "ftOutcome": None, "ftRefused": False, "note": None, "line": start}
        expected = guard(lambda: eval_expected(template, variables, correct))
        if expected is not None:
            value = guard(lambda: correct_value(kind, expected, var))
            if value is not None:
                correct[pid] = value
        if line is not None and expected is not None:
            # The matcher names the first line that attempts the point. The result may
            # be finished a line or two later (the numbers put in, the +C added), so the
            # lines after it are tried too; the first one proven right wins.
            best = None
            for n in [k for k in sorted(lines) if k >= start][:MAX_SCAN]:
                got = guard(lambda: compare(kind, lines[n], expected, var, declared, bool(p.get("requireConstant"))))
                if n == start and got is not None:
                    result["outcome"], result["note"] = got
                if got is not None and got[0] == RIGHT:
                    if got[1] is None:
                        best = (n, got)
                        break
                    best = best or (n, got)
            if best is not None:
                result["line"], (result["outcome"], result["note"]) = best
                line = lines[best[0]]
            # Carry the expression itself, not the limit or integral sign around it.
            student[pid] = forms(line.value)[-1]
            if result["outcome"] != RIGHT and p.get("followThrough"):
                deps = [d for d in references(template) if d in student and outcomes.get(d) != RIGHT]
                if deps and all(d in correct for d in references(template)):
                    carried = dict(correct)
                    carried.update({d: student[d] for d in deps})
                    ft_expected = guard(lambda: eval_expected(template, variables, carried))
                    if ft_expected is not None:
                        ft = guard(lambda: compare(kind, line, ft_expected, var, declared))
                        result["ftOutcome"] = ft[0] if ft is not None else UNCHECKED
                    else:
                        result["ftOutcome"] = UNCHECKED
                    easier = guard(lambda: any(materially_easier(student[d], correct[d], declared) for d in deps))
                    result["ftRefused"] = bool(easier)
        outcomes[pid] = result["outcome"]
        results.append(result)
    return results, correct
