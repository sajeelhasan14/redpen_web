import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { freshDb } from './helpers/pglite';
import { verifyPaddleSignature, parsePaddleEvent } from '@/lib/payments';
import { handleWebhook, passesLeft, handleGetOrder, handleSetBoard } from '@/lib/orders/handler';
import { upsertCompletedOrder } from '@/lib/db';

const SECRET = 'pdl_ntfset_test';
const sign = (body: string, ts: number, secret = SECRET) => `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;
const completed = (id: string, board?: string) =>
  JSON.stringify({
    event_type: 'transaction.completed',
    data: { id, customer_id: 'ctm_1', currency_code: 'GBP', custom_data: board ? { board } : null, details: { totals: { grand_total: '4900' } } },
  });
const refund = (txn: string) =>
  JSON.stringify({ event_type: 'adjustment.updated', data: { action: 'refund', status: 'approved', transaction_id: txn } });

test('signature: valid, wrong secret, stale, malformed, missing', () => {
  const b = completed('txn_1');
  assert.equal(verifyPaddleSignature(b, sign(b, 1000), SECRET, 1010), true);
  assert.equal(verifyPaddleSignature(b, sign(b, 1000, 'other'), SECRET, 1010), false);
  assert.equal(verifyPaddleSignature(b, sign(b, 1000), SECRET, 1000 + 301), false);
  assert.equal(verifyPaddleSignature(b, 'garbage', SECRET, 1000), false);
  assert.equal(verifyPaddleSignature(b, null, SECRET, 1000), false);
  assert.equal(verifyPaddleSignature(b + ' ', sign(b, 1000), SECRET, 1000), false);
});

test('event parsing', () => {
  assert.deepEqual(parsePaddleEvent(JSON.parse(completed('txn_1', 'AQA'))), {
    type: 'completed', txnId: 'txn_1', customerId: 'ctm_1', amountPence: 4900, currency: 'GBP', board: 'AQA',
  });
  assert.equal((parsePaddleEvent(JSON.parse(completed('txn_1', 'Bogus'))) as { board: unknown }).board, null);
  assert.deepEqual(parsePaddleEvent(JSON.parse(refund('txn_1'))), { type: 'refunded', txnId: 'txn_1' });
  assert.deepEqual(parsePaddleEvent({ event_type: 'adjustment.updated', data: { action: 'credit', status: 'approved', transaction_id: 't' } }), { type: 'ignored' });
  assert.deepEqual(parsePaddleEvent({ event_type: 'customer.created', data: {} }), { type: 'ignored' });
});

async function hook() {
  const q = await freshDb();
  const mails: string[] = [];
  const deps = { q, secret: SECRET, nowSec: () => 1000, emailFor: async () => 'parent@example.com', sendPurchase: async (e: string) => void mails.push(e) };
  const send = (b: string) => handleWebhook(b, sign(b, 1000), deps);
  return { q, deps, send, mails };
}

test('webhook: the purchase email is sent once, even when Paddle repeats the event', async () => {
  const { send, mails } = await hook();
  await send(completed('txn_m'));
  await send(completed('txn_m'));
  assert.deepEqual(mails, ['parent@example.com']);
});

test('webhook: a failed purchase email does not fail the webhook', async () => {
  const { deps } = await hook();
  const b = completed('txn_f');
  const r = await handleWebhook(b, sign(b, 1000), { ...deps, sendPurchase: async () => { throw new Error('resend down'); } });
  assert.equal(r.status, 200);
});

test('webhook: bad signature 401, completed recorded, repeat harmless, refund returns pass', async () => {
  const { q, deps, send } = await hook();
  assert.equal((await handleWebhook(completed('txn_1'), 'ts=1;h1=00', deps)).status, 401);
  assert.equal((await send(completed('txn_1'))).status, 200);
  assert.equal((await send(completed('txn_1'))).status, 200);
  assert.equal(await passesLeft(q, 200), 199);
  assert.equal((await send(refund('txn_1'))).status, 200);
  assert.equal(await passesLeft(q, 200), 200);
});

test('webhook: unknown events are acknowledged and ignored', async () => {
  const { send } = await hook();
  const b = JSON.stringify({ event_type: 'customer.updated', data: {} });
  assert.equal((await send(b)).status, 200);
});

test('webhook: a database failure returns 500 so Paddle retries', async () => {
  const { deps } = await hook();
  const b = completed('txn_9');
  const broken = { ...deps, q: async () => { throw new Error('db down'); } };
  assert.equal((await handleWebhook(b, sign(b, 1000), broken)).status, 500);
});

test('records orders beyond the cap and clamps passes-left at 0', async () => {
  const q = await freshDb();
  for (let i = 0; i < 3; i++) await upsertCompletedOrder(q, { txnId: `t${i}`, email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  assert.equal(await passesLeft(q, 2), 0);
  const [r] = await q('SELECT count(*)::int AS n FROM orders');
  assert.equal(r.n, 3);
});

test('returns 202 pending for an unknown transaction', async () => {
  const q = await freshDb();
  assert.equal((await handleGetOrder('txn_new', q)).status, 202);
  assert.equal((await handleGetOrder(null, q)).status, 400);
  await upsertCompletedOrder(q, { txnId: 'txn_new', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  const r = await handleGetOrder('txn_new', q);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: 'completed', board: null });
});

test('board can be set after purchase, once', async () => {
  const q = await freshDb();
  await upsertCompletedOrder(q, { txnId: 'txn_b', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  assert.equal((await handleSetBoard({ txnId: 'txn_b', board: 'OCR' }, q)).status, 200);
  assert.equal((await handleSetBoard({ txnId: 'txn_b', board: 'AQA' }, q)).status, 409);
  assert.equal((await handleSetBoard({ txnId: 'txn_b', board: 'Nope' }, q)).status, 400);
});

test('webhook: a failed customer lookup still records the paid order, without an email', async () => {
  const { q, deps } = await hook();
  const mails: string[] = [];
  const b = completed('txn_lk');
  const r = await handleWebhook(b, sign(b, 1000), {
    ...deps,
    emailFor: async () => { throw new Error('paddle 503'); },
    sendPurchase: async (e: string) => void mails.push(e),
  });
  assert.equal(r.status, 200);
  const [row] = await q(`SELECT status, email, amount_pence FROM orders WHERE paddle_txn_id = 'txn_lk'`);
  assert.deepEqual(row, { status: 'completed', email: '', amount_pence: 4900 });
  assert.equal(await passesLeft(q, 200), 199);
  assert.deepEqual(mails, []);
});

test('webhook: a later repeat fills in the email without clearing it again', async () => {
  const { q, deps, send } = await hook();
  await send(completed('txn_e'));
  const b = completed('txn_e');
  await handleWebhook(b, sign(b, 1000), { ...deps, emailFor: async () => { throw new Error('down'); } });
  const [row] = await q(`SELECT email FROM orders WHERE paddle_txn_id = 'txn_e'`);
  assert.equal(row.email, 'parent@example.com');
});

test('webhook: a refund that arrives before the completion keeps the order refunded', async () => {
  const { q, send, mails } = await hook();
  await send(refund('txn_rf'));
  await send(completed('txn_rf'));
  const [row] = await q(`SELECT status FROM orders WHERE paddle_txn_id = 'txn_rf'`);
  assert.equal(row.status, 'refunded');
  assert.equal(await passesLeft(q, 200), 200);
  assert.deepEqual(mails, []);
});

test('webhook: a non-numeric grand_total is recorded as 0', async () => {
  const { q, send } = await hook();
  const b = JSON.stringify({
    event_type: 'transaction.completed',
    data: { id: 'txn_nan', customer_id: 'ctm_1', currency_code: 'GBP', details: { totals: { grand_total: 'abc' } } },
  });
  assert.equal((await send(b)).status, 200);
  const [row] = await q(`SELECT amount_pence FROM orders WHERE paddle_txn_id = 'txn_nan'`);
  assert.equal(row.amount_pence, 0);
});
