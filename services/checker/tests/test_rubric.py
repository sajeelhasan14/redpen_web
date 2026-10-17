import sympy as sp

from checker.equiv import RIGHT, UNCHECKED, WRONG
from checker.parse import parse_line
from checker.rubric import check_points, eval_expected, materially_easier, references

x = sp.Symbol("x")
guard = lambda fn: fn()

# Differentiate f(x) = x^3 + x^2, then give f'(2).
POINTS = [
    {"id": "P1", "type": "equivalent", "expected": "diff(x**3 + x**2, x)", "followThrough": False, "line": 1},
    {"id": "P2", "type": "exact_value", "expected": "({P1}).subs(x, 2)", "followThrough": True, "line": 2},
]


def run(l1, l2, points=POINTS):
    lines = {}
    if l1:
        lines[1] = parse_line(l1)
    if l2:
        lines[2] = parse_line(l2)
    results, _ = check_points(points, lines, "x", ["x"], guard)
    return {r["id"]: r for r in results}


def test_references_and_expected():
    assert references("({P1}).subs(x, 2) + {P2}") == ["P1", "P2"]
    assert eval_expected("({P1}).subs(x, 2)", ["x"], {"P1": 3 * x**2}) == 12


def test_all_right():
    r = run(r"f'(x) = 3x^2 + 2x", r"f'(2) = 16")
    assert r["P1"]["outcome"] == RIGHT and r["P2"]["outcome"] == RIGHT
    assert r["P2"]["ftOutcome"] is None


def test_follow_through_from_students_wrong_value():
    r = run(r"f'(x) = 3x^2 + x", r"f'(2) = 14")
    assert r["P1"]["outcome"] == WRONG
    assert r["P2"]["outcome"] == WRONG
    assert r["P2"]["ftOutcome"] == RIGHT
    assert r["P2"]["ftRefused"] is False


def test_follow_through_wrong_twice():
    r = run(r"f'(x) = 3x^2 + x", r"f'(2) = 15")
    assert r["P2"]["outcome"] == WRONG and r["P2"]["ftOutcome"] == WRONG


def test_follow_through_refused_when_materially_easier():
    r = run(r"f'(x) = 5", r"f'(2) = 5")
    assert r["P2"]["ftOutcome"] == RIGHT and r["P2"]["ftRefused"] is True


def test_unattempted_point_is_unchecked_with_no_follow_through():
    r = run(r"f'(x) = 3x^2 + 2x", None)
    assert r["P2"]["outcome"] == UNCHECKED and r["P2"]["ftOutcome"] is None


def test_materially_easier():
    assert materially_easier(sp.Integer(5), 3 * x**2 + 2 * x, [x]) is True
    assert materially_easier(3 * x**2 + x, 3 * x**2 + 2 * x, [x]) is False


def test_antiderivative_flags_missing_constant():
    pts = [{"id": "P1", "type": "antiderivative", "expected": "2*x", "followThrough": False, "requireConstant": True, "line": 1}]
    assert run(r"x^2 + C", None, pts)["P1"] == {"id": "P1", "outcome": RIGHT, "ftOutcome": None, "ftRefused": False, "note": None, "line": 1}
    assert run(r"x^2", None, pts)["P1"]["note"] == "missing_constant"
    assert run(r"2x^2 + C", None, pts)["P1"]["outcome"] == WRONG


def test_exact_value_decimal_is_inexact_not_wrong():
    pts = [{"id": "P1", "type": "exact_value", "expected": "Rational(1, 3)", "followThrough": False, "line": 1}]
    assert run(r"\frac{1}{3}", None, pts)["P1"]["outcome"] == RIGHT
    got = run(r"0.333", None, pts)["P1"]
    assert got["outcome"] == UNCHECKED and got["note"] == "inexact"
    assert run(r"0.5", None, pts)["P1"]["outcome"] == WRONG


def test_equation_point():
    pts = [{"id": "P1", "type": "equation", "expected": "Eq(dV_dt, 4*pi*r**2*dr_dt)", "followThrough": False, "line": 1}]
    lines = {1: parse_line(r"\frac{dV}{dt} = 4\pi r^2 \frac{dr}{dt}")}
    results, _ = check_points(pts, lines, "t", ["r", "t", "dV_dt", "dr_dt"], guard)
    assert results[0]["outcome"] == RIGHT
    lines = {1: parse_line(r"\frac{dV}{dt} = 4\pi r \frac{dr}{dt}")}
    results, _ = check_points(pts, lines, "t", ["r", "t", "dV_dt", "dr_dt"], guard)
    assert results[0]["outcome"] == WRONG


def test_antiderivative_without_require_constant_never_flags():
    pts = [{"id": "P1", "type": "antiderivative", "expected": "2*x", "followThrough": False, "line": 1}]
    assert run(r"x^2", None, pts)["P1"]["note"] is None


def test_exact_decimal_earns_the_point():
    pts = [{"id": "P1", "type": "exact_value", "expected": "Rational(15, 4)", "followThrough": False, "line": 1}]
    assert run(r"3.75", None, pts)["P1"]["outcome"] == RIGHT


def test_equivalent_matches_inside_a_limit_or_integral():
    pts = [{"id": "P1", "type": "equivalent", "expected": "x + 2", "followThrough": False, "line": 1}]
    assert run(r"\lim_{x \to 2} (x + 2)", None, pts)["P1"]["outcome"] == RIGHT
    pts = [{"id": "P1", "type": "equivalent", "expected": "cos(u)", "followThrough": False, "line": 1}]
    lines = {1: parse_line(r"\int \cos u \, du")}
    results, _ = check_points(pts, lines, "x", ["x", "u"], guard)
    assert results[0]["outcome"] == RIGHT


def test_follow_through_carries_the_expression_inside_a_limit():
    pts = [
        {"id": "P1", "type": "equivalent", "expected": "x + 2", "followThrough": False, "line": 1},
        {"id": "P2", "type": "exact_value", "expected": "limit({P1}, x, 2)", "followThrough": True, "line": 2},
    ]
    r = run(r"\lim_{x \to 2} (x - 2)", r"0", pts)
    assert r["P1"]["outcome"] == WRONG
    assert r["P2"]["ftOutcome"] == RIGHT and r["P2"]["ftRefused"] is False


def test_a_constant_of_integration_under_any_name_counts():
    pts = [{"id": "P1", "type": "antiderivative", "expected": "2*x", "followThrough": False, "requireConstant": True, "line": 1}]
    for written in (r"x^2 + c", r"x^2 + K", r"x^2 + C_1"):
        got = run(written, None, pts)["P1"]
        assert got["outcome"] == RIGHT and got["note"] is None, written


def points_on(lines_latex, pts, variable, variables):
    lines = {i + 1: parse_line(l, variables) for i, l in enumerate(lines_latex)}
    results, _ = check_points(pts, lines, variable, variables, guard)
    return {r["id"]: r for r in results}


SPHERE = [{"id": "P1", "type": "equation", "expected": "Eq(dV_dt, 4*pi*r**2*dr_dt)", "followThrough": False, "line": 1}]
SPHERE_VARS = ["r", "t", "dV_dt", "dr_dt"]


def test_equation_point_accepts_prime_notation():
    assert points_on([r"V' = 4\pi r^{2} r'"], SPHERE, "t", SPHERE_VARS)["P1"]["outcome"] == RIGHT
    implicit = [{"id": "P1", "type": "equation", "expected": "Eq(2*x + 2*y*dy_dx, 0)", "followThrough": False, "line": 1}]
    assert points_on([r"2x + 2yy' = 0"], implicit, "x", ["x", "y", "dy_dx"])["P1"]["outcome"] == RIGHT
    assert points_on([r"\frac{dy}{dx} = -\frac{x}{y}"], implicit, "x", ["x", "y", "dy_dx"])["P1"]["outcome"] == RIGHT


def test_equation_point_with_a_value_put_in_early_is_unchecked_not_wrong():
    assert points_on([r"\frac{dV}{dt} = 4\pi r^{2} \cdot 2"], SPHERE, "t", SPHERE_VARS)["P1"]["outcome"] == UNCHECKED
    assert points_on([r"\frac{dV}{dt} = 4\pi r \frac{dr}{dt}"], SPHERE, "t", SPHERE_VARS)["P1"]["outcome"] == WRONG


def test_equation_point_accepts_a_solved_form():
    ladder = [
        {"id": "P1", "type": "equation", "expected": "Eq(x**2 + y**2, 100)", "followThrough": False, "line": 1},
        {"id": "P2", "type": "equation", "expected": "Eq(2*x*dx_dt + 2*y*dy_dt, 0)", "followThrough": False, "line": 2},
    ]
    r = points_on([r"y = \sqrt{100 - x^{2}}", r"\frac{dy}{dt} = -\frac{x}{y}\frac{dx}{dt}"], ladder, "t", ["x", "y", "t", "dx_dt", "dy_dt"])
    assert r["P1"]["outcome"] == RIGHT and r["P2"]["outcome"] == RIGHT


def test_exact_value_on_a_formula_or_an_equation_is_unchecked_not_wrong():
    half = [{"id": "P1", "type": "exact_value", "expected": "Rational(1, 2)", "followThrough": False, "line": 1}]
    assert points_on([r"\Delta x = \frac{b - a}{n}"], half, "x", ["x"])["P1"]["outcome"] == UNCHECKED
    ten = [{"id": "P1", "type": "exact_value", "expected": "10", "followThrough": False, "line": 1}]
    assert points_on([r"20 - 2x = 0"], ten, "x", ["x"])["P1"]["outcome"] == UNCHECKED


def test_a_point_is_looked_for_on_the_lines_after_the_matched_one():
    half = [{"id": "P1", "type": "exact_value", "expected": "Rational(1, 2)", "followThrough": False, "line": 1}]
    got = points_on([r"\Delta x = \frac{b - a}{n}", r"= \frac{2 - 0}{4} = \frac{1}{2}"], half, "x", ["x"])["P1"]
    assert got["outcome"] == RIGHT and got["line"] == 2
    ten = [{"id": "P1", "type": "exact_value", "expected": "10", "followThrough": False, "line": 1}]
    got = points_on([r"20 - 2x = 0", r"x = 10"], ten, "x", ["x"])["P1"]
    assert got["outcome"] == RIGHT and got["line"] == 2
    # Nothing later is right: the result stays on the matched line.
    got = points_on([r"x = 9", r"x = 8"], ten, "x", ["x"])["P1"]
    assert got["outcome"] == WRONG and got["line"] == 1


def test_the_constant_may_arrive_on_a_later_line():
    pts = [{"id": "P1", "type": "antiderivative", "expected": "2*x*cos(x**2)", "followThrough": False, "requireConstant": True, "line": 1}]
    got = points_on([r"\sin(x^{2})", r"= \sin(x^{2}) + C"], pts, "x", ["x"])["P1"]
    assert got["outcome"] == RIGHT and got["note"] is None and got["line"] == 2
    got = points_on([r"\sin(x^{2})"], pts, "x", ["x"])["P1"]
    assert got["note"] == "missing_constant" and got["line"] == 1


def test_exact_value_after_an_arithmetic_or_delta_label_is_checked():
    four = [{"id": "P1", "type": "exact_value", "expected": "4", "followThrough": False, "line": 1}]
    assert points_on([r"\frac{9 - 1}{3 - 1} = 4"], four, "x", ["x"])["P1"]["outcome"] == RIGHT
    assert points_on([r"\frac{9 - 1}{3 - 1} = 5"], four, "x", ["x"])["P1"]["outcome"] == WRONG
    half = [{"id": "P1", "type": "exact_value", "expected": "Rational(1, 2)", "followThrough": False, "line": 1}]
    assert points_on([r"\Delta x = \frac{1}{2}"], half, "x", ["x"])["P1"]["outcome"] == RIGHT
    assert points_on([r"\Delta x = 0.5"], half, "x", ["x"])["P1"]["outcome"] == RIGHT
