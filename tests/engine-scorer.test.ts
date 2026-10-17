import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_PLUS_C, REASONS, scoreExam, scoreProblem, type ScoreInput } from '@/lib/engine/scorer';
import type { Alignment, CheckResponse, Profile, Question, Transcript } from '@/lib/engine/types';

const AP: Profile = { id: 'ap-default', followThrough: true, plusC: { penalty: 1, scope: 'exam' }, exactForm: true };
const box = { x0: 0, y0: 0, x1: 10, y1: 10 };

// Differentiate, evaluate at 2, then say why the tangent is rising.
const Q: Question = {
  id: 'q',
  topic: 'derivatives',
  prompt: 'f(x) = x^3 + x^2. Find f\'(2) and say whether f is increasing at x = 2.',
  variable: 'x',
  variables: ['x'],
  given: 'x**3 + x**2',
  answer: '16',
  points: [
    { id: 'P1', label: 'Differentiates', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'diff(x**3 + x**2, x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Evaluates at 2', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '({P1}).subs(x, 2)' }, requires: [], followThrough: true },
    { id: 'P3', label: 'Reason', value: 1, kind: 'judge', criterion: 'States that f is increasing because f\'(2) > 0', requires: ['P2'], followThrough: false },
  ],
};

const transcript = (over: Partial<Transcript['lines'][number]>[] = []): Transcript => ({
  lines: [
    { n: 1, image: 0, latex: "f'(x) = 3x^2 + 2x", box, confidence: 'high', confirmed: false, ...over[0] },
    { n: 2, image: 0, latex: "f'(2) = 16", box, confidence: 'high', confirmed: false, ...over[1] },
    { n: 3, image: 0, latex: 'increasing since 16 > 0', box, confidence: 'high', confirmed: false, ...over[2] },
  ],
});
const alignment: Alignment = {
  lines: [
    { n: 1, transition: 'differentiate', substitution: null },
    { n: 2, transition: 'substitute', substitution: { variable: 'x', latex: '2' } },
    { n: 3, transition: 'unknown', substitution: null },
  ],
  points: [
    { id: 'P1', line: 1 },
    { id: 'P2', line: 2 },
    { id: 'P3', line: 3 },
  ],
};
const pt = (id: string, outcome: 'right' | 'wrong' | 'unchecked', extra: object = {}) => ({ id, outcome, ftOutcome: null, ftRefused: false, note: null, line: null, ...extra });
const check = (p1 = pt('P1', 'right'), p2 = pt('P2', 'right'), over: Partial<CheckResponse> = {}): CheckResponse => ({
  lines: [1, 2, 3].map((n) => ({ n, parsed: n !== 3 })),
  transitions: [
    { to: 1, outcome: p1.outcome },
    // A step proven right could not carry a proven-wrong point, so the fixture never pairs them.
    { to: 2, outcome: p2.outcome === 'wrong' && !('ftOutcome' in p2 && p2.ftOutcome === 'right') ? 'unchecked' : 'right' },
    { to: 3, outcome: 'unchecked' },
  ],
  points: [p1, p2] as CheckResponse['points'],
  final: 'unchecked',
  ...over,
});
const judged = [{ id: 'P3', met: true, line: 3, quote: 'increasing since 16 > 0' }];
const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({ question: Q, profile: AP, transcript: transcript(), alignment, check: check(), judgements: judged, ...over });
const statuses = (r: ReturnType<typeof scoreProblem>) => r.points.map((p) => p.status);

test('all correct: full marks, every line ok', () => {
  const r = scoreProblem(input());
  assert.deepEqual(statuses(r), ['earned', 'earned', 'earned']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [3, 3, 0]);
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'ok', 'ok']);
});

test('follow-through: wrong derivative is red, the consistent value after it is credited', () => {
  const r = scoreProblem(input({ check: check(pt('P1', 'wrong'), pt('P2', 'wrong', { ftOutcome: 'right' })) }));
  assert.deepEqual(statuses(r), ['not_earned', 'earned_follow_through', 'earned']);
  assert.deepEqual(r.lines.map((l) => l.status), ['wrong', 'ok', 'ok']);
  assert.deepEqual([r.earned, r.total], [2, 3]);
});

test('follow-through off in the profile: the later point is lost', () => {
  const r = scoreProblem(input({ profile: { ...AP, followThrough: false }, check: check(pt('P1', 'wrong'), pt('P2', 'wrong', { ftOutcome: 'right' })) }));
  assert.equal(r.points[1].status, 'not_earned');
});

test('materially easier carried value: follow-through refused, and for later points too', () => {
  const q: Question = { ...Q, points: [...Q.points.slice(0, 2), { id: 'P4', label: 'Doubles it', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '2*{P2}' }, requires: [], followThrough: true }] };
  const c = check(pt('P1', 'wrong'), pt('P2', 'wrong', { ftOutcome: 'right', ftRefused: true }));
  c.points.push(pt('P4', 'wrong', { ftOutcome: 'right' }) as CheckResponse['points'][number]);
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: 2 }, { id: 'P4', line: 3 }] };
  const r = scoreProblem(input({ question: q, check: c, alignment: a, judgements: [] }));
  assert.deepEqual(statuses(r), ['not_earned', 'not_earned', 'not_earned']);
});

test('eligibility: a point whose required point was lost is not earned, with no red on its line', () => {
  const r = scoreProblem(input({ check: check(pt('P1', 'right'), pt('P2', 'wrong')) }));
  assert.deepEqual(statuses(r), ['earned', 'not_earned', 'not_earned']);
  assert.equal(r.points[2].reason, 'Needs P2');
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'wrong', 'unchecked']);
});

test('eligibility: a required point that could not be checked makes the dependent point unchecked', () => {
  const r = scoreProblem(input({ check: check(pt('P1', 'right'), pt('P2', 'unchecked')) }));
  assert.deepEqual(statuses(r), ['earned', 'unchecked', 'unchecked']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [1, 1, 2]);
});

test('red needs a trusted line: a low-confidence unconfirmed line is never marked wrong', () => {
  const t = transcript([{ confidence: 'low' }]);
  const r = scoreProblem(input({ transcript: t, check: check(pt('P1', 'wrong'), pt('P2', 'right')) }));
  assert.equal(r.points[0].status, 'unchecked');
  assert.equal(r.points[0].reason, REASONS.unread);
  assert.equal(r.lines[0].status, 'unchecked');
});

test('a low-confidence line the student confirmed can be marked wrong', () => {
  const t = transcript([{ confidence: 'low', confirmed: true }]);
  const r = scoreProblem(input({ transcript: t, check: check(pt('P1', 'wrong'), pt('P2', 'right')) }));
  assert.equal(r.points[0].status, 'not_earned');
  assert.equal(r.lines[0].status, 'wrong');
});

test('not attempted: no line, no red, not earned', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const r = scoreProblem(input({ alignment: a, judgements: [{ id: 'P3', met: false, line: null, quote: '' }] }));
  assert.equal(r.points[1].status, 'not_earned');
  assert.equal(r.points[1].reason, REASONS.notAttempted);
  assert.ok(!r.lines.some((l) => l.status === 'wrong'));
});

test('judge: no quote, or a quote that is not on the line, earns nothing', () => {
  for (const j of [
    { id: 'P3', met: true, line: 3, quote: '' },
    { id: 'P3', met: true, line: 3, quote: 'because the derivative is positive' },
    { id: 'P3', met: true, line: null, quote: 'increasing' },
    { id: 'P3', met: true, line: 9, quote: 'increasing' },
  ]) {
    const r = scoreProblem(input({ judgements: [j] }));
    assert.equal(r.points[2].status, 'not_earned');
    assert.equal(r.points[2].reason, REASONS.noReason);
  }
});

test('judge unavailable: judged points are unchecked and leave the total', () => {
  const r = scoreProblem(input({ judgements: null }));
  assert.equal(r.points[2].status, 'unchecked');
  assert.deepEqual([r.earned, r.total, r.unchecked], [2, 2, 1]);
});

test('any valid method: a proven chain of at least three lines to the answer earns every CAS point', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: null }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'unchecked'), pt('P2', 'unchecked'), {
    lines: [1, 2, 3].map((n) => ({ n, parsed: true })),
    transitions: [1, 2, 3].map((to) => ({ to, outcome: 'right' as const })),
    final: 'right',
  });
  const r = scoreProblem(input({ alignment: a, check: c, judgements: [] }));
  assert.deepEqual(statuses(r), ['earned', 'earned', 'not_earned']);
  assert.equal(r.points[0].reason, REASONS.validMethod);
});

test('a line with an unparsed line of words above is compared with the maths above that', () => {
  const t = transcript([{}, { latex: '\\text{now put in 2}', confidence: 'low' }, { latex: "f'(2) = 17" }]);
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'right'), pt('P2', 'unchecked'), {
    lines: [{ n: 1, parsed: true }, { n: 2, parsed: false }, { n: 3, parsed: true }],
    transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'unchecked' }, { to: 3, outcome: 'wrong' }],
  });
  const r = scoreProblem(input({ transcript: t, alignment: a, check: c, judgements: [] }));
  // Line 2 is low-confidence words, but line 3 was checked against line 1, which is trusted.
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'unchecked', 'wrong']);
});

test('a broken chain does not trigger any-valid-method', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: null }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'unchecked'), pt('P2', 'unchecked'), { final: 'right' });
  const r = scoreProblem(input({ alignment: a, check: c, judgements: [] }));
  assert.deepEqual(statuses(r), ['not_earned', 'not_earned', 'not_earned']);
});

test('a line with no rubric point is red only when its step is proven wrong', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: 3 }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'right'), pt('P2', 'right'), {
    lines: [1, 2, 3].map((n) => ({ n, parsed: true })),
    transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'wrong' }, { to: 3, outcome: 'right' }],
  });
  const r = scoreProblem(input({ alignment: a, check: c, judgements: [] }));
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'wrong', 'ok']);
});

test('decimal for an exact value: unchecked under exactForm, earned without it', () => {
  const c = check(pt('P1', 'right'), pt('P2', 'unchecked', { note: 'inexact' }));
  assert.equal(scoreProblem(input({ check: c })).points[1].status, 'unchecked');
  assert.equal(scoreProblem(input({ check: c, profile: { ...AP, exactForm: false } })).points[1].status, 'earned');
});

test('missing +C raises a flag; scoreExam applies it once across problems', () => {
  const c = check(pt('P1', 'right', { note: 'missing_constant' }), pt('P2', 'right'));
  const one = scoreProblem(input({ check: c }));
  assert.deepEqual(one.penaltyFlags, [MISSING_PLUS_C]);
  assert.equal(one.earned, 3);
  const exam = scoreExam([one, one, scoreProblem(input())], AP);
  assert.deepEqual(exam, { earned: 8, total: 9, unchecked: 0, penalties: [{ id: MISSING_PLUS_C, value: 1 }] });
});

test('scoreExam: no flags, no penalty; never below zero', () => {
  assert.deepEqual(scoreExam([scoreProblem(input())], AP).penalties, []);
  const zero = { ...scoreProblem(input()), earned: 0, penaltyFlags: [MISSING_PLUS_C] };
  assert.equal(scoreExam([zero], AP).earned, 0);
});

test('an answer with no working, or the question restated and then the answer, earns no method points', () => {
  for (const count of [1, 2]) {
    const ns = [1, 2, 3].slice(0, count);
    const t = { lines: transcript().lines.slice(0, count) };
    const a = { lines: [], points: [{ id: 'P1', line: null }, { id: 'P2', line: count }] };
    const c = check(pt('P1', 'unchecked'), pt('P2', 'right', { line: count }), {
      lines: ns.map((n) => ({ n, parsed: true })),
      transitions: ns.map((to) => ({ to, outcome: 'right' as const })),
      final: 'right',
    });
    const r = scoreProblem(input({ transcript: t, alignment: a, check: c, judgements: [] }));
    assert.deepEqual(statuses(r), ['not_earned', 'earned', 'not_earned'], `${count} line(s)`);
    assert.equal(r.points[0].reason, REASONS.notAttempted);
  }
});

test('a point the checker found finished on a later line is credited there', () => {
  const c = check(pt('P1', 'right', { line: 1 }), pt('P2', 'right', { line: 3 }), { lines: [1, 2, 3].map((n) => ({ n, parsed: true })), transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'unchecked' }, { to: 3, outcome: 'unchecked' }] });
  const r = scoreProblem(input({ check: c, judgements: [] }));
  assert.equal(r.points[1].status, 'earned');
  assert.equal(r.points[1].line, 3);
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'unchecked', 'ok']);
});

test('a line that earned one point is not red because another point on it was lost', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: 1 }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'wrong', { line: 1 }), pt('P2', 'right', { line: 1 }), { transitions: [{ to: 1, outcome: 'unchecked' }, { to: 2, outcome: 'unchecked' }, { to: 3, outcome: 'unchecked' }] });
  const r = scoreProblem(input({ alignment: a, check: c, judgements: [] }));
  assert.deepEqual(statuses(r).slice(0, 2), ['not_earned', 'earned']);
  assert.equal(r.lines[0].status, 'ok');
});

test('a line whose step is proven right is not red, even when its point is lost', () => {
  // f'(x) = 5 is wrong; f'(2) = 5 follows from it correctly but follow-through is refused.
  const c = check(pt('P1', 'wrong', { line: 1 }), pt('P2', 'wrong', { line: 2, ftOutcome: 'right', ftRefused: true }));
  const r = scoreProblem(input({ check: c, judgements: [] }));
  assert.deepEqual(statuses(r).slice(0, 2), ['not_earned', 'not_earned']);
  assert.deepEqual(r.lines.map((l) => l.status).slice(0, 2), ['wrong', 'unchecked']);
});

test('judge: a quote of the words inside \\text{...} counts as being on the line', () => {
  const t = transcript([{}, {}, { latex: '\\text{left limit must equal right limit at } x = 1' }]);
  for (const quote of ['left limit must equal right limit at x = 1', 'left limit must equal right limit', '\\text{left limit must equal right limit at } x = 1']) {
    const r = scoreProblem(input({ transcript: t, judgements: [{ id: 'P3', met: true, line: 3, quote }] }));
    assert.equal(r.points[2].status, 'earned', quote);
  }
  const r = scoreProblem(input({ transcript: t, judgements: [{ id: 'P3', met: true, line: 3, quote: 'the limits are equal' }] }));
  assert.equal(r.points[2].status, 'not_earned');
});
