import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion, rubricProblems } from '@/lib/engine/rubric';
import type { Question } from '@/lib/engine/types';

const good: Question = {
  id: 'q-test',
  topic: 'derivatives',
  prompt: 'Find f\'(2).',
  variable: 'x',
  variables: ['x'],
  answer: '16',
  points: [
    { id: 'P1', label: 'Differentiates', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'diff(x**3, x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Evaluates', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '({P1}).subs(x, 2)' }, requires: ['P1'], followThrough: true },
    { id: 'P3', label: 'Reason', value: 1, kind: 'judge', criterion: 'Says why', requires: [], followThrough: false },
  ],
};
const withPoint = (k: number, over: object): Question => ({ ...good, points: good.points.map((p, i) => (i === k ? ({ ...p, ...over } as Question['points'][number]) : p)) });

test('a sound rubric has no problems and parses', () => {
  assert.deepEqual(rubricProblems(good), []);
  assert.equal(parseQuestion(good).id, 'q-test');
});

test('parseQuestion drops unknown keys', () => {
  assert.equal('model' in parseQuestion({ ...good, model: [] }), false);
});

test('each rubric fault is named', () => {
  const cases: [Question, RegExp][] = [
    [{ ...good, variable: 't' }, /variable t is not in variables/],
    [{ ...good, points: [good.points[0], { ...good.points[1], id: 'P1' }] }, /P1: duplicate id/],
    [withPoint(0, { check: undefined }), /P1: a cas point needs check/],
    [withPoint(2, { criterion: undefined }), /P3: a judge point needs criterion/],
    [withPoint(2, { followThrough: true }), /P3: a judge point cannot follow through/],
    [withPoint(0, { requires: ['P2'] }), /P1: requires P2, which is not an earlier point/],
    [withPoint(0, { check: { type: 'equivalent', expected: '{P2} + 1' } }), /P1: expected references P2/],
    [withPoint(0, { followThrough: true }), /P1: followThrough needs an earlier point/],
    [withPoint(0, { check: { type: 'equivalent', expected: 'x', requireConstant: true } }), /P1: requireConstant is for antiderivative/],
  ];
  for (const [q, re] of cases) assert.match(rubricProblems(q).join('\n'), re);
});

test('parseQuestion throws on a schema fault and on a rubric fault', () => {
  assert.throws(() => parseQuestion({ ...good, id: 'Bad Id' }), /Invalid question/);
  assert.throws(() => parseQuestion({ ...good, points: [] }), /Invalid question/);
  assert.throws(() => parseQuestion({ ...good, variable: 't' }), /Invalid rubric for q-test/);
  assert.throws(() => parseQuestion(null), /Invalid question/);
});
