import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCounter } from '@/lib/guard/counter';
import { addSpend, checkAndCharge, dayKey } from '@/lib/guard/limits';
import { clientIp, hashIp, ipRateKey } from '@/lib/guard/ip';
import { verifyTurnstile } from '@/lib/guard/turnstile';
import { signSession, verifySession } from '@/lib/guard/session';

const base = { ipHash: 'a', costPence: 1, countsTowardRate: true, perVisitor: 10, perVisitorPence: 100_000, dailyCapPence: 1000 };
const noon = new Date('2026-11-02T12:00:00Z');

test('the 11th check from one visitor in a day is rate-limited', async () => {
  const c = new MemoryCounter();
  for (let i = 0; i < 10; i++) assert.deepEqual(await checkAndCharge(c, { ...base, now: noon }), { ok: true });
  assert.deepEqual(await checkAndCharge(c, { ...base, now: noon }), { ok: false, reason: 'rate' });
  assert.deepEqual(await checkAndCharge(c, { ...base, ipHash: 'b', now: noon }), { ok: true });
});

test('calls that do not count toward the rate still spend', async () => {
  const c = new MemoryCounter();
  for (let i = 0; i < 20; i++) assert.deepEqual(await checkAndCharge(c, { ...base, countsTowardRate: false, now: noon }), { ok: true });
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 20);
});

test('the spend cap stops everyone once reached, without charging the refused call', async () => {
  const c = new MemoryCounter();
  const o = { ...base, costPence: 400, countsTowardRate: false, now: noon };
  assert.deepEqual(await checkAndCharge(c, o), { ok: true });
  assert.deepEqual(await checkAndCharge(c, o), { ok: true });
  assert.deepEqual(await checkAndCharge(c, o), { ok: false, reason: 'cap' }); // 1200 > 1000
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 800);
});

test('a rate-limited call is not charged', async () => {
  const c = new MemoryCounter();
  for (let i = 0; i < 10; i++) await checkAndCharge(c, { ...base, now: noon });
  await checkAndCharge(c, { ...base, now: noon });
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 10);
});

test('a new UTC day starts a fresh allowance', async () => {
  const c = new MemoryCounter();
  const late = new Date('2026-11-02T23:59:30Z');
  const early = new Date('2026-11-03T00:00:30Z');
  for (let i = 0; i < 10; i++) await checkAndCharge(c, { ...base, now: late });
  assert.deepEqual(await checkAndCharge(c, { ...base, now: late }), { ok: false, reason: 'rate' });
  assert.deepEqual(await checkAndCharge(c, { ...base, now: early }), { ok: true });
  assert.equal(await c.get(`spend:${dayKey(early)}`), 1);
});

test('client ip comes from the first x-forwarded-for entry, hashed with salt', () => {
  const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
  assert.equal(clientIp(h), '203.0.113.9');
  assert.equal(clientIp(new Headers()), 'unknown');
  assert.notEqual(hashIp('203.0.113.9', 's1'), hashIp('203.0.113.9', 's2'));
  assert.equal(hashIp('x', 's').length, 32);
});

test('turnstile: success, failure, missing token, and dev bypass', async () => {
  const ok = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;
  const bad = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
  assert.equal(await verifyTurnstile('t', '1.1.1.1', { secret: 's', fetchImpl: ok, production: true }), true);
  assert.equal(await verifyTurnstile('t', '1.1.1.1', { secret: 's', fetchImpl: bad, production: true }), false);
  assert.equal(await verifyTurnstile('', '1.1.1.1', { secret: 's', fetchImpl: ok, production: true }), false);
  assert.equal(await verifyTurnstile('', '1.1.1.1', { secret: '', production: false }), true);
  assert.equal(await verifyTurnstile('', '1.1.1.1', { secret: '', production: true }), false);
});

test('session cookie: valid, expired, tampered, wrong secret', () => {
  const now = 1_800_000_000_000;
  const v = signSession('sec', now);
  assert.equal(verifySession(v, 'sec', now + 1000), true);
  assert.equal(verifySession(v, 'sec', now + 25 * 3600_000), false);
  assert.equal(verifySession(v.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), 'sec', now), false);
  assert.equal(verifySession(v, 'other', now), false);
  assert.equal(verifySession(undefined, 'sec', now), false);
});

test('a parallel burst never records spend above the cap, and exactly the calls that fit succeed', async () => {
  const c = new MemoryCounter();
  const o = { ...base, costPence: 10, countsTowardRate: false, dailyCapPence: 100, now: noon };
  const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => checkAndCharge(c, { ...o, ipHash: `v${i}` })));
  assert.equal(rs.filter((r) => r.ok).length, 10);
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 100);
});

test('a parallel burst from one visitor gets exactly its 10 checks', async () => {
  const c = new MemoryCounter();
  const rs = await Promise.all(Array.from({ length: 50 }, () => checkAndCharge(c, { ...base, now: noon })));
  assert.equal(rs.filter((r) => r.ok).length, 10);
  assert.equal(await c.get(`rl:${dayKey(noon)}:a`), 10);
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 10);
});

test('the per-visitor pence budget refuses with reason rate and refunds everything', async () => {
  const c = new MemoryCounter();
  const lesson = { ...base, costPence: 3, countsTowardRate: false, perVisitorPence: 10, now: noon };
  for (let i = 0; i < 3; i++) assert.deepEqual(await checkAndCharge(c, lesson), { ok: true });
  assert.deepEqual(await checkAndCharge(c, lesson), { ok: false, reason: 'rate' }); // 12 > 10
  assert.equal(await c.get(`vb:${dayKey(noon)}:a`), 9);
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 9);
  // A check that would take the budget over is refused and its rate slot handed back.
  assert.deepEqual(await checkAndCharge(c, { ...base, costPence: 2, perVisitorPence: 10, now: noon }), { ok: false, reason: 'rate' });
  assert.equal(await c.get(`rl:${dayKey(noon)}:a`), 0);
  // Another visitor is unaffected.
  assert.deepEqual(await checkAndCharge(c, { ...lesson, ipHash: 'b' }), { ok: true });
});

test('a cap refusal also refunds the rate slot and visitor budget', async () => {
  const c = new MemoryCounter();
  assert.deepEqual(await checkAndCharge(c, { ...base, costPence: 5, dailyCapPence: 4, now: noon }), { ok: false, reason: 'cap' });
  assert.equal(await c.get(`rl:${dayKey(noon)}:a`), 0);
  assert.equal(await c.get(`vb:${dayKey(noon)}:a`), 0);
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 0);
});

test('addSpend records the true-up against spend and the visitor budget', async () => {
  const c = new MemoryCounter();
  await addSpend(c, { ipHash: 'a', pence: 7, now: noon });
  await addSpend(c, { ipHash: 'a', pence: -3, now: noon });
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 7);
  assert.equal(await c.get(`vb:${dayKey(noon)}:a`), 7);
});

test('client ip prefers x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for', () => {
  const all = new Headers({ 'x-vercel-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '6.6.6.6, 198.51.100.3' });
  assert.equal(clientIp(all), '198.51.100.1');
  assert.equal(clientIp(new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '6.6.6.6' })), '198.51.100.2');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1' })), '6.6.6.6');
});

test('IPv6 addresses are keyed on their /64; IPv4 is unchanged', () => {
  const k = ipRateKey('2001:db8:abcd:12:1::5');
  assert.equal(k, '2001:db8:abcd:12::/64');
  assert.equal(ipRateKey('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff'), k);
  assert.equal(ipRateKey('[2001:db8:abcd:12::9]'), k);
  assert.notEqual(ipRateKey('2001:db8:abcd:13::1'), k);
  assert.equal(ipRateKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipRateKey('::1'), '0:0:0:0::/64');
  assert.equal(ipRateKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipRateKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipRateKey('unknown'), 'unknown');
});

test('GET /api/session reports whether the rp_session cookie verifies', async () => {
  const { GET } = await import('@/app/api/session/route');
  const prev = { secret: process.env.SESSION_SECRET, open: process.env.DEMO_DEV_OPEN };
  process.env.SESSION_SECRET = 'gate-secret';
  delete process.env.DEMO_DEV_OPEN;
  try {
    const ask = async (cookie?: string) =>
      (await (await GET(new Request('http://x/api/session', { headers: cookie ? { cookie } : {} }))).json()) as { ok: boolean };
    assert.deepEqual(await ask(), { ok: false });
    assert.deepEqual(await ask(`rp_session=${signSession('gate-secret', Date.now())}`), { ok: true });
    assert.deepEqual(await ask(`other=1; rp_session=${signSession('wrong', Date.now())}`), { ok: false });
    assert.deepEqual(await ask(`rp_session=${signSession('gate-secret', Date.now() - 25 * 3600_000)}`), { ok: false });
  } finally {
    if (prev.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prev.secret;
    if (prev.open !== undefined) process.env.DEMO_DEV_OPEN = prev.open;
  }
});
