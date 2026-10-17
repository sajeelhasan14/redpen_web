import { randomBytes } from 'node:crypto';
import { handleJoin } from '@/lib/waitlist/handler';
import { pgQuery } from '@/lib/db';
import { resendSender } from '@/lib/email';
import { readCtx, toResponse } from '@/lib/http';
import { redisCounter, MemoryCounter } from '@/lib/guard/counter';

export const runtime = 'nodejs';
// Local dev without REDIS_URL uses an in-process counter.
const counter = process.env.REDIS_URL ? redisCounter() : new MemoryCounter();

export async function POST(req: Request) {
  try {
    const result = await handleJoin(await req.json().catch(() => null), readCtx(req), {
      q: pgQuery(),
      send: resendSender(),
      siteUrl: process.env.SITE_URL ?? 'http://localhost:3000',
      newToken: () => randomBytes(24).toString('hex'),
      counter,
      now: () => new Date(),
    });
    return toResponse(result);
  } catch (e) {
    console.error('waitlist join failed', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
