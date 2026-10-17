import sympy as sp

from checker.equiv import RIGHT, UNCHECKED, WRONG, prove_equal, prove_equation

x, y = sp.symbols("x y")


def test_equal_by_simplification():
    assert prove_equal((x + 1) ** 2, x**2 + 2 * x + 1) == RIGHT


def test_equal_trig_identity():
    assert prove_equal(sp.sin(2 * x), 2 * sp.sin(x) * sp.cos(x)) == RIGHT


def test_different_is_disproved():
    assert prove_equal(6 * x + 2, 6 * x + 3) == WRONG


def test_sign_error_is_disproved():
    assert prove_equal(2 * x * sp.cos(x**2), -2 * x * sp.cos(x**2)) == WRONG


def test_constants_compare_numerically():
    assert prove_equal(sp.Integer(8), sp.Integral(3 * x**2, (x, 0, 2))) == RIGHT
    assert prove_equal(sp.Integer(7), sp.Integral(3 * x**2, (x, 0, 2))) == WRONG


def test_undefined_function_is_unchecked():
    f = sp.Function("f")
    assert prove_equal(f(x), 6 * x) == UNCHECKED


def test_no_valid_sample_points_is_unchecked():
    # sqrt(-1 - x^2) is never real, so nothing can be sampled.
    assert prove_equal(sp.sqrt(-1 - x**2), sp.sqrt(-1 - x**2) + sp.sqrt(-2 - x**2)) == UNCHECKED


def test_log_domain_still_finds_points():
    assert prove_equal(sp.log(x**2), 2 * sp.log(x)) in (RIGHT, UNCHECKED)
    assert prove_equal(sp.log(x) + 1, sp.log(x) + 2) == WRONG


def test_equation_same_up_to_constant_multiple():
    assert prove_equation(2 * x + 4, sp.Integer(0), x + 2, sp.Integer(0)) == RIGHT
    assert prove_equation(x**2 + y**2, sp.Integer(25), y**2, 25 - x**2) == RIGHT


def test_equation_different():
    assert prove_equation(2 * x + 4, sp.Integer(0), x + 3, sp.Integer(0)) == WRONG


def test_division_by_zero_is_unchecked_never_wrong():
    from checker.parse import parse_line
    bad = parse_line(r"\frac{1}{0}").value
    assert prove_equal(bad, x) == UNCHECKED
    assert prove_equal(bad, sp.Integer(3)) == UNCHECKED
    assert prove_equal(parse_line(r"\frac{0}{0}").value, sp.Integer(1)) == UNCHECKED


def test_equation_implied_by_solving_is_right():
    # y = sqrt(100 - x^2) is one branch of x^2 + y^2 = 100.
    assert prove_equation(y, sp.sqrt(100 - x**2), x**2 + y**2, sp.Integer(100)) == RIGHT
    # 4/x^2 = 1 and x^2 = 4 have the same solutions but are not constant multiples.
    assert prove_equation(4 / x**2, sp.Integer(1), x**2, sp.Integer(4)) == RIGHT
    dy, dx = sp.symbols("dy_dt dx_dt")
    assert prove_equation(dy, -x / y * dx, 2 * x * dx + 2 * y * dy, sp.Integer(0)) == RIGHT


def test_equation_with_a_value_already_put_in_is_never_wrong():
    r, dV, dr = sp.symbols("r dV_dt dr_dt")
    assert prove_equation(dV, 8 * sp.pi * r**2, dV, 4 * sp.pi * r**2 * dr) == UNCHECKED


def test_equation_with_the_same_unknowns_and_a_different_relation_is_wrong():
    r, dV, dr = sp.symbols("r dV_dt dr_dt")
    assert prove_equation(dV, 4 * sp.pi * r * dr, dV, 4 * sp.pi * r**2 * dr) == WRONG


def test_a_difference_only_for_negative_values_is_not_proof_of_an_error():
    # sqrt(4x^2) is 2x wherever x > 0, which is the domain of most applied questions.
    assert prove_equal(sp.sqrt(4 * x**2), 2 * x) == UNCHECKED
    assert prove_equal(sp.sqrt(x**2 * y**2), x * y) == UNCHECKED
    # Different for positive values too: still wrong.
    assert prove_equal(sp.sqrt(4 * x**2), 3 * x) == WRONG
