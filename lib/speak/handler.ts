import type { Counter } from '@/lib/guard/counter';
import { checkAndCharge } from '@/lib/guard/limits';
import type { HandlerResult, RequestCtx } from '@/lib/http';
import { config } from '@/lib/config';

const MAX_CHARS = 600;

export async function guardSpeak(
  raw: unknown,
  ctx: RequestCtx,
  deps: { counter: Counter; now: () => Date },
): Promise<{ ok: true; text: string } | { ok: false; result: HandlerResult }> {
  if (!ctx.sessionOk) return { ok: false, result: { status: 403, json: { error: 'Please reload the page.' } } };
  const text = String((raw as { text?: unknown } | null)?.text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, MAX_CHARS)
    .trim();
  if (!text) return { ok: false, result: { status: 400, json: { error: 'Nothing to say.' } } };
  const c = config();
  const gate = await checkAndCharge(deps.counter, {
    ipHash: ctx.ipHash, costPence: c.costs.speakPence, countsTowardRate: false,
    perVisitor: c.perVisitor, perVisitorPence: c.perVisitorPence, dailyCapPence: c.dailyCapPence, now: deps.now(),
  });
  if (!gate.ok) return { ok: false, result: { status: 429, json: { error: 'Voice is busy.', reason: gate.reason } } };
  return { ok: true, text };
}
