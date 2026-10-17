import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertProdEnv, REQUIRED_IN_PRODUCTION } from '@/lib/env';

const full: Record<string, string> = { ...Object.fromEntries(REQUIRED_IN_PRODUCTION.map((k) => [k, 'set'])), ANTHROPIC_API_KEY: 'set' };

test('production refuses to start without required config, naming what is missing', () => {
  assert.throws(
    () => assertProdEnv({ ...full, NODE_ENV: 'production', IP_SALT: '', SESSION_SECRET: undefined }),
    (e: Error) => /IP_SALT/.test(e.message) && /SESSION_SECRET/.test(e.message) && !/DATABASE_URL/.test(e.message),
  );
  assert.throws(() => assertProdEnv({ NODE_ENV: 'production' }), (e: Error) => REQUIRED_IN_PRODUCTION.every((k) => e.message.includes(k)));
});

test('production with everything set passes', () => {
  assert.doesNotThrow(() => assertProdEnv({ ...full, NODE_ENV: 'production' }));
});

test('outside production it is a no-op', () => {
  assert.doesNotThrow(() => assertProdEnv({ NODE_ENV: 'development' }));
  assert.doesNotThrow(() => assertProdEnv({}));
});

test('production requires REDIS_URL and no longer the Upstash variables', () => {
  assert.ok((REQUIRED_IN_PRODUCTION as readonly string[]).includes('REDIS_URL'));
  assert.ok(!REQUIRED_IN_PRODUCTION.some((k) => k.startsWith('UPSTASH')));
  const { REDIS_URL: _omit, ...rest } = full;
  assert.throws(() => assertProdEnv({ ...rest, NODE_ENV: 'production' }), /REDIS_URL/);
});

test('Paddle vars are only required when payments are enabled', () => {
  const { PADDLE_WEBHOOK_SECRET: _a, PADDLE_API_KEY: _b, ...noPaddle } = { ...full, PADDLE_WEBHOOK_SECRET: '', PADDLE_API_KEY: '' };
  assert.doesNotThrow(() => assertProdEnv({ ...noPaddle, NODE_ENV: 'production' }));
  assert.doesNotThrow(() => assertProdEnv({ ...noPaddle, NODE_ENV: 'production', NEXT_PUBLIC_PAYMENTS_ENABLED: '' }));
  assert.throws(
    () => assertProdEnv({ ...noPaddle, NODE_ENV: 'production', NEXT_PUBLIC_PAYMENTS_ENABLED: '1' }),
    /PADDLE_WEBHOOK_SECRET.*PADDLE_API_KEY/,
  );
});
