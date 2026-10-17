import pytest
import sympy as sp

from checker.parse import ParseError, parse_line, split_sides

x = sp.Symbol("x")


def test_expression_has_one_side():
    line = parse_line(r"3x^2 + 2x")
    assert len(line.sides) == 1
    assert sp.simplify(line.value - (3 * x**2 + 2 * x)) == 0


def test_label_and_value():
    line = parse_line(r"f'(x) = 6x + 2")
    assert len(line.sides) == 2
    assert sp.simplify(line.value - (6 * x + 2)) == 0


def test_chain_takes_last_side_as_value():
    line = parse_line(r"y = 2 \cdot 3x = 6x")
    assert len(line.sides) == 3
    assert sp.simplify(line.value - 6 * x) == 0


def test_leading_equals_continues_previous_line():
    line = parse_line(r"= 6x + 2")
    assert line.sides[0] is None
    assert sp.simplify(line.value - (6 * x + 2)) == 0


def test_e_pi_and_ln_are_the_constants_and_natural_log():
    assert parse_line(r"e^{2x}").value == sp.exp(2 * x)
    assert parse_line(r"2\pi").value == 2 * sp.pi
    assert sp.simplify(parse_line(r"\ln x").value - sp.log(x)) == 0


def test_definite_integral_equation_is_not_collapsed_to_false():
    line = parse_line(r"\int_0^2 3x^2 \, dx = 8")
    assert len(line.sides) == 2
    assert line.sides[0].doit() == 8


def test_equals_inside_braces_is_not_a_split():
    assert split_sides(r"\sum_{i=1}^{n} i = \frac{n(n+1)}{2}") == [r"\sum_{i=1}^{n} i", r"\frac{n(n+1)}{2}"]


def test_derivative_of_bare_symbol_becomes_one_unknown():
    line = parse_line(r"\frac{dV}{dt} = 4\pi r^2 \frac{dr}{dt}")
    assert line.sides[0] == sp.Symbol("dV_dt")
    assert sp.Symbol("dr_dt") in line.value.free_symbols


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "   ",
        r"x = 2, y = 3",
        r"x + ",
        r"2x)",
        r"__import__('os').system('echo PWNED')",
        r"\begin{matrix} 1 \end{matrix}",
        r"x \ge 0",
        r"dV/dt = 3",
        "x" * 401,
        r"x = ",
    ],
)
def test_rejects(bad):
    with pytest.raises(ParseError):
        parse_line(bad)


def test_bare_limits_are_not_glued_to_the_integrand():
    line = parse_line(r"\int_0^2 3x^2 \, dx")
    assert line.value.doit() == 8
    assert parse_line(r"\int_1^3 2x \, dx").value.doit() == 8
    assert sp.simplify(parse_line(r"x^2 3").value - 3 * x**2) == 0


def test_variable_times_bracket_is_a_product_not_a_function_call():
    line = parse_line(r"A = x(20 - x)", ["x"])
    assert sp.simplify(line.value - x * (20 - x)) == 0
    line = parse_line(r"2x(x-1) - (x^2+1)", ["x"])
    assert sp.simplify(line.value - (x**2 - 2 * x - 1)) == 0


def test_function_label_is_left_alone():
    line = parse_line(r"f(x) = x(x - 1)", ["x"])
    assert line.sides[0].func.__name__ == "f"


def test_power_after_variable_times_bracket_binds_to_the_bracket():
    line = parse_line(r"V = x(12 - 2x)^2", ["x"])
    assert sp.simplify(line.value - x * (12 - 2 * x) ** 2) == 0


def test_multi_digit_exponent_without_braces_is_read_whole():
    assert sp.simplify(parse_line(r"x^10").value - x**10) == 0
    assert parse_line(r"\int_0^12 1 \, dx").value.doit() == 12


@pytest.mark.parametrize("huge", [r"9^{9^{9}}", r"9^{9^{9^{9}}}", r"2^{100000}", r"x^{1000}", "1" * 16, r"e^{9^{9}}", r"((x^{200})^{200})^{200}", r"(x^{20})^{20}"])
def test_refuses_numbers_that_would_stall_the_checker(huge):
    with pytest.raises(ParseError):
        parse_line(huge)


def test_ordinary_powers_are_fine():
    assert parse_line(r"2^{10}").value.doit() == 1024
    assert parse_line(r"x^{-2}").value == x**-2
    assert parse_line(r"e^{-x^{2}}").value == sp.exp(-x**2)
    assert sp.simplify(parse_line(r"x^{\frac{1}{2}}").value - sp.sqrt(x)) == 0


def test_pi_or_e_before_a_bracket_is_a_product_not_a_function_call():
    assert sp.simplify(parse_line(r"4\pi (3)^{2} (2)").value - 72 * sp.pi) == 0
    assert sp.simplify(parse_line(r"2\pi(5)(3)").value - 30 * sp.pi) == 0
    assert sp.simplify(parse_line(r"e(x + 1)").value - sp.E * (x + 1)) == 0


def test_numeric_slash_fraction_is_a_coefficient_not_a_denominator():
    assert sp.simplify(parse_line(r"1/2 x^{2}").value - x**2 / 2) == 0
    assert sp.simplify(parse_line(r"1/12 (x^{2}+1)^{6} + C").value - ((x**2 + 1) ** 6 / 12 + sp.Symbol("C"))) == 0
    assert sp.simplify(parse_line(r"x^{3}/3").value - x**3 / 3) == 0


def test_words_around_the_maths_are_dropped():
    line = parse_line(r"\text{Let } u = x^{2}")
    assert line.sides[0] == sp.Symbol("u") and sp.simplify(line.value - x**2) == 0
    assert sp.simplify(parse_line(r"= 72\pi \text{ cm}^{3}/\text{s}").value - 72 * sp.pi) == 0
    assert parse_line(r"x = 2 \text{ so max}").value == 2


def test_a_line_of_only_words_is_still_refused():
    for words in (r"\text{sixteen}", r"\text{left limit equals right limit at } x = 1 \text{ too}"[:14] + "}"):
        with pytest.raises(ParseError):
            parse_line(words)


def test_sizing_brackets_are_ignored():
    assert parse_line(r"\left(16 + 4\right) - \left(1 + 2\right)").value.doit() == 17


def test_prime_notation_maps_to_the_declared_derivative():
    line = parse_line(r"V' = 4\pi r^{2} r'", ["r", "t", "dV_dt", "dr_dt"])
    assert line.sides[0] == sp.Symbol("dV_dt")
    assert sp.Symbol("dr_dt") in line.value.free_symbols
    implicit = parse_line(r"2x + 2yy' = 0", ["x", "y", "dy_dx"])
    assert sp.simplify(implicit.sides[0] - (2 * x + 2 * sp.Symbol("y") * sp.Symbol("dy_dx"))) == 0
    # With no declared derivative to map to, the primed symbol is left alone.
    assert parse_line(r"A' = 20 - 2x", ["x"]).sides[0] == sp.Symbol("A'")


def test_delta_x_is_one_symbol():
    line = parse_line(r"\Delta x = \frac{1}{2}", ["x"])
    assert isinstance(line.sides[0], sp.Symbol)
    assert sp.simplify(parse_line(r"\Delta x (1 + 3)", ["x"]).value - 4 * line.sides[0]) == 0
