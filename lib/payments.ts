import { createHmac, timingSafeEqual } from 'node:crypto';
import { BOARDS, type Board } from '@/lib/db';

// The only file that knows it is Paddle. A switch to Lemon Squeezy replaces this
// file and the webhook route (see docs/decisions/paddle.md).

export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(';').map((p) => p.split('=') as [string, string]));
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!Number.isFinite(ts) || !h1 || Math.abs(nowSec - ts) > toleranceSec) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex'));
  const got = Buffer.from(h1);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type PaddleEvent =
  | { type: 'completed'; txnId: string; customerId: string; amountPence: number; currency: string; board: Board | null }
  | { type: 'refunded'; txnId: string }
  | { type: 'ignored' };

export function parsePaddleEvent(json: unknown): PaddleEvent {
  const e = (json ?? {}) as { event_type?: string; data?: Record<string, any> };
  const d = e.data ?? {};
  if (e.event_type === 'transaction.completed' && typeof d.id === 'string') {
    const board = BOARDS.includes(d.custom_data?.board) ? (d.custom_data.board as Board) : null;
    const total = Number(d.details?.totals?.grand_total ?? 0);
    return {
      type: 'completed',
      txnId: d.id,
      customerId: String(d.customer_id ?? ''),
      amountPence: Number.isFinite(total) ? total : 0,
      currency: String(d.currency_code ?? 'GBP'),
      board,
    };
  }
  if ((e.event_type === 'adjustment.created' || e.event_type === 'adjustment.updated') && d.action === 'refund' && d.status === 'approved' && typeof d.transaction_id === 'string') {
    return { type: 'refunded', txnId: d.transaction_id };
  }
  return { type: 'ignored' };
}

export async function fetchCustomerEmail(
  customerId: string,
  o: { apiKey?: string; env?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  if (!customerId) return '';
  const env = o.env ?? process.env.PADDLE_ENV ?? 'sandbox';
  const base = env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  const r = await (o.fetchImpl ?? fetch)(`${base}/customers/${encodeURIComponent(customerId)}`, {
    headers: { Authorization: `Bearer ${o.apiKey ?? process.env.PADDLE_API_KEY}` },
  });
  if (!r.ok) throw new Error(`paddle customer lookup ${r.status}`);
  const j = (await r.json()) as { data?: { email?: string } };
  return j.data?.email ?? '';
}
