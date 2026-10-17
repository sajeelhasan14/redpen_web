import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { anthropicEngineModel, engineModelFor, engineTimeoutMs, openAIEngineModel, openAIEngineRequest, withRetry, type EngineModelArgs } from '@/lib/engine/model';
import { anthropicClient } from '@/lib/mark/anthropic';
import { DEFAULT_OPENAI_MODEL } from '@/lib/config';

const realFetch = globalThis.fetch;
const realError = console.error;
const realParse = anthropicClient.messages.parse;
const saved = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  anthropicClient.messages.parse = realParse;
  for (const k of ['MARK_PROVIDER', 'MARK_MODEL_OPENAI', 'ENGINE_MODEL_READER', 'ENGINE_EFFORT', 'ENGINE_TIMEOUT_MS', 'OPENAI_API_KEY'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});
const quiet = () => void (console.error = () => {});

const Out = z.object({ ok: z.boolean(), note: z.string().nullable() });
const args: EngineModelArgs<z.infer<typeof Out>> = {
  role: 'reader',
  system: 'SYS',
  instruction: 'INSTR',
  images: [
    { mediaType: 'image/jpeg', base64: 'AAAA' },
    { mediaType: 'image/png', base64: 'BBBB' },
  ],
  schema: Out,
};
const done = (text: string) => ({ model: 'gpt-x', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 900, output_tokens: 120 } });
const stub = (status: number, body: unknown, seen: RequestInit[] = []) => {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return seen;
};

test('openai request: every image then the text, strict schema named for the role, no store', () => {
  const r = openAIEngineRequest(args, 'gpt-x');
  assert.deepEqual(r.input[0].content, [
    { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA', detail: 'high' },
    { type: 'input_image', image_url: 'data:image/png;base64,BBBB', detail: 'high' },
    { type: 'input_text', text: 'INSTR' },
  ]);
  assert.equal(r.instructions, 'SYS');
  assert.equal(r.text.format.name, 'reader');
  assert.equal(r.text.format.strict, true);
  assert.equal(r.store, false);
  assert.equal(r.reasoning.effort, 'low');
  assert.ok(!JSON.stringify(r.text.format.schema).includes('oneOf'));
});

test('openai: the role model overrides the marking model, which overrides the default', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  const seen = stub(200, done('{"ok":true,"note":null}'));
  await openAIEngineModel(args);
  process.env.MARK_MODEL_OPENAI = 'gpt-mark';
  await openAIEngineModel(args);
  process.env.ENGINE_MODEL_READER = 'gpt-reader';
  await openAIEngineModel(args);
  assert.deepEqual(seen.map((i) => JSON.parse(String(i.body)).model), [DEFAULT_OPENAI_MODEL, 'gpt-mark', 'gpt-reader']);
  assert.equal((seen[0].headers as Record<string, string>).Authorization, 'Bearer sk-test');
});

test('openai ok: parsed data and usage', async () => {
  stub(200, done('{"ok":true,"note":"x"}'));
  assert.deepEqual(await openAIEngineModel(args), { kind: 'ok', data: { ok: true, note: 'x' }, model: 'gpt-x', usage: { input: 900, output: 120 } });
});

test('openai failures map to a reason', async () => {
  quiet();
  const cases: [number, unknown, string][] = [
    [500, { error: { message: 'boom' } }, 'api'],
    [200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'max_tokens'],
    [200, { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'refusal'],
    [200, { status: 'failed' }, 'api'],
    [200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'refusal'],
    [200, done('not json'), 'invalid'],
    [200, done('{"ok":"yes"}'), 'invalid'],
    [200, { status: 'completed', output: [] }, 'invalid'],
  ];
  for (const [status, body, reason] of cases) {
    stub(status, body);
    assert.deepEqual(await openAIEngineModel(args), { kind: 'fail', reason });
  }
  globalThis.fetch = (async () => {
    throw new Error('timeout');
  }) as typeof fetch;
  assert.deepEqual(await openAIEngineModel(args), { kind: 'fail', reason: 'api' });
});

test('anthropic: images then text, parsed output validated, failures mapped', async () => {
  quiet();
  const seen: unknown[] = [];
  const reply = (over: object) =>
    (async (body: unknown) => {
      seen.push(body);
      return { stop_reason: 'end_turn', parsed_output: { ok: true, note: null }, model: 'claude-x', usage: { input_tokens: 5, output_tokens: 7 }, ...over };
    }) as unknown as typeof anthropicClient.messages.parse;
  anthropicClient.messages.parse = reply({});
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'ok', data: { ok: true, note: null }, model: 'claude-x', usage: { input: 5, output: 7 } });
  const content = (seen[0] as { messages: { content: { type: string }[] }[] }).messages[0].content;
  assert.deepEqual(content.map((c) => c.type), ['image', 'image', 'text']);
  anthropicClient.messages.parse = reply({ stop_reason: 'refusal' });
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'refusal' });
  anthropicClient.messages.parse = reply({ stop_reason: 'max_tokens' });
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'max_tokens' });
  anthropicClient.messages.parse = reply({ parsed_output: null });
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'invalid' });
  anthropicClient.messages.parse = (async () => {
    throw new Error('503');
  }) as unknown as typeof anthropicClient.messages.parse;
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'api' });
});

test('provider switch and timeout', () => {
  assert.equal(engineModelFor({ MARK_PROVIDER: 'openai' }), openAIEngineModel);
  assert.equal(engineModelFor({}), anthropicEngineModel);
  assert.equal(engineTimeoutMs(), 60_000);
  process.env.ENGINE_TIMEOUT_MS = '5000';
  assert.equal(engineTimeoutMs(), 5000);
  process.env.ENGINE_TIMEOUT_MS = 'soon';
  assert.equal(engineTimeoutMs(), 60_000);
});

test('withRetry: one retry after a failure, none after success', async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? ({ kind: 'fail', reason: 'api' } as const) : ({ kind: 'ok', data: 1, model: 'm', usage: { input: 0, output: 0 } } as const));
  assert.equal((await withRetry(flaky)).kind, 'ok');
  assert.equal(calls, 2);
  calls = 0;
  const dead = async () => (calls++, { kind: 'fail', reason: 'refusal' } as const);
  assert.deepEqual(await withRetry(dead), { kind: 'fail', reason: 'refusal' });
  assert.equal(calls, 2);
  calls = 0;
  const fine = async () => (calls++, { kind: 'ok', data: 1, model: 'm', usage: { input: 0, output: 0 } } as const);
  await withRetry(fine);
  assert.equal(calls, 1);
});
