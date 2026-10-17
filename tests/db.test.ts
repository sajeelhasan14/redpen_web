import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/pglite';
import {
  addToWaitlist, confirmWaitlist, upsertCompletedOrder, markRefunded, getOrder,
  countActiveOrders, setOrderBoard, bumpStat, unsubscribeWaitlist,
} from '@/lib/db';

test('waitlist: new, duplicate (case-insensitive), confirm', async () => {
  const q = await freshDb();
  const a = await addToWaitlist(q, { email: 'Parent@Example.com', role: 'parent', board: 'AQA', token: 't1' });
  assert.deepEqual(a, { created: true, confirmed: false, token: 't1' });
  const b = await addToWaitlist(q, { email: 'parent@example.com ', role: 'parent', board: null, token: 't2' });
  assert.deepEqual(b, { created: false, confirmed: false, token: 't1' });
  assert.equal(await confirmWaitlist(q, 't1'), true);
  assert.equal(await confirmWaitlist(q, 'nope'), false);
  const c = await addToWaitlist(q, { email: 'parent@example.com', role: 'parent', board: null, token: 't3' });
  assert.equal(c.confirmed, true);
});

test('orders: completed, repeated event, refund returns the pass', async () => {
  const q = await freshDb();
  const o = { txnId: 'txn_1', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' };
  await upsertCompletedOrder(q, o);
  await upsertCompletedOrder(q, o);
  assert.equal(await countActiveOrders(q), 1);
  await markRefunded(q, 'txn_1');
  assert.equal(await countActiveOrders(q), 0);
  assert.equal((await getOrder(q, 'txn_1'))?.status, 'refunded');
});

test('a refund that arrives first wins over a later completed event', async () => {
  const q = await freshDb();
  await markRefunded(q, 'txn_2');
  await upsertCompletedOrder(q, { txnId: 'txn_2', email: 'p@x.com', board: 'OCR', amountPence: 4900, currency: 'GBP' });
  const o = await getOrder(q, 'txn_2');
  assert.equal(o?.status, 'refunded');
  assert.equal(o?.email, 'p@x.com');
  assert.equal(await countActiveOrders(q), 0);
});

test('board can be set once, only on an existing order', async () => {
  const q = await freshDb();
  await upsertCompletedOrder(q, { txnId: 'txn_3', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  assert.equal(await setOrderBoard(q, 'txn_3', 'Edexcel'), true);
  assert.equal(await setOrderBoard(q, 'txn_3', 'AQA'), false);
  assert.equal(await setOrderBoard(q, 'txn_missing', 'AQA'), false);
  assert.equal((await getOrder(q, 'txn_3'))?.board, 'Edexcel');
});

test('unsubscribe by token', async () => {
  const q = await freshDb();
  await addToWaitlist(q, { email: 'u@x.com', role: 'parent', board: null, token: 'tu' });
  assert.equal(await unsubscribeWaitlist(q, 'tu'), true);
  assert.equal(await unsubscribeWaitlist(q, 'nope'), false);
  const [r] = await q('SELECT unsubscribed_at IS NOT NULL AS u FROM waitlist');
  assert.equal(r.u, true);
});

test('stats bump per day', async () => {
  const q = await freshDb();
  await bumpStat(q, '2026-11-02', 'checks');
  await bumpStat(q, '2026-11-02', 'checks');
  await bumpStat(q, '2026-11-02', 'teach_taps');
  const rows = await q('SELECT checks, teach_taps, errors_caught FROM demo_stats');
  assert.deepEqual(rows[0], { checks: 2, teach_taps: 1, errors_caught: 0 });
});

test('waitlist: course, school and exam date are kept, and a later join fills in what was missing without wiping what is there', async () => {
  const q = await freshDb();
  await addToWaitlist(q, { email: 's@example.edu', role: 'student', board: null, token: 't1', course: 'Calculus I', school: null, examDate: null });
  await addToWaitlist(q, { email: 's@example.edu', role: 'student', board: null, token: 't2', course: null, school: 'Ohio State', examDate: '2026-12-11' });
  const rows = await q('SELECT course, school, exam_date::text AS exam_date, token FROM waitlist');
  assert.deepEqual(rows, [{ course: 'Calculus I', school: 'Ohio State', exam_date: '2026-12-11', token: 't1' }]);
});
