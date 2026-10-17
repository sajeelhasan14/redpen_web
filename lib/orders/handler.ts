import { countActiveOrders, getOrder, markRefunded, setOrderBoard, setOrderEmail, upsertCompletedOrder, BOARDS, type Board, type Query } from '@/lib/db';
import { parsePaddleEvent, verifyPaddleSignature } from '@/lib/payments';
import type { HandlerResult } from '@/lib/http';

export async function handleWebhook(
  raw: string,
  sigHeader: string | null,
  deps: { q: Query; secret: string; nowSec: () => number; emailFor: (customerId: string) => Promise<string>; sendPurchase: (email: string) => Promise<void> },
): Promise<HandlerResult> {
  if (!verifyPaddleSignature(raw, sigHeader, deps.secret, deps.nowSec())) return { status: 401, json: { error: 'bad signature' } };
  let ev;
  try {
    ev = parsePaddleEvent(JSON.parse(raw));
  } catch {
    return { status: 400, json: { error: 'bad json' } };
  }
  try {
    if (ev.type === 'completed') {
      const before = await getOrder(deps.q, ev.txnId);
      // Record the paid order first: a failed customer lookup must never lose it.
      await upsertCompletedOrder(deps.q, { txnId: ev.txnId, email: '', board: ev.board, amountPence: ev.amountPence, currency: ev.currency });
      let email = '';
      try {
        email = await deps.emailFor(ev.customerId);
      } catch (e) {
        console.error('customer lookup failed', e instanceof Error ? e.message : e);
      }
      if (email) await setOrderEmail(deps.q, ev.txnId, email);
      // First sighting only: Paddle retries and repeats events.
      if (!before && email) await deps.sendPurchase(email).catch((e) => console.error('purchase email failed', e instanceof Error ? e.message : e));
    } else if (ev.type === 'refunded') {
      await markRefunded(deps.q, ev.txnId);
    }
    return { status: 200, json: { ok: true } };
  } catch (e) {
    console.error('webhook failed', e instanceof Error ? e.message : e);
    return { status: 500, json: { error: 'retry' } }; // Paddle retries non-2xx
  }
}

/** Never negative: a race on the last pass records both orders and shows 0. */
export async function passesLeft(q: Query, cap: number): Promise<number> {
  return Math.max(0, cap - (await countActiveOrders(q)));
}

export async function handleGetOrder(txn: string | null, q: Query): Promise<HandlerResult> {
  if (!txn || !/^[A-Za-z0-9_]{3,80}$/.test(txn)) return { status: 400, json: { error: 'bad id' } };
  const o = await getOrder(q, txn);
  // The buyer can land here before Paddle's webhook does: say pending, not "not found".
  if (!o) return { status: 202, json: { status: 'pending' } };
  return { status: 200, json: { status: o.status, board: o.board } };
}

export async function handleSetBoard(raw: unknown, q: Query): Promise<HandlerResult> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as { txnId?: unknown; board?: unknown };
  if (typeof b.txnId !== 'string' || !BOARDS.includes(b.board as Board)) return { status: 400, json: { error: 'bad request' } };
  const ok = await setOrderBoard(q, b.txnId, b.board as Board);
  return ok ? { status: 200, json: { ok: true } } : { status: 409, json: { error: 'already set or unknown order' } };
}
