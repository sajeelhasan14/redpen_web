import { clientIp, hashIp, ipRateKey } from '@/lib/guard/ip';
import { SESSION_COOKIE, verifySession } from '@/lib/guard/session';

export interface HandlerResult {
  status: number;
  json: unknown;
  headers?: Record<string, string>;
}

export function toResponse(r: HandlerResult): Response {
  return Response.json(r.json, { status: r.status, headers: r.headers });
}

export interface RequestCtx {
  ipHash: string;
  sessionOk: boolean;
}

function cookie(req: Request, name: string) {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1];
}

/** True when the request carries a valid rp_session cookie (or DEMO_DEV_OPEN=1 outside production). */
export function sessionOk(req: Request): boolean {
  const devOpen = process.env.DEMO_DEV_OPEN === '1' && process.env.NODE_ENV !== 'production';
  return devOpen || verifySession(cookie(req, SESSION_COOKIE), process.env.SESSION_SECRET ?? '', Date.now());
}

export function readCtx(req: Request): RequestCtx {
  const production = process.env.NODE_ENV === 'production';
  // No fallback salt in production: instrumentation.ts refuses to start without IP_SALT.
  const salt = process.env.IP_SALT || (production ? '' : 'dev-salt');
  if (!salt) throw new Error('IP_SALT is not set');
  return {
    ipHash: hashIp(ipRateKey(clientIp(req.headers)), salt),
    sessionOk: sessionOk(req),
  };
}
