import { unsubscribeWaitlist, pgQuery } from '@/lib/db';

export const runtime = 'nodejs';

const page = (msg: string, status = 200) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>RedPen Maths</title><body style="font-family:sans-serif;padding:24px"><p>${msg}</p><p><a href="/">RedPen Maths</a></p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  try {
    const ok = token ? await unsubscribeWaitlist(pgQuery(), token) : false;
    return page(ok ? "You're unsubscribed. You won't get any more updates." : 'That link is not valid.');
  } catch (e) {
    console.error('waitlist unsubscribe failed', e instanceof Error ? e.message : e);
    return page('Something went wrong. Please try the link again in a few minutes.', 500);
  }
}
