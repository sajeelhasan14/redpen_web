import { createHmac, timingSafeEqual } from 'node:crypto';

// Turnstile tokens are single-use, so a visitor proves they are human once and
// gets a signed cookie that the demo routes accept for 24 hours.
export const SESSION_COOKIE = 'rp_session';
const DAY = 24 * 3600_000;

const mac = (secret: string, exp: string) => createHmac('sha256', secret).update(exp).digest('hex');

export function signSession(secret: string, nowMs: number, ttlMs = DAY): string {
  const exp = String(nowMs + ttlMs);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(value: string | undefined, secret: string, nowMs: number): boolean {
  if (!value || !secret) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  const want = Buffer.from(mac(secret, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
