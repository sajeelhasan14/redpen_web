import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGREEMENT_MIN, FALSE_RED_MAX, attempt, metricsFor, redLines, type EvalRun } from '@/lib/engine/eval';
import { EngineError } from '@/lib/engine/model';
import type { MarkResult, PointStatus } from '@/lib/engine/types';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
function run(id: string, path: 'canvas' | 'photo', grader: { points: Record<string, boolean>; score: number; correctLines: number }, engine: { points: Record<string, PointStatus>; lines: ('ok' | 'wrong' | 'unchecked')[] } | null): EvalRun {
  const result: MarkResult | null = engine && {
    questionId: 'q',
    points: Object.entries(engine.points).map(([pid, status]) => ({ id: pid, status, verifiedBy: 'cas' as const, reason: '' })),
    lines: engine.lines.map((status, k) => ({ n: k + 1, image: 0, status, box })),
    earned: Object.values(engine.points).filter((s) => s === 'earned' || s === 'earned_follow_through').length,
    total: Object.values(engine.points).filter((s) => s !== 'unchecked').length,
    unchecked: Object.values(engine.points).filter((s) => s === 'unchecked').length,
    penaltyFlags: [],
    trace: null,
  };
  return { solution: { id, questionId: 'q', path, images: [], grader }, result };
}

const runs: EvalRun[] = [
  // Agrees exactly; one correct red line.
  run('s1', 'photo', { points: { P1: false, P2: true }, score: 1, correctLines: 2 }, { points: { P1: 'not_earned', P2: 'earned_follow_through' }, lines: ['wrong', 'ok', 'ok'] }),
  // Engine red on a line the grader calls correct, and a point credited that the grader withheld.
  run('s2', 'photo', { points: { P1: true, P2: false }, score: 1, correctLines: 3 }, { points: { P1: 'not_earned', P2: 'earned' }, lines: ['wrong', 'ok', 'ok'] }),
  // Two points left unchecked: engine 0 against grader 2 is outside one point.
  run('s3', 'photo', { points: { P1: true, P2: true }, score: 2, correctLines: 3 }, { points: { P1: 'unchecked', P2: 'unchecked' }, lines: ['unchecked', 'unchecked', 'unchecked'] }),
  // The engine could not mark this one at all.
  run('s4', 'photo', { points: { P1: true, P2: true }, score: 2, correctLines: 2 }, null),
  run('c1', 'canvas', { points: { P1: true }, score: 1, correctLines: 1 }, { points: { P1: 'earned' }, lines: ['ok'] }),
];

test('red lines are listed for the second pass', () => {
  assert.deepEqual(redLines(runs), [{ solutionId: 's1', line: 1 }, { solutionId: 's2', line: 1 }]);
});

test('false-red rate is pending until every red line is adjudicated', () => {
  const m = metricsFor('photo', runs, { s1: { '1': true } });
  assert.equal(m.falseRedRate, null);
  assert.equal(m.pendingRedLines, 1);
  assert.equal(m.passes, null);
});

test('photo metrics: false red over correct lines, agreement within one point, false credit, coverage', () => {
  const m = metricsFor('photo', runs, { s1: { '1': true }, s2: { '1': false } });
  assert.equal(m.solutions, 4);
  assert.equal(m.falseRedRate, 1 / 10);
  assert.equal(m.scoreAgreement, 2 / 4);
  assert.equal(m.falseCreditRate, 1 / 2);
  assert.equal(m.coverage, 1 - 4 / 8);
  assert.equal(m.passes, false);
});

test('paths are measured separately; a clean path passes', () => {
  const m = metricsFor('canvas', runs, {});
  assert.deepEqual([m.solutions, m.falseRedRate, m.scoreAgreement, m.falseCreditRate, m.coverage, m.passes], [1, 0, 1, 0, 1, true]);
});

test('the bar sits exactly at the thresholds', () => {
  assert.equal(FALSE_RED_MAX, 0.02);
  assert.equal(AGREEMENT_MIN, 0.85);
  const many: EvalRun[] = Array.from({ length: 20 }, (_, k) =>
    run(`a${k}`, 'canvas', { points: { P1: true }, score: 1, correctLines: 5 }, { points: { P1: k < 17 ? 'earned' : 'not_earned' }, lines: k < 2 ? ['wrong'] : ['ok'] }),
  );
  // 17 of 20 agree exactly; the other three are 0 against 1, still within one point.
  assert.equal(metricsFor('canvas', many, { a0: { '1': false }, a1: { '1': false } }).falseRedRate, 2 / 100);
  assert.equal(metricsFor('canvas', many, { a0: { '1': false }, a1: { '1': false } }).passes, true);
  const worse = [...many, run('a20', 'canvas', { points: { P1: true }, score: 1, correctLines: 0 }, { points: { P1: 'earned' }, lines: ['wrong'] })];
  assert.equal(metricsFor('canvas', worse, { a0: { '1': false }, a1: { '1': false }, a20: { '1': false } }).passes, false);
});

test('an empty path does not pass', () => {
  const m = metricsFor('photo', [], {});
  assert.deepEqual([m.solutions, m.passes, m.coverage], [0, false, 0]);
});

test('attempt: a result or a retake is final; an engine failure is not, so a resumed run tries it again', async () => {
  const marked = runs[0].result;
  assert.deepEqual(await attempt(async () => marked), { result: marked, final: true });
  assert.deepEqual(await attempt(async () => null), { result: null, final: true });
  assert.deepEqual(
    await attempt(async () => {
      throw new EngineError('checker', 'down');
    }),
    { result: null, final: false },
  );
  await assert.rejects(
    () =>
      attempt(async () => {
        throw new TypeError('a bug, not an outage');
      }),
    TypeError,
  );
});
