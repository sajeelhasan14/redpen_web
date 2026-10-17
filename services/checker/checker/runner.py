"""Runs one problem's checks in a child process with a time limit on each check."""
import multiprocessing
import signal
from typing import Dict

import sympy as sp

from .equiv import UNCHECKED
from .parse import ParsedLine, ParseError, parse_line
from .rubric import check_points, compare
from .transitions import check_transition

CHECK_SECONDS = 5


class _Timeout(BaseException):
    """Not an Exception: library code that catches Exception must not swallow the time limit."""


def _alarm(signum, frame):
    raise _Timeout()


def _guard(fn, seconds: int = CHECK_SECONDS):
    """Run fn; None on timeout or any error. Only valid in a process's main thread."""
    signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(seconds)
    try:
        return fn()
    except _Timeout:
        return None
    except Exception:
        return None
    finally:
        signal.alarm(0)


def run_check(req: dict, seconds: int = CHECK_SECONDS) -> dict:
    guard = lambda fn: _guard(fn, seconds)
    var = sp.Symbol(req["variable"])
    parsed: Dict[int, ParsedLine] = {}
    line_out = []
    for ln in req["lines"]:
        def parse(ln=ln):
            try:
                return parse_line(ln["latex"], req["variables"])
            except ParseError:
                return None
        p = guard(parse)
        if p is not None:
            parsed[ln["n"]] = p
        # A line with words in it can earn a point but is not a step in the chain of maths.
        line_out.append({"n": ln["n"], "parsed": p is not None and not p.words})
    maths = {n: p for n, p in parsed.items() if not p.words}
    declared = [sp.Symbol(v) for v in req["variables"]]

    given = None
    if req.get("given"):
        from .rubric import eval_expected
        g = guard(lambda: eval_expected(req["given"], req["variables"], {}))
        if g is not None:
            given = ParsedLine([g])

    order = [ln["n"] for ln in req["lines"]]
    trans_out = []
    for t in req["transitions"]:
        to = t["to"]
        idx = order.index(to) if to in order else -1
        # The line above may be words. Compare with the nearest parsed line above, or the question itself.
        earlier = [maths[n] for n in order[:max(idx, 0)] if n in maths]
        prev = (earlier[-1] if earlier else given) if idx >= 0 else None
        cur = maths.get(to)
        outcome = UNCHECKED
        if prev is not None and cur is not None:
            sub = None
            if t.get("substitution"):
                s = t["substitution"]
                def parse_sub(s=s):
                    try:
                        return {sp.Symbol(s["variable"]): parse_line(s["latex"]).value}
                    except ParseError:
                        return None
                sub = guard(parse_sub)
            got = guard(lambda: check_transition(t["kind"], prev, cur, var, sub, declared))
            outcome = got if got is not None else UNCHECKED
        trans_out.append({"to": to, "outcome": outcome})

    points, correct = check_points(req["points"], parsed, req["variable"], req["variables"], guard)

    final = UNCHECKED
    last = next((parsed[n] for n in reversed(order) if n in parsed), None)
    fp = next((p for p in req["points"] if p["id"] == req.get("finalPoint")), None)
    if last is not None and fp is not None and order and order[-1] in parsed:
        from .rubric import eval_expected
        def final_check():
            # `correct` holds each point's value; rebuild this point's expected from the earlier ones.
            expected = eval_expected(fp["expected"], req["variables"], correct)
            return compare(fp["type"], last, expected, var, declared)[0]
        got = guard(final_check)
        final = got if got is not None else UNCHECKED
    return {"lines": line_out, "transitions": trans_out, "points": points, "final": final}


def _child(conn, req, seconds):
    try:
        conn.send(run_check(req, seconds))
    except Exception:
        conn.send(None)
    finally:
        conn.close()


def run_in_child(req: dict, seconds: int = CHECK_SECONDS):
    """Returns the result dict, or None if the child died or overran its total budget."""
    ctx = multiprocessing.get_context("fork")
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(child, req, seconds), daemon=True)
    proc.start()
    child.close()
    checks = len(req["lines"]) + len(req["transitions"]) + 4 * len(req["points"]) + 2
    # One request never holds a worker for more than 45 seconds, however many checks it has.
    budget = min(45, seconds * checks + 5)
    try:
        result = parent.recv() if parent.poll(budget) else None
    except EOFError:  # the child died without sending anything
        result = None
    proc.join(1)
    if proc.is_alive():
        proc.kill()
    return result
