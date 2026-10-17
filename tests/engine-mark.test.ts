import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckerCall } from '@/lib/engine/checker-client';
import { markProblem, unparsedLines } from '@/lib/engine/mark';
import { EngineError, type EngineModel, type EngineModelArgs } from '@/lib/engine/model';
import { AP_DEFAULT } from '@/lib/engine/profiles';
import type { CheckRequest, CheckResponse, Question, Transcript } from '@/lib/engine/types';

const Q: Question = {
  id: 'q',
  topic: 'derivatives',
  prompt: 'f(x) = x^3 + x^2. Find f\'(2) and say whether f is increasing there.',
  variable: 'x',
  variables: ['x'],
  given: 'x**3 + x**2',
  answer: '16',
  points: [
    { id: 'P1', label: 'Differentiates', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'diff(x**3 + x**2, x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Evaluates at 2', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '({P1}).subs(x, 2)' }, requires: [], followThrough: true },
    { id: 'P3', label: 'Reason', value: 1, kind: 'judge', criterion: 'States that f is increasing because the derivative is positive', requires: [], followThrough: false },
  ],
};
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const T: Transcript = { lines: ["f'(x) = 3x^{2} + 2x", "f'(2) = 16", '\\text{increasing since 16 > 0}'].map((latex, k) => ({ n: k + 1, image: 0, latex, box, confidence: 'high' as const, confirmed: true })) };

const alignment = { lines: [{ n: 1, transition: 'differentiate', substitution: null }, { n: 2, transition: 'substitute', substitution: { variable: 'x', latex: '2' } }, { n: 3, transition: 'unknown', substitution: null }], points: [{ id: 'P1', line: 1 }, { id: 'P2', line: 2 }] };
const judgements = { judgements: [{ id: 'P3', met: true, line: 3, quote: 'increasing since 16 > 0' }] };
const checkOk: CheckResponse = {
  lines: [{ n: 1, parsed: true }, { n: 2, parsed: true }, { n: 3, parsed: false }],
  transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'right' }, { to: 3, outcome: 'unchecked' }],
  points: [{ id: 'P1', outcome: 'right', ftOutcome: null, ftRefused: false, note: null, line: 1 }, { id: 'P2', outcome: 'right', ftOutcome: null, ftRefused: false, note: null, line: 2 }],
  final: 'unchecked',
};

function model(by: Partial<Record<'matcher' | 'judge', unknown>>, calls: EngineModelArgs<unknown>[] = []): EngineModel {
  return (async (a: EngineModelArgs<unknown>) => {
    calls.push(a);
    const r = by[a.role as 'matcher' | 'judge'];
    return r === undefined || r === 'fail' ? { kind: 'fail', reason: 'api' } : { kind: 'ok', data: r, model: 'm', usage: { input: 100, output: 10 } };
  }) as EngineModel;
}
const checker = (data: CheckResponse | 'down', seen: CheckRequest[] = []): CheckerCall => async (req) => {
  seen.push(req);
  return data === 'down' ? { kind: 'down' } : { kind: 'ok', data };
};

test('marks a problem end to end: matcher and judge feed the checker, the scorer decides', async () => {
  const seen: CheckRequest[] = [];
  const r = await markProblem(Q, AP_DEFAULT, T, { model: model({ matcher: alignment, judge: judgements }), checker: checker(checkOk, seen) });
  assert.deepEqual(r.points.map((p) => p.status), ['earned', 'earned', 'earned']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [3, 3, 0]);
  assert.deepEqual(seen[0].points.map((p) => [p.id, p.line]), [['P1', 1], ['P2', 2]]);
  assert.equal(seen[0].finalPoint, null);
  assert.deepEqual((r.trace as { usage: unknown }).usage, { input: 200, output: 20 });
});

test('an empty transcript scores zero without calling a model or the checker', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const seen: CheckRequest[] = [];
  const r = await markProblem(Q, AP_DEFAULT, { lines: [] }, { model: model({}, calls), checker: checker('down', seen) });
  assert.deepEqual(r.points.map((p) => p.status), ['not_earned', 'not_earned', 'not_earned']);
  assert.deepEqual([r.earned, r.total], [0, 3]);
  assert.equal(calls.length + seen.length, 0);
});

test('checker down: a retryable EngineError, not a score', async () => {
  await assert.rejects(
    () => markProblem(Q, AP_DEFAULT, T, { model: model({ matcher: alignment, judge: judgements }), checker: checker('down') }),
    (e: unknown) => e instanceof EngineError && e.stage === 'checker' && e.retryable,
  );
});

test('matcher down: a retryable EngineError', async () => {
  await assert.rejects(
    () => markProblem(Q, AP_DEFAULT, T, { model: model({ judge: judgements }), checker: checker(checkOk) }),
    (e: unknown) => e instanceof EngineError && e.stage === 'matcher',
  );
});

test('judge down: the judged point is left out, the rest is still marked', async () => {
  const r = await markProblem(Q, AP_DEFAULT, T, { model: model({ matcher: alignment }), checker: checker(checkOk) });
  assert.deepEqual(r.points.map((p) => p.status), ['earned', 'earned', 'unchecked']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [2, 2, 1]);
});

test('unparsedLines: maths the checker cannot parse, but not lines of words', async () => {
  const extra = ['x \\ge 0', '\\text{Let } u = x^{2}', '= 72\\pi \\text{ cm}'].map((latex, k) => ({ n: 4 + k, image: 0, latex, box, confidence: 'high' as const, confirmed: false }));
  const t: Transcript = { lines: [...T.lines, ...extra] };
  // The checker reports a line with words in it as not a step, although it could read its maths.
  const reply: CheckResponse = { lines: [{ n: 1, parsed: true }, { n: 2, parsed: true }, ...[3, 4, 5, 6].map((n) => ({ n, parsed: false }))], transitions: [], points: [], final: 'unchecked' };
  assert.deepEqual(await unparsedLines(Q, t, { checker: checker(reply) }), [4]);
  await assert.rejects(() => unparsedLines(Q, t, { checker: checker('down') }), EngineError);
});
