import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckRequest, callChecker } from '@/lib/engine/checker-client';
import type { Alignment, Question, Transcript } from '@/lib/engine/types';

const realFetch = globalThis.fetch;
const realError = console.error;
const saved = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  for (const k of ['CHECKER_URL', 'CHECKER_SECRET', 'CHECKER_TIMEOUT_MS'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});
const quiet = () => void (console.error = () => {});

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const Q: Question = {
  id: 'q',
  topic: 'ftc',
  prompt: 'Find the integral.',
  variable: 'x',
  variables: ['x'],
  given: 'Integral(2*x, x)',
  answer: 'x**2',
  points: [
    { id: 'P1', label: 'Antiderivative', value: 2, kind: 'cas', check: { type: 'antiderivative', expected: '2*x', requireConstant: true }, requires: [], followThrough: false },
    { id: 'P2', label: 'Reason', value: 1, kind: 'judge', criterion: 'Says why', requires: [], followThrough: false },
  ],
};
const T: Transcript = { lines: [1, 2].map((n) => ({ n, image: 0, latex: n === 1 ? 'x^{2} + C' : '\\text{done}', box, confidence: 'high' as const, confirmed: false })) };
const A: Alignment = { lines: [{ n: 1, transition: 'integrate', substitution: null }], points: [{ id: 'P1', line: 1 }] };

test('request: every line gets a transition, only CAS points are sent, a judged last point means no final check', () => {
  const req = buildCheckRequest(Q, T, A);
  assert.deepEqual(req.lines, [{ n: 1, latex: 'x^{2} + C' }, { n: 2, latex: '\\text{done}' }]);
  assert.deepEqual(req.transitions, [
    { to: 1, kind: 'integrate', substitution: null },
    { to: 2, kind: 'unknown', substitution: null },
  ]);
  assert.deepEqual(req.points, [{ id: 'P1', type: 'antiderivative', expected: '2*x', followThrough: false, requireConstant: true, line: 1 }]);
  assert.equal(req.finalPoint, null);
  assert.equal(req.given, 'Integral(2*x, x)');
  const casLast = buildCheckRequest({ ...Q, given: undefined, points: [Q.points[0]] }, T, { lines: [], points: [] });
  assert.equal(casLast.finalPoint, 'P1');
  assert.equal(casLast.given, null);
  assert.equal(casLast.points[0].line, null);
});

const reply = { lines: [{ n: 1, parsed: true }], transitions: [{ to: 1, outcome: 'right' }], points: [{ id: 'P1', outcome: 'right', ftOutcome: null, ftRefused: false, note: null, line: 1 }], final: 'right' };

test('posts to CHECKER_URL/check with the shared secret', async () => {
  process.env.CHECKER_URL = 'http://checker.internal:8000/';
  process.env.CHECKER_SECRET = 's3cret';
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  const r = await callChecker(buildCheckRequest(Q, T, A));
  assert.deepEqual(r, { kind: 'ok', data: reply });
  assert.equal(seen[0].url, 'http://checker.internal:8000/check');
  assert.equal((seen[0].init.headers as Record<string, string>)['x-checker-secret'], 's3cret');
});

test('down: no URL, a non-200, a reply of the wrong shape, a network error', async () => {
  quiet();
  delete process.env.CHECKER_URL;
  assert.deepEqual(await callChecker(buildCheckRequest(Q, T, A)), { kind: 'down' });
  process.env.CHECKER_URL = 'http://checker.internal:8000';
  for (const res of [new Response('{}', { status: 504 }), new Response(JSON.stringify({ lines: [] }), { status: 200 }), new Response('not json', { status: 200 })]) {
    globalThis.fetch = (async () => res) as typeof fetch;
    assert.deepEqual(await callChecker(buildCheckRequest(Q, T, A)), { kind: 'down' });
  }
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  assert.deepEqual(await callChecker(buildCheckRequest(Q, T, A)), { kind: 'down' });
});

test('a reply without the line each point was settled on is refused', async () => {
  quiet();
  process.env.CHECKER_URL = 'http://checker.internal:8000';
  const old = { ...reply, points: [{ id: 'P1', outcome: 'right', ftOutcome: null, ftRefused: false, note: null }] };
  globalThis.fetch = (async () => new Response(JSON.stringify(old), { status: 200 })) as typeof fetch;
  assert.deepEqual(await callChecker(buildCheckRequest(Q, T, A)), { kind: 'down' });
});
