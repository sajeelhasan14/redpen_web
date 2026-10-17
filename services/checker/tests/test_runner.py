import time

from checker.runner import _guard, run_check, run_in_child

REQ = {
    "variable": "x",
    "variables": ["x"],
    "given": "x**3 + x**2",
    "lines": [{"n": 1, "latex": r"f'(x) = 3x^2 + 2x"}, {"n": 2, "latex": r"f'(2) = 16"}],
    "transitions": [
        {"to": 1, "kind": "differentiate", "substitution": None},
        {"to": 2, "kind": "substitute", "substitution": {"variable": "x", "latex": "2"}},
    ],
    "points": [
        {"id": "P1", "type": "equivalent", "expected": "diff(x**3 + x**2, x)", "followThrough": False, "line": 1},
        {"id": "P2", "type": "exact_value", "expected": "({P1}).subs(x, 2)", "followThrough": True, "line": 2},
    ],
    "finalPoint": "P2",
}


def test_full_problem():
    out = run_check(REQ)
    assert out["lines"] == [{"n": 1, "parsed": True}, {"n": 2, "parsed": True}]
    assert [t["outcome"] for t in out["transitions"]] == ["right", "right"]
    assert [p["outcome"] for p in out["points"]] == ["right", "right"]
    assert out["final"] == "right"


def test_unparseable_line_is_reported_and_its_checks_are_unchecked():
    req = dict(REQ, lines=[{"n": 1, "latex": r"f'(x) = 3x^2 + 2x"}, {"n": 2, "latex": r"\text{sixteen}"}])
    out = run_check(req)
    assert out["lines"][1] == {"n": 2, "parsed": False}
    assert out["transitions"][1]["outcome"] == "unchecked"
    assert out["points"][1]["outcome"] == "unchecked"
    assert out["final"] == "unchecked"


def test_guard_times_out():
    start = time.time()
    assert _guard(lambda: time.sleep(10), 1) is None
    assert time.time() - start < 3


def test_child_process_returns_the_same_result():
    assert run_in_child(REQ) == run_check(REQ)


def test_words_between_lines_do_not_break_the_chain():
    req = dict(REQ, lines=[REQ["lines"][0], {"n": 2, "latex": r"\text{now put in 2}"}, {"n": 3, "latex": r"f'(2) = 16"}],
               transitions=[REQ["transitions"][0], {"to": 2, "kind": "unknown", "substitution": None},
                            {"to": 3, "kind": "substitute", "substitution": {"variable": "x", "latex": "2"}}],
               points=[REQ["points"][0], dict(REQ["points"][1], line=3)])
    out = run_check(req)
    assert [t["outcome"] for t in out["transitions"]] == ["right", "unchecked", "right"]
    assert out["final"] == "right"


def test_a_line_with_a_huge_number_is_dropped_quickly_and_the_rest_is_still_checked():
    req = dict(REQ, lines=[REQ["lines"][0], {"n": 2, "latex": r"9^{9^{9}}"}, {"n": 3, "latex": r"f'(2) = 16"}],
               transitions=[REQ["transitions"][0], {"to": 2, "kind": "rewrite", "substitution": None},
                            {"to": 3, "kind": "substitute", "substitution": {"variable": "x", "latex": "2"}}],
               points=[REQ["points"][0], dict(REQ["points"][1], line=3)])
    start = time.time()
    out = run_in_child(req)
    assert time.time() - start < 10
    assert out["lines"][1] == {"n": 2, "parsed": False}
    assert [p["outcome"] for p in out["points"]] == ["right", "right"]


def test_the_time_limit_is_not_swallowed_by_code_that_catches_exceptions():
    def stubborn():
        try:
            time.sleep(10)
        except Exception:
            pass
        time.sleep(10)
        return "late"

    start = time.time()
    assert _guard(stubborn, 1) is None
    assert time.time() - start < 3


def test_a_child_that_dies_gives_none_not_an_exception(monkeypatch):
    import checker.runner as runner

    def die(conn, req, seconds):
        conn.close()

    monkeypatch.setattr(runner, "_child", die)
    assert runner.run_in_child(REQ) is None
