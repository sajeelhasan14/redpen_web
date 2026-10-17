import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAI, openAIRequest, strictJsonSchema, OPENAI_URL, DEFAULT_OPENAI_MODEL } from '@/lib/mark/openai';
import { anthropicClient, callAnthropic } from '@/lib/mark/anthropic';
import { modelFor } from '@/lib/mark/provider';
import { ReplyPlain } from '@/lib/mark/schema';
import { config, markProvider, markTimeoutMs } from '@/lib/config';
import { assertProdEnv, REQUIRED_IN_PRODUCTION } from '@/lib/env';

const realFetch = globalThis.fetch;
const realError = console.error;
const saved = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  for (const k of ['MARK_PROVIDER', 'MARK_MODEL_OPENAI', 'MARK_EFFORT_OPENAI', 'OPENAI_API_KEY', 'PRICE_IN_PER_MTOK_GBP_OPENAI', 'PRICE_OUT_PER_MTOK_GBP_OPENAI', 'MARK_TIMEOUT_MS', 'MARK_LESSON_TIMEOUT_MS'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

const args = { system: 'SYS', instruction: 'INSTR', base64: 'iVBORw0KGgo=', lesson: false };
const goodReply = { worthResponding: true, correct: false, speech: 'Check the sign.', annotations: [{ kind: 'strike', x1: 1, y1: 2, x2: 3, y2: 4 }] };
const done = (text: string, extra: object = {}) => ({
  model: 'gpt-5.4-mini-2026-03-17',
  status: 'completed',
  output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 1200, output_tokens: 230, output_tokens_details: { reasoning_tokens: 130 } },
  ...extra,
});

type Seen = { url: string; init: RequestInit };
function stub(status: number, body: unknown, seen: Seen[] = []) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return seen;
}
const quiet = (logged: string[] = []) => {
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  return logged;
};

test('request: Responses API, image + instruction, strict schema, effort, no store', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.MARK_MODEL_OPENAI = 'gpt-test';
  const seen = stub(200, done(JSON.stringify(goodReply)));
  await callOpenAI(args);
  assert.equal(seen[0].url, OPENAI_URL);
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer sk-test');
  const b = JSON.parse(String(seen[0].init.body));
  assert.equal(b.model, 'gpt-test');
  assert.equal(b.instructions, 'SYS');
  assert.deepEqual(b.input[0].content[0], { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'high' });
  assert.deepEqual(b.input[0].content[1], { type: 'input_text', text: 'INSTR' });
  assert.equal(b.text.format.type, 'json_schema');
  assert.equal(b.text.format.strict, true);
  assert.equal(b.text.format.name, 'reply');
  assert.equal(b.reasoning.effort, 'low');
  assert.equal(b.max_output_tokens, 4096);
  assert.equal(b.store, false);
  assert.equal('temperature' in b, false);
});

test('lessons use the lesson schema and medium effort; MARK_EFFORT_OPENAI only tunes checks', () => {
  process.env.MARK_EFFORT_OPENAI = 'medium';
  assert.equal(openAIRequest(args, 'm').reasoning.effort, 'medium');
  process.env.MARK_EFFORT_OPENAI = 'nonsense';
  assert.equal(openAIRequest(args, 'm').reasoning.effort, 'low');
  const l = openAIRequest({ ...args, lesson: true }, 'm');
  assert.equal(l.text.format.name, 'lesson');
  assert.equal(l.reasoning.effort, 'medium');
  assert.ok('steps' in (l.text.format.schema as { properties: object }).properties);
});

test('the model defaults when MARK_MODEL_OPENAI is unset', async () => {
  delete process.env.MARK_MODEL_OPENAI;
  const seen = stub(200, done(JSON.stringify(goodReply)));
  await callOpenAI(args);
  assert.equal(JSON.parse(String(seen[0].init.body)).model, DEFAULT_OPENAI_MODEL);
});

test('schema: no oneOf or $schema anywhere (strict mode rejects oneOf), anyOf for annotations', () => {
  const s = JSON.stringify(strictJsonSchema(ReplyPlain));
  assert.ok(!s.includes('"oneOf"'));
  assert.ok(!s.includes('$schema'));
  assert.ok(s.includes('"anyOf"'));
  assert.ok(s.includes('"additionalProperties":false'));
});

test('a valid reply is parsed, with usage and model', async () => {
  stub(200, done(JSON.stringify(goodReply)));
  const r = await callOpenAI(args);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(r.parsed, goodReply);
  assert.deepEqual(r.usage, { input: 1200, output: 230 });
  assert.equal(r.tokens, '1200/230');
  assert.equal(r.model, 'gpt-5.4-mini-2026-03-17');
});

test('a valid lesson is parsed', async () => {
  const lesson = { steps: [{ say: 'Expand the bracket.', write: [{ kind: 'write', x: 10, y: 20, text: '3x − 6', size: 'normal' }] }] };
  stub(200, done(JSON.stringify(lesson)));
  const r = await callOpenAI({ ...args, lesson: true });
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.deepEqual(r.parsed, lesson);
});

test('refusal content → refusal; content filter → refusal', async () => {
  stub(200, { ...done(''), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] });
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'refusal' });
  stub(200, { ...done(''), status: 'incomplete', incomplete_details: { reason: 'content_filter' } });
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'refusal' });
});

test('cut off at max_output_tokens → max_tokens', async () => {
  stub(200, { ...done('{"worthResponding'), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'max_tokens' });
});

test('unparseable or off-schema output → invalid', async () => {
  stub(200, done('not json'));
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'invalid' });
  stub(200, done(JSON.stringify({ worthResponding: true })));
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'invalid' });
  stub(200, { ...done(''), output: [] });
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'invalid' });
});

test('HTTP errors and network errors → api, logged by message only (no key, prompt or image)', async () => {
  process.env.OPENAI_API_KEY = 'sk-secret-key';
  const logged = quiet();
  stub(429, { error: { message: 'You exceeded your current quota' } });
  assert.deepEqual(await callOpenAI({ ...args, system: 'SECRET-PROMPT' }), { kind: 'fail', reason: 'api' });
  globalThis.fetch = (async () => {
    throw new Error('socket hang up');
  }) as typeof fetch;
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'api' });
  stub(200, { ...done(''), status: 'failed', error: { message: 'server_error' } });
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'api' });
  const all = logged.join('\n');
  assert.match(all, /429: You exceeded your current quota/);
  assert.match(all, /socket hang up/);
  for (const secret of ['sk-secret-key', 'SECRET-PROMPT', 'iVBORw0KGgo', 'INSTR']) assert.ok(!all.includes(secret), secret);
});

test('provider selection: anthropic by default, openai when MARK_PROVIDER=openai', () => {
  assert.equal(markProvider({}), 'anthropic');
  assert.equal(markProvider({ MARK_PROVIDER: 'anthropic' }), 'anthropic');
  assert.equal(markProvider({ MARK_PROVIDER: ' OpenAI ' }), 'openai');
  assert.equal(modelFor({}), callAnthropic);
  assert.equal(modelFor({ MARK_PROVIDER: 'openai' }), callOpenAI);
});

test('true-up prices follow the provider', () => {
  delete process.env.MARK_PROVIDER;
  const a = config();
  assert.equal(a.provider, 'anthropic');
  process.env.MARK_PROVIDER = 'openai';
  process.env.PRICE_IN_PER_MTOK_GBP_OPENAI = '0.5';
  process.env.PRICE_OUT_PER_MTOK_GBP_OPENAI = '2';
  const o = config();
  assert.equal(o.provider, 'openai');
  assert.deepEqual(o.prices, { inPerMTokGbp: 0.5, outPerMTokGbp: 2 });
  assert.notDeepEqual(o.prices, a.prices);
});

test('production requires the key of the provider in use, and only that one', () => {
  const base = { ...Object.fromEntries(REQUIRED_IN_PRODUCTION.map((k) => [k, 'set'])), NODE_ENV: 'production' };
  assert.throws(() => assertProdEnv(base), /ANTHROPIC_API_KEY/);
  assert.doesNotThrow(() => assertProdEnv({ ...base, ANTHROPIC_API_KEY: 'k' }));
  assert.throws(() => assertProdEnv({ ...base, MARK_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'k' }), (e: Error) => /OPENAI_API_KEY/.test(e.message) && !/ANTHROPIC/.test(e.message));
  assert.doesNotThrow(() => assertProdEnv({ ...base, MARK_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }));
  assert.throws(() => assertProdEnv({ ...base, MARK_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'k' }), /MARK_PROVIDER/);
});

test('a call that times out (AbortError) → api; the request carries an abort signal', async () => {
  const logged = quiet();
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }) as typeof fetch;
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'api' });
  assert.ok(seen[0].init.signal instanceof AbortSignal);
  globalThis.fetch = (async () => {
    throw new DOMException('This operation was aborted', 'AbortError');
  }) as typeof fetch;
  assert.deepEqual(await callOpenAI(args), { kind: 'fail', reason: 'api' });
  assert.match(logged.join('\n'), /aborted/);
});

test('the marking timeout is 20 s by default (lessons 45 s) and env-overridable; Anthropic retries at most once', () => {
  delete process.env.MARK_TIMEOUT_MS;
  delete process.env.MARK_LESSON_TIMEOUT_MS;
  assert.equal(markTimeoutMs(), 20_000);
  assert.equal(markTimeoutMs(true), 45_000);
  process.env.MARK_LESSON_TIMEOUT_MS = '60000';
  assert.equal(markTimeoutMs(true), 60_000);
  delete process.env.MARK_LESSON_TIMEOUT_MS;
  process.env.MARK_TIMEOUT_MS = '45000';
  assert.equal(markTimeoutMs(), 45_000);
  process.env.MARK_TIMEOUT_MS = 'soon';
  assert.equal(markTimeoutMs(), 20_000);
  delete process.env.MARK_TIMEOUT_MS;
  assert.equal(anthropicClient.timeout, 20_000);
  assert.equal(anthropicClient.maxRetries, 1);
});

test('production: an OpenAI model other than the default must bring its own prices', () => {
  const base = { ...Object.fromEntries(REQUIRED_IN_PRODUCTION.map((k) => [k, 'set'])), NODE_ENV: 'production', MARK_PROVIDER: 'openai', OPENAI_API_KEY: 'k' };
  assert.doesNotThrow(() => assertProdEnv(base));
  assert.doesNotThrow(() => assertProdEnv({ ...base, MARK_MODEL_OPENAI: DEFAULT_OPENAI_MODEL }));
  assert.throws(
    () => assertProdEnv({ ...base, MARK_MODEL_OPENAI: 'gpt-7' }),
    (e: Error) => /PRICE_IN_PER_MTOK_GBP_OPENAI/.test(e.message) && /PRICE_OUT_PER_MTOK_GBP_OPENAI/.test(e.message),
  );
  assert.throws(() => assertProdEnv({ ...base, MARK_MODEL_OPENAI: 'gpt-7', PRICE_IN_PER_MTOK_GBP_OPENAI: '1' }), /PRICE_OUT_PER_MTOK_GBP_OPENAI/);
  assert.doesNotThrow(() => assertProdEnv({ ...base, MARK_MODEL_OPENAI: 'gpt-7', PRICE_IN_PER_MTOK_GBP_OPENAI: '1', PRICE_OUT_PER_MTOK_GBP_OPENAI: '4' }));
  // Only production, and only when OpenAI marks.
  assert.doesNotThrow(() => assertProdEnv({ ...base, NODE_ENV: 'development', MARK_MODEL_OPENAI: 'gpt-7' }));
  assert.doesNotThrow(() => assertProdEnv({ ...base, MARK_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', MARK_MODEL_OPENAI: 'gpt-7' }));
});
