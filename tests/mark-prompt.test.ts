import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_QUESTIONS, getDemoQuestion } from '@/content/demo-questions';
import { buildInstruction, FORCE_ASK, SYSTEM } from '@/lib/mark/prompt';
import { validAnnotation } from '@/lib/mark/schema';

test('three demo questions: the challenge, then two more, each with an answer and mark scheme', () => {
  assert.deepEqual(DEMO_QUESTIONS.map((q) => q.id), ['q-challenge', 'q-implicit', 'q-limit']);
  for (const q of DEMO_QUESTIONS) {
    assert.ok(q.answer.length > 0);
    assert.ok(q.markScheme.length >= 2);
  }
});

test('every demo question has a worked solution whose points add up; the challenge is worth the 4 the booklet shows', () => {
  for (const q of DEMO_QUESTIONS) {
    assert.ok(q.solution.steps.length >= 2, q.id);
    assert.ok(q.solution.trap.length > 0, q.id);
    // The last step reaches the key's result.
    assert.ok(q.solution.steps.at(-1)!.text.replace('−', '-').includes(q.answer), q.id);
  }
  const challenge = getDemoQuestion('q-challenge')!;
  assert.equal(challenge.solution.steps.reduce((n, s) => n + s.points, 0), 4);
});

test('unknown question ids are rejected', () => {
  assert.equal(getDemoQuestion('nope'), undefined);
  assert.equal(getDemoQuestion(undefined), undefined);
  assert.equal(getDemoQuestion('q-challenge')?.answer, '6');
});

test('the instruction carries the question, answer key and mark scheme', () => {
  const demo = getDemoQuestion('q-challenge')!;
  const s = buildInstruction({ width: 900, height: 620, prior: [], transcript: [], demo });
  assert.match(s, /6x sin\(x²\) dx from 0 to √π/);
  assert.match(s, /Correct final result: 6/);
  assert.match(s, /6x dx = 3 du/);
  assert.match(s, /has paused writing/);
});

test('a question turns the instruction into a lesson request', () => {
  const demo = getDemoQuestion('q-limit')!;
  const s = buildInstruction({ question: 'Teach me this step', width: 900, height: 620, prior: [], transcript: [], demo });
  assert.match(s, /asks aloud: "Teach me this step"/);
});

test('system prompt is the POC prompt plus the answer-key rules', () => {
  assert.match(SYSTEM, /holding a red pen/);
  assert.match(SYSTEM, /ANSWER KEY/);
});

test('annotation validation matches the POC limits', () => {
  assert.equal(validAnnotation({ kind: 'write', x: 1, y: 1, text: 'x'.repeat(81), size: 'big' }), false);
  assert.equal(validAnnotation({ kind: 'write', x: 1, y: 1, text: '11', size: 'big' }), true);
  assert.equal(validAnnotation({ kind: 'rect', x: 1, y: 1, w: 1, h: 50 }), false);
});

test('answer-key rules forbid the final result in lessons and never excuse a bare wrong result', () => {
  assert.match(SYSTEM, /In a lesson, never state or write the question's final result/);
  assert.match(SYSTEM, /is never unfinished, even when it stands alone/);
});

test('answer-key rules respond to any complete line and read angular handwriting', () => {
  assert.match(SYSTEM, /worthResponding is false ONLY for a blank page/);
  assert.match(SYSTEM, /A 2 often looks like a Z/);
  assert.match(SYSTEM, /Every complete line is correct but the final result is not reached yet: worthResponding true, correct true/);
  assert.doesNotMatch(SYSTEM, /it is unfinished: worthResponding false/);
});

test('a forced check may still stay silent on a blank or scribbled page', () => {
  assert.match(FORCE_ASK, /unless the page is blank or only scribble\/stray marks, in which case stay silent as usual/);
});

test('the wrong-method rule only covers methods that cannot reach the result', () => {
  assert.match(SYSTEM, /a method that cannot reach the result \(for example adding the two sides instead of squaring them\)/);
  assert.match(SYSTEM, /A valid alternative route is correct work/);
  assert.match(SYSTEM, /is case b2 below, not an error/);
});

test('each question lists its result forms and the strike-and-ask rule instead of writing one', () => {
  for (const demo of DEMO_QUESTIONS) {
    const s = buildInstruction({ width: 900, height: 620, prior: [], transcript: [], demo });
    for (const f of [demo.answer, ...demo.spokenForms]) assert.ok(s.includes(`"${f}"`), `${demo.id}: ${f}`);
    assert.ok(s.includes('If the corrected value would be one of these, strike the wrong value and ask a question instead of writing the correction.'));
  }
  assert.match(SYSTEM, /corrected value is fine, unless that corrected value is one of the question's result forms/);
});

test('the handwriting rules cover powers and bare calculus expressions', () => {
  assert.match(SYSTEM, /small digit written up and to the right of a symbol is a power/);
  assert.match(SYSTEM, /bare expression such as 3x² \+ x is a complete line/);
});

test('a lone number on the page is a result to check, not a doodle', () => {
  assert.match(SYSTEM, /a lone "14" when the key says 16/);
  assert.match(SYSTEM, /A lone number or a lone expression on an otherwise empty page is the student's result for THIS question/);
});
