import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRedisCounter, type RedisLike } from '@/lib/guard/counter';
import { checkAndCharge } from '@/lib/guard/limits';

/** Fake ioredis: INCRBY plus EXPIRE ... NX inside multi/exec. */
function fakeRedis() {
  const vals = new Map<string, number>();
  const ttls = new Map<string, number>();
  const expireCalls: { key: string; ttl: number }[] = [];
  const client: RedisLike = {
    multi() {
      const ops: (() => unknown)[] = [];
      const m = {
        incrby(key: string, n: number) {
          ops.push(() => { const v = (vals.get(key) ?? 0) + n; vals.set(key, v); return v; });
          return m;
        },
        expire(key: string, ttl: number, mode: 'NX') {
          ops.push(() => {
            expireCalls.push({ key, ttl });
            if (mode === 'NX' && ttls.has(key)) return 0;
            ttls.set(key, ttl);
            return 1;
          });
          return m;
        },
        async exec() { return ops.map((f) => [null, f()] as [Error | null, unknown]); },
      };
      return m;
    },
    async get(key) { return vals.has(key) ? String(vals.get(key)) : null; },
  };
  return { client, vals, ttls, expireCalls };
}

test('first write sets the TTL, later writes leave it alone', async () => {
  const f = fakeRedis();
  const c = makeRedisCounter(f.client);
  assert.equal(await c.incrBy('k', 3, 100), 3);
  assert.equal(f.ttls.get('k'), 100);
  f.ttls.set('k', 42); // time passes
  assert.equal(await c.incrBy('k', 2, 100), 5);
  assert.equal(f.ttls.get('k'), 42);
});

test('get of a missing key is 0, and returns a number otherwise', async () => {
  const c = makeRedisCounter(fakeRedis().client);
  assert.equal(await c.get('nope'), 0);
  await c.incrBy('k', 4, 10);
  assert.equal(await c.get('k'), 4);
});

test('a failed command inside the transaction is thrown, not swallowed', async () => {
  const bad: RedisLike = {
    multi() {
      const m = { incrby: () => m, expire: () => m, exec: async () => [[new Error('boom'), null]] as [Error | null, unknown][] };
      return m;
    },
    get: async () => null,
  };
  await assert.rejects(makeRedisCounter(bad).incrBy('k', 1, 10), /boom/);
});

test('checkAndCharge enforces the per-visitor limit and refunds refused calls over the redis counter', async () => {
  const f = fakeRedis();
  const c = makeRedisCounter(f.client);
  const noon = new Date('2026-11-02T12:00:00Z');
  const o = { ipHash: 'a', costPence: 1, countsTowardRate: true, perVisitor: 3, perVisitorPence: 100_000, dailyCapPence: 1000, now: noon };
  for (let i = 0; i < 3; i++) assert.deepEqual(await checkAndCharge(c, o), { ok: true });
  assert.deepEqual(await checkAndCharge(c, o), { ok: false, reason: 'rate' });
  assert.equal(await c.get('spend:2026-11-02'), 3); // the refused call was not charged
  assert.equal(await c.get('rl:2026-11-02:a'), 3);
  assert.ok(f.ttls.has('rl:2026-11-02:a'));
});

import { redisCounter } from '@/lib/guard/counter';
test('redisCounter is lazy: no client until the first command, then one client reused', async () => {
  const f = fakeRedis();
  let made = 0;
  const c = redisCounter('redis://x', () => { made++; return f.client; });
  assert.equal(made, 0);
  await c.incrBy('k', 1, 10);
  await c.get('k');
  assert.equal(made, 1);
});
