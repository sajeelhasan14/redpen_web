import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, type EngineModel, type EngineModelArgs } from '@/lib/engine/model';
import { matchLines, matcherInstruction, sanitiseAlignment, type RawAlignment } from '@/lib/engine/matcher';
import { judgeInstruction, judgePoints } from '@/lib/engine/judge';
import type { Question, Transcript } from '@/lib/engine/types';

const Q: Question = {
  id: 'q',
  topic: 'optimisation',
  prompt: 'A rectangle has perimeter 40. Find the largest possible area.',
  variable: 'x',
  variables: ['x'],
  answer: '100',
  points: [
    { id: 'P1', label: 'Area in one variable', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'x*(20 - x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Justifies that it is a maximum', value: 1, kind: 'judge', criterion: 'Justifies the maximum', requires: [], followThrough: false },
    { id: 'P3', label: 'Largest area', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '100' }, requires: [], followThrough: false },
  ],
};
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const T: Transcript = { lines: ['A = x(20 - x)', '\\text{second derivative negative so max}', 'A = 100'].map((latex, k) => ({ n: k + 1, image: 0, latex, box, confidence: 'high' as const, confirmed: false })) };

function model(replies: unknown[], calls: EngineModelArgs<unknown>[] = []): EngineModel {
  let k = 0;
  return (async (a: EngineModelArgs<unknown>) => {
    calls.push(a);
    const r = replies[Math.min(k++, replies.length - 1)];
    return r === 'fail' ? { kind: 'fail', reason: 'api' } : { kind: 'ok', data: r, model: 'm', usage: { input: 3, output: 2 } };
  }) as EngineModel;
}

test('matcher instruction shows labels of CAS points only, never expected values or criteria', () => {
  const s = matcherInstruction(Q, T);
  assert.match(s, /P1: Area in one variable/);
  assert.match(s, /P3: Largest area/);
  assert.ok(!s.includes('P2'));
  assert.ok(!s.includes('x*(20 - x)'));
  assert.match(s, /3\. A = 100/);
});

test('sanitise: missing lines become unknown, bad references are dropped, substitution only with substitute', () => {
  const raw: RawAlignment = {
    lines: [
      { n: 1, transition: 'rewrite', substitution: { variable: 'x', latex: '2' } },
      { n: 3, transition: 'substitute', substitution: { variable: 'x', latex: ' 10 ' } },
      { n: 9, transition: 'differentiate', substitution: null },
    ],
    points: [
      { id: 'P1', line: 1 },
      { id: 'P2', line: 2 },
      { id: 'P3', line: 8 },
      { id: 'P7', line: 1 },
    ],
  };
  assert.deepEqual(sanitiseAlignment(Q, T, raw), {
    lines: [
      { n: 1, transition: 'rewrite', substitution: null },
      { n: 2, transition: 'unknown', substitution: null },
      { n: 3, transition: 'substitute', substitution: { variable: 'x', latex: '10' } },
    ],
    points: [
      { id: 'P1', line: 1 },
      { id: 'P3', line: null },
    ],
  });
});

test('sanitise: a substitution with a bad variable or an empty value is dropped', () => {
  const sub = (variable: string, latex: string): RawAlignment => ({ lines: [{ n: 1, transition: 'substitute', substitution: { variable, latex } }], points: [] });
  assert.equal(sanitiseAlignment(Q, T, sub('xy', '2')).lines[0].substitution, null);
  assert.equal(sanitiseAlignment(Q, T, sub('x', '  ')).lines[0].substitution, null);
  assert.equal(sanitiseAlignment(Q, T, sub('x', '1'.repeat(101))).lines[0].substitution, null);
});

test('matchLines: no image is sent; one retry, then EngineError', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const ok = { lines: [], points: [{ id: 'P1', line: 1 }] };
  const r = await matchLines(Q, T, { model: model(['fail', ok], calls) });
  assert.deepEqual(r.alignment.points, [{ id: 'P1', line: 1 }, { id: 'P3', line: null }]);
  assert.deepEqual(r.usage, { input: 3, output: 2 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].images, []);
  assert.equal(calls[0].role, 'matcher');
  await assert.rejects(() => matchLines(Q, T, { model: model(['fail']) }), (e: unknown) => e instanceof EngineError && e.stage === 'matcher');
});

test('judge instruction lists criteria of judged points only', () => {
  const s = judgeInstruction(Q, T);
  assert.match(s, /P2: Justifies the maximum/);
  assert.ok(!s.includes('P1:'));
  assert.match(s, /2\. \\text\{second derivative negative so max\}/);
});

test('judge: one judgement per judged point; a point the model skipped is not met', async () => {
  const r = await judgePoints(Q, T, { model: model([{ judgements: [{ id: 'P2', met: true, line: 2, quote: 'second derivative negative' }, { id: 'P1', met: true, line: 1, quote: 'A' }] }]) });
  assert.deepEqual(r.judgements, [{ id: 'P2', met: true, line: 2, quote: 'second derivative negative' }]);
  const skipped = await judgePoints(Q, T, { model: model([{ judgements: [] }]) });
  assert.deepEqual(skipped.judgements, [{ id: 'P2', met: false, line: null, quote: '' }]);
});

test('judge: no judged points means no model call; a dead judge gives null', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const casOnly = { ...Q, points: [Q.points[0]] };
  assert.deepEqual(await judgePoints(casOnly, T, { model: model([{}], calls) }), { judgements: [], usage: { input: 0, output: 0 } });
  assert.equal(calls.length, 0);
  const dead = await judgePoints(Q, T, { model: model(['fail'], calls) });
  assert.equal(dead.judgements, null);
  assert.equal(calls.length, 2);
});
