import { createHash } from 'node:crypto';

/**
 * The visitor's IP. On Vercel, x-vercel-forwarded-for is set by the platform and
 * cannot be spoofed by the client; x-forwarded-for can carry client-supplied
 * entries, so it is the last resort.
 */
export function clientIp(h: Headers): string {
  const first = (v: string | null) => v?.split(',')[0]?.trim() || '';
  return first(h.get('x-vercel-forwarded-for')) || first(h.get('x-real-ip')) || first(h.get('x-forwarded-for')) || 'unknown';
}

/**
 * The part of an IP that identifies one visitor for rate limiting. A single
 * IPv6 customer usually holds a whole /64, so IPv6 is keyed on its first four
 * hextets; anything else (IPv4, 'unknown') is returned unchanged.
 */
export function ipRateKey(ip: string): string {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!s.includes(':')) return s;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return mapped[1];
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = s.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  const groups = [...h, ...fill, ...t].slice(0, 4).map((g) => (g.replace(/^0+/, '') || '0'));
  while (groups.length < 4) groups.push('0');
  return `${groups.join(':')}::/64`;
}

/** Salted so the rate-limit keys never hold a raw IP address. */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}
