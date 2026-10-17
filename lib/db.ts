import { Pool } from 'pg';
import type { Board, Course, Role } from './boards';
export { BOARDS, COURSES, type Board, type Course, type Role } from './boards';

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Railway's private network (and localhost) needs no TLS; anything else gets it. */
export function sslFor(url: string): { rejectUnauthorized: false } | undefined {
  const host = new URL(url).hostname;
  if (host.endsWith('.railway.internal') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return undefined;
  return { rejectUnauthorized: false };
}

let cached: Query | null = null;
/** Production query function: one cached pg.Pool, rows returned. */
export function pgQuery(url = process.env.DATABASE_URL): Query {
  if (cached) return cached;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000, ssl: sslFor(url) });
  // An idle client dropped by a Postgres restart emits 'error' on the pool; unhandled, it would crash the process.
  pool.on('error', (e) => console.error('pg pool error', e.message));
  cached = async (text, params = []) => (await pool.query(text, params as unknown[])).rows as Record<string, unknown>[];
  return cached;
}

const norm = (email: string) => email.trim().toLowerCase();

export async function addToWaitlist(
  q: Query,
  w: { email: string; role: Role; board: Board | null; token: string; course?: Course | null; school?: string | null; examDate?: string | null },
) {
  const email = norm(w.email);
  const details = [w.course ?? null, w.school ?? null, w.examDate ?? null];
  const inserted = await q(
    `INSERT INTO waitlist (email, role, board, token, course, school, exam_date) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO NOTHING RETURNING token`,
    [email, w.role, w.board, w.token, ...details],
  );
  if (inserted.length) return { created: true, confirmed: false, token: w.token };
  // Already on the list: a later join may add an exam date, but never wipes what is there.
  const [row] = await q(
    `UPDATE waitlist SET course = COALESCE($2, course), school = COALESCE($3, school), exam_date = COALESCE($4, exam_date)
     WHERE email = $1 RETURNING token, confirmed_at`,
    [email, ...details],
  );
  return { created: false, confirmed: row.confirmed_at !== null, token: String(row.token) };
}

export async function confirmWaitlist(q: Query, token: string) {
  const rows = await q(`UPDATE waitlist SET confirmed_at = COALESCE(confirmed_at, now()) WHERE token = $1 RETURNING id`, [token]);
  return rows.length > 0;
}

export async function upsertCompletedOrder(
  q: Query,
  o: { txnId: string; email: string; board: Board | null; amountPence: number; currency: string },
) {
  // A refund that landed first keeps the row refunded; the details still fill in.
  await q(
    `INSERT INTO orders (paddle_txn_id, email, board, amount_pence, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'completed')
     ON CONFLICT (paddle_txn_id) DO UPDATE SET
       email = COALESCE(NULLIF(EXCLUDED.email, ''), orders.email),
       board = COALESCE(orders.board, EXCLUDED.board),
       amount_pence = EXCLUDED.amount_pence,
       currency = EXCLUDED.currency,
       updated_at = now()`,
    [o.txnId, norm(o.email), o.board, o.amountPence, o.currency],
  );
}

export async function setOrderEmail(q: Query, txnId: string, email: string) {
  await q(`UPDATE orders SET email = $2, updated_at = now() WHERE paddle_txn_id = $1`, [txnId, norm(email)]);
}

export async function markRefunded(q: Query, txnId: string) {
  await q(
    `INSERT INTO orders (paddle_txn_id, status) VALUES ($1, 'refunded')
     ON CONFLICT (paddle_txn_id) DO UPDATE SET status = 'refunded', updated_at = now()`,
    [txnId],
  );
}

export async function getOrder(q: Query, txnId: string) {
  const [r] = await q(`SELECT paddle_txn_id, email, board, status FROM orders WHERE paddle_txn_id = $1`, [txnId]);
  if (!r) return null;
  return {
    txnId: String(r.paddle_txn_id),
    email: String(r.email),
    board: (r.board as Board | null) ?? null,
    status: r.status as 'completed' | 'refunded',
  };
}

export async function countActiveOrders(q: Query) {
  const [r] = await q(`SELECT count(*)::int AS n FROM orders WHERE status = 'completed'`);
  return Number(r.n);
}

export async function setOrderBoard(q: Query, txnId: string, board: Board) {
  const rows = await q(`UPDATE orders SET board = $2, updated_at = now() WHERE paddle_txn_id = $1 AND board IS NULL RETURNING id`, [txnId, board]);
  return rows.length > 0;
}

export async function unsubscribeWaitlist(q: Query, token: string) {
  const rows = await q(`UPDATE waitlist SET unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE token = $1 RETURNING id`, [token]);
  return rows.length > 0;
}

export async function bumpStat(q: Query, day: string, field: 'checks' | 'errors_caught' | 'teach_taps') {
  // field is a closed union, so it is safe to interpolate as a column name.
  await q(
    `INSERT INTO demo_stats (day, ${field}) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET ${field} = demo_stats.${field} + 1`,
    [day],
  );
}
