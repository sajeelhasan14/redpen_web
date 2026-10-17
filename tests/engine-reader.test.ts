import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, type EngineModel, type EngineModelArgs } from '@/lib/engine/model';
import { MAX_IMAGE_BASE64, MAX_LATEX, MAX_LINES, READER_SYSTEM, RETAKE_DEFAULT, RETAKE_EMPTY, RETAKE_TOO_LARGE, readProblem, readerInstruction } from '@/lib/engine/reader';
import type { Question } from '@/lib/engine/types';

const Q: Question = {
  id: 'q',
  topic: 'derivatives',
  prompt: 'Differentiate y = \\sin(x^2).',
  variable: 'x',
  variables: ['x'],
  answer: '2*x*cos(x**2)',
  points: [{ id: 'P1', label: 'Chain rule', value: 2, kind: 'cas', check: { type: 'equivalent', expected: 'diff(sin(x**2), x)' }, requires: [], followThrough: false }],
};
const img = { mediaType: 'image/jpeg' as const, base64: 'AAAA' };
const box = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.3 };
const line = (latex: string, over: object = {}) => ({ image: 0, latex, box, confidence: 'high' as const, ...over });

function model(replies: unknown[], calls: EngineModelArgs<unknown>[] = []): EngineModel {
  let k = 0;
  return (async (a: EngineModelArgs<unknown>) => {
    calls.push(a);
    const r = replies[Math.min(k++, replies.length - 1)];
    return r === 'fail' ? { kind: 'fail', reason: 'api' } : { kind: 'ok', data: r, model: 'm', usage: { input: 10, output: 5 } };
  }) as EngineModel;
}
const read = (data: unknown, images = [img]) => readProblem(images, Q, { model: model([data]) });

test('a readable page becomes numbered, unconfirmed lines', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const r = await readProblem([img], Q, { model: model([{ readable: true, retakeReason: '', lines: [line('\\frac{dy}{dx} = 2x\\cos(x^{2})'), line('= 2x\\cos(x^{2})', { confidence: 'low' })] }], calls) });
  assert.equal(r.kind, 'transcript');
  if (r.kind !== 'transcript') return;
  assert.deepEqual(r.transcript.lines.map((l) => [l.n, l.image, l.confidence, l.confirmed]), [[1, 0, 'high', false], [2, 0, 'low', false]]);
  assert.deepEqual(r.usage, { input: 10, output: 5 });
  assert.equal(calls[0].role, 'reader');
  assert.equal(calls[0].system, READER_SYSTEM);
  assert.deepEqual(calls[0].images, [img]);
});

test('the instruction names the question and variables and forbids guessing', () => {
  const s = readerInstruction(Q, 2);
  assert.match(s, /Differentiate y/);
  assert.match(s, /Variables in this question: x\./);
  assert.match(s, /are 2 images/);
  assert.match(s, /Do not use the question to guess/);
});

test('unreadable: the model\'s reason, or the default when it gives none', async () => {
  assert.deepEqual(await read({ readable: false, retakeReason: 'Too dark.', lines: [] }), { kind: 'retake', reason: 'Too dark.' });
  assert.deepEqual(await read({ readable: false, retakeReason: '  ', lines: [] }), { kind: 'retake', reason: RETAKE_DEFAULT });
});

test('a blank page, or lines of only whitespace, asks for a retake', async () => {
  assert.deepEqual(await read({ readable: true, retakeReason: '', lines: [] }), { kind: 'retake', reason: RETAKE_EMPTY });
  assert.deepEqual(await read({ readable: true, retakeReason: '', lines: [line('   '), line('\u0000')] }), { kind: 'retake', reason: RETAKE_EMPTY });
});

test('an oversized image is refused before any model call', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const big = { mediaType: 'image/jpeg' as const, base64: 'A'.repeat(MAX_IMAGE_BASE64 + 1) };
  assert.deepEqual(await readProblem([big], Q, { model: model([{}], calls) }), { kind: 'retake', reason: RETAKE_TOO_LARGE });
  assert.equal(calls.length, 0);
});

test('no images, or more than four, is a caller bug', async () => {
  await assert.rejects(() => readProblem([], Q, { model: model([{}]) }), TypeError);
  await assert.rejects(() => readProblem([img, img, img, img, img], Q, { model: model([{}]) }), TypeError);
});

test('boxes are clamped and ordered; a bad image index is pulled into range', async () => {
  const r = await read({ readable: true, retakeReason: '', lines: [line('x', { image: 7, box: { x0: 1.4, y0: 0.5, x1: -0.2, y1: 0.1 } }), line('y', { image: -3, box: { x0: NaN, y0: 0, x1: 0.5, y1: 0.5 } })] }, [img, img]);
  assert.equal(r.kind, 'transcript');
  if (r.kind !== 'transcript') return;
  assert.deepEqual(r.transcript.lines[0].box, { x0: 0, y0: 0.1, x1: 1, y1: 0.5 });
  assert.equal(r.transcript.lines[0].image, 1);
  assert.equal(r.transcript.lines[1].image, 0);
  assert.deepEqual(r.transcript.lines[1].box, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 });
});

test('an over-long line is cut and can no longer be trusted; a huge page is capped', async () => {
  const many = Array.from({ length: MAX_LINES + 10 }, (_, k) => line(`x + ${k}`));
  many[0] = line('x'.repeat(MAX_LATEX + 50));
  const r = await read({ readable: true, retakeReason: '', lines: many });
  assert.equal(r.kind, 'transcript');
  if (r.kind !== 'transcript') return;
  assert.equal(r.transcript.lines.length, MAX_LINES);
  assert.equal(r.transcript.lines[0].latex.length, MAX_LATEX);
  assert.equal(r.transcript.lines[0].confidence, 'low');
});

test('one retry, then a retryable EngineError', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const ok = { readable: true, retakeReason: '', lines: [line('x')] };
  assert.equal((await readProblem([img], Q, { model: model(['fail', ok], calls) })).kind, 'transcript');
  assert.equal(calls.length, 2);
  await assert.rejects(
    () => readProblem([img], Q, { model: model(['fail', 'fail']) }),
    (e: unknown) => e instanceof EngineError && e.stage === 'reader' && e.retryable === true,
  );
});
