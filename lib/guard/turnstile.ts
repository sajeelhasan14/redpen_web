const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Returns true when Cloudflare confirms the token. With no secret outside production, it is open for local dev. */
export async function verifyTurnstile(
  token: unknown,
  ip: string,
  o: { secret?: string; fetchImpl?: typeof fetch; production?: boolean } = {},
): Promise<boolean> {
  const secret = o.secret ?? process.env.TURNSTILE_SECRET_KEY ?? '';
  const production = o.production ?? process.env.NODE_ENV === 'production';
  if (!secret) return !production;
  if (typeof token !== 'string' || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await (o.fetchImpl ?? fetch)(VERIFY_URL, { method: 'POST', body });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}
