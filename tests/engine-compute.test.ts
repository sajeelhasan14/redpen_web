import { test } from 'node:test';
import assert from 'node:assert/strict';
import typed from '@/fixtures/engine/typed.json';
import { buildCheckRequest, callChecker } from '@/lib/engine/checker-client';
import { AP_DEFAULT } from '@/lib/engine/profiles';
import { CALC1_QUESTIONS, getCalc1Question, type ModelLine, type SeedQuestion } from '@/content/calc1/questions';
import { scoreProblem } from '@/lib/engine/scorer';
import type { Alignment, Judgement, MarkResult, Transcript } from '@/lib/engine/types';

// The compute path with no model in it: typed lines and a hand-made alignment go
// through the real SymPy service and the scorer. Needs the checker running:
//   CHECKER_URL=http://127.0.0.1:8000 CHECKER_SECRET=dev npm test
const skip = process.env.CHECKER_URL ? false : 'CHECKER_URL is not set';
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };

async function mark(q: SeedQuestion, lines: ModelLine[]): Promise<MarkResult> {
  const transcript: Transcript = { lines: lines.map((l, k) => ({ n: k + 1, image: 0, latex: l.latex, box, confidence: 'high' as const, confirmed: true })) };
  const lineOf = (id: string) => {
    const k = lines.findIndex((l) => l.point === id);
    return k < 0 ? null : k + 1;
  };
  const alignment: Alignment = {
    lines: lines.map((l, k) => ({ n: k + 1, transition: l.kind, substitution: l.sub })),
    points: q.points.filter((p) => p.kind === 'cas').map((p) => ({ id: p.id, line: lineOf(p.id) })),
  };
  const judgements: Judgement[] = q.points
    .filter((p) => p.kind === 'judge')
    .map((p) => {
      const n = lineOf(p.id);
      return n === null ? { id: p.id, met: false, line: null, quote: '' } : { id: p.id, met: true, line: n, quote: lines[n - 1].latex };
    });
  const check = await callChecker(buildCheckRequest(q, transcript, alignment));
  assert.equal(check.kind, 'ok', 'the checker must be reachable');
  if (check.kind !== 'ok') throw new Error('unreachable');
  return scoreProblem({ question: q, profile: AP_DEFAULT, transcript, alignment, check: check.data, judgements });
}

test('every seed model solution earns full marks, with no red line and nothing unchecked', { skip }, async () => {
  for (const q of CALC1_QUESTIONS) {
    const r = await mark(q, q.model);
    const full = q.points.reduce((a, p) => a + p.value, 0);
    assert.deepEqual([r.earned, r.total, r.unchecked], [full, full, 0], q.id);
    assert.deepEqual(r.lines.filter((l) => l.status === 'wrong'), [], q.id);
    assert.deepEqual(r.penaltyFlags, [], q.id);
  }
});

test('typed cases: common errors, follow-through, other methods', { skip }, async () => {
  for (const c of typed as unknown as { id: string; questionId: string; lines: ModelLine[]; expect: Record<string, string>; red: number[]; flags: string[] }[]) {
    const q = getCalc1Question(c.questionId);
    assert.ok(q, c.id);
    const r = await mark(q, c.lines);
    assert.deepEqual(Object.fromEntries(r.points.map((p) => [p.id, p.status])), c.expect, c.id);
    assert.deepEqual(r.lines.filter((l) => l.status === 'wrong').map((l) => l.n), c.red, c.id);
    assert.deepEqual(r.penaltyFlags, c.flags, c.id);
  }
});
