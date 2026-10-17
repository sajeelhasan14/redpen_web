import { handleConfirm } from '@/lib/waitlist/handler';
import { pgQuery } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000';
  const token = new URL(req.url).searchParams.get('token');
  try {
    return Response.redirect(await handleConfirm(token, { q: pgQuery(), siteUrl }), 303);
  } catch (e) {
    console.error('waitlist confirm failed', e instanceof Error ? e.message : e);
    return Response.redirect(`${siteUrl}/?waitlist=invalid#waitlist`, 303);
  }
}
