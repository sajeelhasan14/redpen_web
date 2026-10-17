import { modelFor } from '@/lib/mark/provider';
import { handleMark } from '@/lib/mark/handler';
import { redisCounter, MemoryCounter } from '@/lib/guard/counter';
import { dayKey } from '@/lib/guard/limits';
import { bumpStat, pgQuery } from '@/lib/db';
import { readCtx, toResponse } from '@/lib/http';

export const runtime = 'nodejs';
// Local dev without REDIS_URL uses an in-process counter.
const counter = process.env.REDIS_URL ? redisCounter() : new MemoryCounter();
// MARK_PROVIDER=anthropic (default) | openai picks the model that marks pages.
const model = modelFor();

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const result = await handleMark(body, readCtx(req), {
    model,
    counter,
    stat: async (f) => {
      if (process.env.DATABASE_URL) await bumpStat(pgQuery(), dayKey(new Date()), f);
    },
    now: () => new Date(),
  });
  return toResponse(result);
}
