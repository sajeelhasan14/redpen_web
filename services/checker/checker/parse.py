"""Student LaTeX to SymPy. Nothing here evaluates student text as code."""
import re
import warnings
from dataclasses import dataclass
from typing import Iterable, List, Optional

import sympy as sp
from sympy.core.function import AppliedUndef
from sympy.parsing.latex import parse_latex

MAX_LEN = 400

ALLOWED_COMMANDS = {
    "frac", "sqrt", "sin", "cos", "tan", "sec", "csc", "cot",
    "arcsin", "arccos", "arctan", "ln", "log", "exp",
    "pi", "theta", "infty", "int", "lim", "to", "cdot", "times",
    "left", "right", "sum", "Delta",
}

_SPACING = re.compile(r"\\[,;:! ]|\\quad|\\qquad")
_COMMAND = re.compile(r"\\([A-Za-z]+)")
_ALLOWED_CHARS = re.compile(r"^[A-Za-z0-9\\{}^_+\-*/=().|'\[\] ]*$")
_INLINE_DIFFERENTIAL = re.compile(r"^d[A-Za-z]$")
# The parser reads "\\int_0^2 3x^2" as an upper limit of 23, and "x^10" as x^1 times 0.
# Bracing every bare subscript and superscript (one letter, or a run of digits)
# removes both ambiguities.
_BARE_SCRIPT = re.compile(r"([_^])\s*(\d+|[A-Za-z])")
MAX_DIGITS = 15
MAX_EXPONENT = 200
# \left and \right only size brackets.
_SIZING = re.compile(r"\\(left|right)(?![A-Za-z])")
_TEXT = re.compile(r"\\text\s*\{[^{}]*\}")
# The parser reads "1/2 x^2" as 1/(2x^2). A fraction of two plain numbers is a coefficient.
# "\\Delta x" is one quantity, not Delta times x.
_DELTA = re.compile(r"\\Delta\s*([A-Za-z])")
_NUMERIC_SLASH = re.compile(r"(?<![\w}.])(\d+)\s*/\s*(\d+)(?![\d.])")


class ParseError(ValueError):
    pass


@dataclass
class ParsedLine:
    """One written line. `sides` are the parts between top-level '=' signs.

    A line that starts with '=' continues the line above, so its first side is None.
    """

    sides: List[Optional[sp.Basic]]
    # True when words were stripped from the line. Its maths can earn a point, but a
    # fragment of a sentence is not a step, so it never takes part in line-to-line checks.
    words: bool = False

    @property
    def value(self) -> sp.Basic:
        return self.sides[-1]

    @property
    def label(self) -> Optional[sp.Basic]:
        return self.sides[0] if len(self.sides) > 1 else None


def split_sides(latex: str) -> List[str]:
    """Split at '=' signs that are not inside braces (so \\sum_{i=1}^{n} survives)."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(latex):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif ch == "=" and depth == 0:
            parts.append(latex[start:i])
            start = i + 1
    parts.append(latex[start:])
    return [p.strip() for p in parts]


def _normalise(expr: sp.Basic, variables: Iterable[str]) -> sp.Basic:
    # The parser reads x(20 - x) as a function x applied to 20 - x. When x is one
    # of the question's variables it is a product.
    # The constants too: 4\pi (3)^2 is a product, not pi applied to 3.
    names = set(variables) | {"pi", "e"}
    product = lambda e: (isinstance(e, AppliedUndef) and len(e.args) == 1
                         and (e.func.__name__ in names or e.func.__name__.startswith("D_{")))
    # x(12 - 2x)^2 arrives as (x applied to 12 - 2x) squared: the power belongs to the bracket only.
    expr = expr.replace(
        lambda e: isinstance(e, sp.Pow) and product(e.base),
        lambda e: sp.Symbol(e.base.func.__name__) * e.base.args[0] ** e.exp,
    )
    expr = expr.replace(product, lambda e: sp.Symbol(e.func.__name__) * e.args[0])
    # y' and V' are the derivative the question declares (dy_dx, dV_dt), when it declares exactly one.
    for s in list(expr.free_symbols):
        if s.name.endswith("'"):
            targets = [v for v in variables if v.startswith("d%s_d" % s.name[:-1])]
            if len(targets) == 1:
                expr = expr.subs(s, sp.Symbol(targets[0]))
    # The parser reads e and pi as plain symbols and \ln x as log(x, E).
    expr = expr.subs({sp.Symbol("e"): sp.E, sp.Symbol("pi"): sp.pi})
    expr = expr.replace(
        lambda e: isinstance(e, sp.log) and len(e.args) == 2,
        lambda e: sp.log(e.args[0]) / sp.log(e.args[1]),
    )
    # dV/dt for a bare symbol V would evaluate to 0. Treat it as one unknown, dV_dt.
    expr = expr.replace(
        lambda e: isinstance(e, sp.Derivative) and isinstance(e.expr, sp.Symbol) and len(e.variables) == 1,
        lambda e: sp.Symbol("d%s_d%s" % (e.expr.name, e.variables[0].name)),
    )
    for s in expr.free_symbols:
        if _INLINE_DIFFERENTIAL.match(s.name):
            raise ParseError("write derivatives as \\frac{dy}{dx}")
    return expr


def _refuse_huge(expr: sp.Basic) -> None:
    """9^{9^{9}} would take minutes and gigabytes to evaluate. No exam answer needs it."""
    # Innermost first, so a tower is refused at its lowest oversized level
    # before anything above it is ever evaluated.
    for node in sp.postorder_traversal(expr):
        if isinstance(node, sp.Integer) and len(str(abs(int(node)))) > MAX_DIGITS:
            raise ParseError("number too large")
        if isinstance(node, sp.Pow) and node.exp.is_number:
            if not node.exp.is_real or _effective_exponent(node) > MAX_EXPONENT:
                raise ParseError("exponent too large")


def _effective_exponent(node: sp.Basic) -> float:
    """((x^200)^200)^200 is x^8000000: nested powers multiply."""
    if isinstance(node, sp.Pow) and node.exp.is_number and node.exp.is_real:
        return abs(float(node.exp)) * max(1.0, _effective_exponent(node.base))
    return 1.0


def _strip_words(src: str):
    """Drops words before the maths ("Let u = ...") and everything from the first
    words after it (units, "so max"). Returns (maths, had_words)."""
    s = src.strip()
    had = False
    while True:
        m = _TEXT.match(s)
        if not m:
            break
        had = True
        s = s[m.end():].lstrip()
    cut = s.find("\\text")
    if cut >= 0:
        had = True
        s = s[:cut]
    return s.strip(), had


def _parse_side(src: str, variables: Iterable[str]) -> sp.Basic:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            expr = parse_latex(src, strict=True, backend="antlr")
        except Exception as err:  # the parser raises several unrelated types
            raise ParseError(str(err)[:120])
    if not isinstance(expr, sp.Expr):
        raise ParseError("not an expression")
    _refuse_huge(expr)
    return _normalise(expr, variables)


def parse_line(latex: str, variables: Iterable[str] = ()) -> ParsedLine:
    if not isinstance(latex, str) or not latex.strip():
        raise ParseError("empty")
    if len(latex) > MAX_LEN:
        raise ParseError("too long")
    variables = list(variables)
    src, words = _strip_words(_SIZING.sub("", _SPACING.sub(" ", latex)))
    if not src:
        raise ParseError("only words")
    src = _DELTA.sub(r"D_{\1}", src)
    src = _NUMERIC_SLASH.sub(r"\\frac{\1}{\2}", _BARE_SCRIPT.sub(r"\1{\2}", src))
    if not _ALLOWED_CHARS.match(src):
        raise ParseError("unsupported character")
    for cmd in _COMMAND.findall(src):
        if cmd not in ALLOWED_COMMANDS:
            raise ParseError("unsupported command \\%s" % cmd)
    parts = split_sides(src)
    sides: List[Optional[sp.Basic]] = []
    for i, part in enumerate(parts):
        if part == "":
            if i == 0 and len(parts) > 1:
                sides.append(None)
                continue
            raise ParseError("empty side")
        sides.append(_parse_side(part, variables))
    return ParsedLine(sides, words)
