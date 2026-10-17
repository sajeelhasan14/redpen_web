import sympy as sp

from checker.equiv import RIGHT, UNCHECKED, WRONG
from checker.parse import parse_line
from checker.transitions import check_transition

x = sp.Symbol("x")


def t(kind, prev, cur, sub=None):
    return check_transition(kind, parse_line(prev, ["x"]), parse_line(cur, ["x"]), x, sub, [x])


def test_rewrite_same_label():
    assert t("rewrite", r"y = (x+1)^2", r"y = x^2 + 2x + 1") == RIGHT
    assert t("rewrite", r"y = (x+1)^2", r"y = x^2 + 2x + 2") == WRONG


def test_rewrite_continuation_line():
    assert t("rewrite", r"f'(x) = 2 \cdot 3x", r"= 6x") == RIGHT


def test_rewrite_solving_an_equation():
    assert t("rewrite", r"2x + 4 = 0", r"x = -2") == RIGHT
    assert t("rewrite", r"x^2 = 4", r"x = 2") == RIGHT
    assert t("rewrite", r"\frac{4}{x^{2}} = 1", r"x^{2} = 4") == RIGHT
    assert t("rewrite", r"3x - 6 = 2x + 5", r"3x - 2x = 5 + 6") == RIGHT


def test_a_new_equation_is_never_proof_of_an_error():
    # The line may state a new fact (a given value, a condition) rather than follow from the one above.
    assert t("rewrite", r"2x + 4 = 0", r"x = 2") == UNCHECKED
    assert t("rewrite", r"3x - 6 = 2x + 5", r"3x - 2x = 5 - 6") == UNCHECKED
    assert t("rewrite", r"\frac{dA}{dx} = 20 - 2x", r"20 - 2x = 0") == UNCHECKED


def test_lines_about_different_things_are_never_proof_of_an_error():
    assert t("evaluate", r"f(3) = 3^{2} = 9", r"f(1) = 1^{2} = 1") == UNCHECKED
    assert t("substitute", r"f'(2) = 2(2) - 3 = 1", r"f(2) = 2^{2} - 3(2) = -2", {x: sp.Integer(2)}) == UNCHECKED
    assert t("differentiate", r"v = \sin x", r"u' = 2x") == UNCHECKED
    # The same thing under the same name can still be wrong.
    assert t("substitute", r"f'(x) = 6x + 2", r"f'(2) = 12", {x: sp.Integer(2)}) == WRONG
    assert t("differentiate", r"u = x^{2}", r"u' = 3x") == WRONG


def test_integrate_uses_the_integrals_own_variable():
    assert t("integrate", r"\int \cos u \, du", r"\sin u + C") == RIGHT
    assert t("integrate", r"\int \frac{1}{2} u^{5} \, du", r"\frac{1}{2} \cdot \frac{u^{6}}{6} + C") == RIGHT


def test_a_rounded_decimal_is_never_proof_of_an_error():
    assert t("rewrite", r"= 30\pi", r"= 94.2") == UNCHECKED
    assert t("rewrite", r"c = \sqrt{\frac{4}{3}}", r"c = 1.15") == UNCHECKED
    assert t("rewrite", r"= 30\pi", r"= 80.5") == WRONG


def test_adding_the_constant_on_the_next_line_is_not_an_error():
    assert t("rewrite", r"\sin(x^{2})", r"= \sin(x^{2}) + C") != WRONG


def test_differentiate():
    assert t("differentiate", r"x^2 \sin x", r"2x \sin x + x^2 \cos x") == RIGHT
    assert t("differentiate", r"f(x) = \sin(x^2)", r"f'(x) = \cos(x^2)") == WRONG


def test_differentiate_implicit_is_left_to_the_rubric():
    assert t("differentiate", r"x^2 + y^2 = 25", r"2x + 2y \frac{dy}{dx} = 0") == UNCHECKED


def test_integrate_indefinite_any_constant():
    assert t("integrate", r"\int 2x \, dx", r"x^2 + C") == RIGHT
    assert t("integrate", r"\int 2x \, dx", r"x^2") == RIGHT
    assert t("integrate", r"\int 2x \, dx", r"2x^2 + C") == WRONG


def test_integrate_definite():
    assert t("integrate", r"\int_0^2 3x^2 \, dx", r"8") == RIGHT
    assert t("integrate", r"\int_0^2 3x^2 \, dx", r"6") == WRONG
    assert t("integrate", r"\int_0^2 3x^2 \, dx", r"x^3") == RIGHT


def test_number_after_expression_is_never_proof_of_an_error():
    assert t("rewrite", r"x + 2", r"4") == UNCHECKED
    assert t("rewrite", r"\lim_{x \to 2} (x + 2)", r"4") == RIGHT
    assert t("rewrite", r"\lim_{x \to 2} \frac{x^2 - 4}{x - 2}", r"x + 2") == RIGHT


def test_take_limit():
    assert t("take_limit", r"\lim_{x \to 0} \frac{\sin x}{x}", r"1") == RIGHT
    assert t("take_limit", r"\lim_{x \to 0} \frac{\sin x}{x}", r"0") == WRONG
    assert t("take_limit", r"\frac{\sin x}{x}", r"1") == UNCHECKED


def test_substitute_needs_the_value():
    assert t("substitute", r"6x + 2", r"14", {x: sp.Integer(2)}) == RIGHT
    assert t("substitute", r"6x + 2", r"12", {x: sp.Integer(2)}) == WRONG
    assert t("substitute", r"6x + 2", r"14") == UNCHECKED


def test_unknown_tries_every_reading():
    assert t("unknown", r"x^2", r"2x") == RIGHT
    assert t("unknown", r"x^2", r"5x") == UNCHECKED


def test_mislabelled_step_is_not_called_wrong():
    # The matcher said "rewrite" but the student differentiated, correctly.
    assert t("rewrite", r"x^2 \sin x", r"2x \sin x + x^2 \cos x") == RIGHT
    # Really wrong under every reading.
    assert t("rewrite", r"x^2 \sin x", r"2x \sin x - x^3 \cos x") == WRONG


def test_derivative_label_does_not_make_a_line_implicit():
    assert t("differentiate", r"y = x^2 \sin x", r"\frac{dy}{dx} = 2x \sin x + x^2 \cos x") == RIGHT
    assert t("differentiate", r"y = x^2 \sin x", r"\frac{dy}{dx} = 2x \sin x - x^2 \cos x") == WRONG
