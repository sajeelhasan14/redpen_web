import { clientIp } from '@/lib/guard/ip';
import { verifyTurnstile } from '@/lib/guard/turnstile';
import { SESSION_COOKIE, signSession } from '@/lib/guard/session';
import { sessionOk } from '@/lib/http';

/** Whether this visitor already holds a valid session, so the human gate can be skipped. */
export async function GET(req: Request) {
  return Response.json({ ok: sessionOk(req) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: unknown };
  if (!(await verifyTurnstile(token, clientIp(req.headers)))) {
    return Response.json({ error: 'Please retry.' }, { status: 403 });
  }
  const value = signSession(process.env.SESSION_SECRET ?? '', Date.now());
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': `${SESSION_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=86400${secure}` } },
  );
}
