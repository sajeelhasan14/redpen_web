import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALC1_QUESTIONS, getCalc1Question } from '@/content/calc1/questions';
import { TOPICS } from '@/lib/engine/rubric';

test('seed bank: about 30 questions, every topic covered, unique ids, model lines point at real points', () => {
  assert.ok(CALC1_QUESTIONS.length >= 30);
  assert.equal(new Set(CALC1_QUESTIONS.map((q) => q.id)).size, CALC1_QUESTIONS.length);
  for (const t of TOPICS) assert.ok(CALC1_QUESTIONS.some((q) => q.topic === t), `no question for ${t}`);
  for (const q of CALC1_QUESTIONS) {
    assert.ok(q.model.length > 0, q.id);
    const ids = new Set(q.points.map((p) => p.id));
    for (const l of q.model) assert.ok(l.point === null || ids.has(l.point), `${q.id}: model line points at ${l.point}`);
    // The model solution attempts every point.
    for (const p of q.points) assert.ok(q.model.some((l) => l.point === p.id), `${q.id}: model solution never attempts ${p.id}`);
  }
  assert.equal(getCalc1Question('der-chain')?.topic, 'derivatives');
  assert.equal(getCalc1Question('nope'), undefined);
});
