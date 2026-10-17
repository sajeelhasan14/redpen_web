import { addToWaitlist, confirmWaitlist, BOARDS, COURSES, type Board, type Course, type Query, type Role } from '@/lib/db';
import { waitlistConfirmEmail, type SendEmail } from '@/lib/email';
import { createHash } from 'node:crypto';
import type { Counter } from '@/lib/guard/counter';
import type { HandlerResult, RequestCtx } from '@/lib/http';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OK: HandlerResult = { status: 200, json: { ok: true, message: 'Check your inbox to confirm.' } };

// One Turnstile solve buys a 24 h session, so joins are rate-limited to stop the
// confirmation email being used to bomb arbitrary addresses.
export const JOINS_PER_HOUR = 5;
export const EMAIL_COOLDOWN_SEC = 600;
const TOO_MANY: HandlerResult = { status: 429, json: { error: 'Too many sign-ups from this connection. Please try again later.' } };

export const SCHOOL_MAX = 120;
const DAY = 24 * 3600 * 1000;

/** A real calendar date from a week ago to about two years ahead, as YYYY-MM-DD; anything else is null. */
function examDate(v: unknown, now: Date): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to March; a date that does not round-trip is not a date.
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) return null;
  return t >= now.getTime() - 7 * DAY && t <= now.getTime() + 730 * DAY ? v : null;
}

function school(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, SCHOOL_MAX).trim();
  return s || null;
}

/** Redis keys never hold the raw address. */
const emailKey = (email: string) => `wl:em:${createHash('sha256').update(`waitlist:${email}`).digest('hex').slice(0, 32)}`;

/** Fixed one-hour window per connection: the 6th join in the same clock hour is refused. */
async function underIpLimit(counter: Counter, ipHash: string, now: Date) {
  const hour = now.toISOString().slice(0, 13);
  return (await counter.incrBy(`wl:ip:${hour}:${ipHash}`, 1, 3600)) <= JOINS_PER_HOUR;
}

/**
 * When no confirmation went to this address in the last 10 minutes, claims the slot and
 * returns a function that gives it back (used if the send fails); otherwise null.
 * The key holds the epoch second of the last send. The increment that lands exactly on `now`
 * wins; a concurrent request overshoots, takes its increment back and sends nothing.
 */
async function claimEmailSlot(counter: Counter, email: string, now: Date): Promise<(() => Promise<unknown>) | null> {
  const key = emailKey(email);
  const t = Math.floor(now.getTime() / 1000);
  const last = await counter.get(key);
  if (last && t - last < EMAIL_COOLDOWN_SEC) return null;
  const delta = t - last;
  const release = () => counter.incrBy(key, -delta, EMAIL_COOLDOWN_SEC);
  if ((await counter.incrBy(key, delta, EMAIL_COOLDOWN_SEC)) === t) return release;
  await release();
  return null;
}

export async function handleJoin(
  raw: unknown,
  ctx: RequestCtx,
  deps: { q: Query; send: SendEmail; siteUrl: string; newToken: () => string; counter: Counter; now: () => Date },
): Promise<HandlerResult> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { status: 400, json: { error: 'Please enter a valid email address.' } };
  // The human gate already ran Turnstile and issued the session cookie.
  if (!ctx.sessionOk) return { status: 403, json: { error: 'Please retry.' } };
  const now = deps.now();
  if (!(await underIpLimit(deps.counter, ctx.ipHash, now))) return TOO_MANY;
  // The list is for students now; the form no longer asks.
  const role: Role = b.role === 'parent' ? 'parent' : 'student';
  const board: Board | null = BOARDS.includes(b.board as Board) ? (b.board as Board) : null;
  const course: Course | null = COURSES.includes(b.course as Course) ? (b.course as Course) : null;

  const r = await addToWaitlist(deps.q, { email, role, board, token: deps.newToken(), course, school: school(b.school), examDate: examDate(b.examDate, now) });
  // Same reply whether new, repeated or already confirmed, so no one can probe who signed up.
  // Within the per-address cooldown the reply is the same, but nothing is sent.
  const release = r.confirmed ? null : await claimEmailSlot(deps.counter, email, now);
  if (release) {
    const url = `${deps.siteUrl}/api/waitlist/confirm?token=${encodeURIComponent(r.token)}`;
    const m = waitlistConfirmEmail(url);
    try {
      await deps.send(email, m.subject, m.html);
    } catch (e) {
      await release(); // a failed send must not lock the address out for 10 minutes
      throw e;
    }
  }
  return OK;
}

export async function handleConfirm(token: string | null, deps: { q: Query; siteUrl: string }): Promise<string> {
  const ok = token ? await confirmWaitlist(deps.q, token) : false;
  return `${deps.siteUrl}/?waitlist=${ok ? 'confirmed' : 'invalid'}#waitlist`;
}
