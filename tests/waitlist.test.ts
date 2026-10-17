import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/pglite';
import { handleJoin, handleConfirm } from '@/lib/waitlist/handler';
import { MemoryCounter, type Counter } from '@/lib/guard/counter';

const ok = { ipHash: 'ip-a', sessionOk: true };
const noSession = { ipHash: 'ip-a', sessionOk: false };
const MIN = 60_000;

async function setup() {
  const q = await freshDb();
  const sent: { to: string; html: string }[] = [];
  let n = 0;
  const clock = { t: Date.parse('2026-11-02T12:00:00Z') };
  const deps = {
    q,
    send: async (to: string, _s: string, html: string) => void sent.push({ to, html }),
    siteUrl: 'https://redpenmaths.com',
    newToken: () => `tok${++n}`,
    counter: new MemoryCounter() as Counter,
    now: () => new Date(clock.t),
  };
  return { q, sent, deps, clock };
}

test('invalid email → 400, missing session → 403 and nothing sent', async () => {
  const { deps, sent } = await setup();
  assert.equal((await handleJoin({ email: 'nope', role: 'parent' }, ok, deps)).status, 400);
  const denied = await handleJoin({ email: 'a@b.co', role: 'parent' }, noSession, deps);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.json, { error: 'Please retry.' });
  assert.equal(sent.length, 0);
});

test('valid session is accepted without any Turnstile token', async () => {
  const { deps, sent } = await setup();
  const r = await handleJoin({ email: 'a@b.co', role: 'parent' }, ok, deps);
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
});

test('join sends one confirm email with a working link', async () => {
  const { deps, sent } = await setup();
  const r = await handleJoin({ email: 'Mum@Example.com', role: 'parent', board: 'AQA' }, ok, deps);
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'mum@example.com');
  assert.match(sent[0].html, /https:\/\/redpenmaths\.com\/api\/waitlist\/confirm\?token=tok1/);
  assert.equal(await handleConfirm('tok1', deps), 'https://redpenmaths.com/?waitlist=confirmed#waitlist');
  assert.equal(await handleConfirm('bogus', deps), 'https://redpenmaths.com/?waitlist=invalid#waitlist');
});

test('re-joining unconfirmed resends; re-joining confirmed sends nothing; both look the same to the visitor', async () => {
  const { deps, sent, clock } = await setup();
  await handleJoin({ email: 'a@b.co', role: 'student' }, ok, deps);
  clock.t += 11 * MIN; // past the per-address cooldown
  const again = await handleJoin({ email: 'A@B.co', role: 'student' }, ok, deps);
  assert.equal(sent.length, 2);
  assert.match(sent[1].html, /token=tok1/);
  await handleConfirm('tok1', deps);
  const third = await handleJoin({ email: 'a@b.co', role: 'student' }, ok, deps);
  assert.equal(sent.length, 2);
  assert.deepEqual(again.json, third.json);
});

test('the monthly update template always carries the unsubscribe link', async () => {
  const { buildUpdateEmail } = await import('@/lib/email');
  const m = buildUpdateEmail('<p>News</p>', 'https://redpenmaths.com/api/waitlist/unsubscribe?token=abc');
  assert.match(m.html, /Unsubscribe/);
  assert.match(m.html, /token=abc/);
});

test('a sign-up is a student unless it says otherwise; unknown role and board are normalised', async () => {
  const { deps, q } = await setup();
  await handleJoin({ email: 'c@d.co', role: 'admin', board: 'Hacked' }, ok, deps);
  await handleJoin({ email: 'e@f.co' }, ok, deps);
  const rows = await q('SELECT role, board FROM waitlist ORDER BY id');
  assert.deepEqual(rows, [{ role: 'student', board: null }, { role: 'student', board: null }]);
});

const details = (q: Awaited<ReturnType<typeof setup>>['q']) => q('SELECT course, school, exam_date::text AS exam_date FROM waitlist ORDER BY id');

test('course, school and exam date are stored', async () => {
  const { deps, q } = await setup();
  await handleJoin({ email: 'a@umich.edu', course: 'Calculus I', school: '  University of Michigan ', examDate: '2026-12-14' }, ok, deps);
  assert.deepEqual(await details(q), [{ course: 'Calculus I', school: 'University of Michigan', exam_date: '2026-12-14' }]);
});

test('an unknown course, an over-long school and an impossible or far-off exam date are dropped, not refused', async () => {
  const { deps, q } = await setup();
  const cases = [
    { email: 'a@b.co', course: 'Hacking 101', school: 'x'.repeat(300), examDate: 'soon' },
    { email: 'c@d.co', course: 7, school: '<b>MIT</b>\u0000', examDate: '2026-02-30' },
    { email: 'e@f.co', examDate: '2020-01-01' },
    { email: 'g@h.co', examDate: '2031-01-01' },
    { email: 'i@j.co', school: '   ' },
  ];
  for (const c of cases) assert.equal((await handleJoin(c, ok, deps)).status, 200);
  assert.deepEqual(await details(q), [
    { course: null, school: 'x'.repeat(120), exam_date: null },
    { course: null, school: '<b>MIT</b>', exam_date: null },
    { course: null, school: null, exam_date: null },
    { course: null, school: null, exam_date: null },
    { course: null, school: null, exam_date: null },
  ]);
});

test('joining again with an exam date fills it in without sending a second email inside the cooldown', async () => {
  const { deps, q, sent } = await setup();
  await handleJoin({ email: 'a@b.co' }, ok, deps);
  await handleJoin({ email: 'a@b.co', course: 'Calculus I', examDate: '2026-12-10' }, ok, deps);
  assert.deepEqual(await details(q), [{ course: 'Calculus I', school: null, exam_date: '2026-12-10' }]);
  assert.equal(sent.length, 1);
});

test('the 6th join from one connection in an hour → 429 and nothing sent', async () => {
  const { deps, sent } = await setup();
  for (let i = 1; i <= 5; i++) assert.equal((await handleJoin({ email: `p${i}@b.co` }, ok, deps)).status, 200);
  const sixth = await handleJoin({ email: 'p6@b.co' }, ok, deps);
  assert.equal(sixth.status, 429);
  assert.deepEqual(sixth.json, { error: 'Too many sign-ups from this connection. Please try again later.' });
  assert.equal(sent.length, 5);
  // Another connection is unaffected.
  assert.equal((await handleJoin({ email: 'p7@b.co' }, { ipHash: 'ip-b', sessionOk: true }, deps)).status, 200);
});

test('the hourly connection limit resets in the next hour', async () => {
  const { deps, clock } = await setup();
  for (let i = 1; i <= 5; i++) await handleJoin({ email: `h${i}@b.co` }, ok, deps);
  clock.t += 60 * MIN;
  assert.equal((await handleJoin({ email: 'h6@b.co' }, ok, deps)).status, 200);
});

test('one confirmation email per address per 10 minutes; same reply either way; sends again after', async () => {
  const { deps, sent, clock } = await setup();
  const first = await handleJoin({ email: 'Kid@B.co' }, ok, deps);
  clock.t += 9 * MIN;
  const second = await handleJoin({ email: 'kid@b.co' }, { ipHash: 'ip-other', sessionOk: true }, deps);
  assert.equal(second.status, 200);
  assert.deepEqual(second.json, first.json);
  assert.equal(sent.length, 1);
  clock.t += 2 * MIN; // 11 minutes after the first send
  assert.equal((await handleJoin({ email: 'kid@b.co' }, ok, deps)).status, 200);
  assert.equal(sent.length, 2);
});

test('rate-limit keys never contain the raw email address', async () => {
  const { deps } = await setup();
  const keys: string[] = [];
  const inner = deps.counter;
  deps.counter = Object.assign(Object.create(inner), {
    incrBy: (k: string, n: number, t: number) => (keys.push(k), inner.incrBy(k, n, t)),
    get: (k: string) => (keys.push(k), inner.get(k)),
  });
  await handleJoin({ email: 'secret.person@b.co' }, ok, deps);
  assert.ok(keys.length > 0);
  assert.ok(keys.every((k) => !/secret|person|@/.test(k)), keys.join(','));
});

test('a failed send gives the address slot back', async () => {
  const { deps, sent } = await setup();
  const real = deps.send;
  deps.send = async () => { throw new Error('resend down'); };
  await assert.rejects(handleJoin({ email: 'f@b.co' }, ok, deps));
  deps.send = real;
  await handleJoin({ email: 'f@b.co' }, ok, deps);
  assert.equal(sent.length, 1);
});
