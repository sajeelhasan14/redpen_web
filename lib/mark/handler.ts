import type { Annotation, TranscriptLine, TutorReply } from '@/lib/types';
import type { Counter } from '@/lib/guard/counter';
import { addSpend, checkAndCharge } from '@/lib/guard/limits';
import type { HandlerResult, RequestCtx } from '@/lib/http';
import { config } from '@/lib/config';
import { getDemoQuestion } from '@/content/demo-questions';
import { buildInstruction, LESSON_ASK, SYSTEM } from './prompt';
import { parseLayout, statesResult, validAnnotation, withoutAnswer, withoutBannedSentences } from './schema';

// What the tutor says instead when the model's own words would state the result
// or use a banned word. Neutral, and never names a value.
export const LOOK_AGAIN_MARKED = 'Have another look at the line I marked. What should it be?';
export const LOOK_AGAIN = 'Have another look at that line. What should it be?';
export const THATS_RIGHT = "That's right.";
export const FINISH_YOURSELF = 'Now finish that last step yourself.';

export type ModelCall = (a: { system: string; instruction: string; base64: string; lesson: boolean }) => Promise<
  | { kind: 'ok'; parsed: unknown; model: string; tokens: string; usage: { input: number; output: number } }
  | { kind: 'fail'; reason: 'refusal' | 'max_tokens' | 'invalid' | 'api' }
>;

export const MAX_DATA_URL = 1_500_000;
export const MAX_PRIOR = 40;

export interface MarkDeps {
  model: ModelCall;
  counter: Counter;
  stat: (field: 'checks' | 'errors_caught' | 'teach_taps') => Promise<void>;
  now: () => Date;
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max).trim();
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fail = (status: number, error: string, extra: object = {}): HandlerResult => ({ status, json: { error, ...extra } });

export async function handleMark(raw: unknown, ctx: RequestCtx, deps: MarkDeps): Promise<HandlerResult> {
  if (!ctx.sessionOk) return fail(403, 'Please reload the page and try again.');
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const demo = getDemoQuestion(body.questionId);
  if (!demo) return fail(400, 'Unknown question.');
  const dataUrl = String(body.dataUrl ?? '');
  if (dataUrl.length > MAX_DATA_URL) return fail(400, 'That page is too large.');
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return fail(400, 'dataUrl must be a PNG data URL.');

  const space = body.space as { width?: unknown; height?: unknown } | undefined;
  const width = num(space?.width) ? space!.width : 900;
  const height = num(space?.height) ? space!.height : 620;
  // A lesson always teaches the marked step with one fixed instruction; the
  // client's question text is never put into the prompt. A non-empty
  // `question` still means "lesson" for older clients.
  const lesson = body.lesson === true || Boolean(clean(body.question, 300));
  // "Check my work": same limits as an automatic check, but the model is told not to stay silent.
  const force = !lesson && body.force === true;
  const layout = parseLayout(body.layout);
  const prior = (Array.isArray(body.prior) ? body.prior : []).filter(validAnnotation).slice(0, MAX_PRIOR) as Annotation[];
  const transcript: TranscriptLine[] = (Array.isArray(body.transcript) ? body.transcript : [])
    .slice(-8)
    .map((l: { who?: unknown; text?: unknown }) => ({ who: l?.who === 'tutor' ? ('tutor' as const) : ('student' as const), text: clean(l?.text, 300) }))
    .filter((l: TranscriptLine) => l.text);

  const c = config();
  const estimate = lesson ? c.costs.lessonPence : c.costs.checkPence;
  const gate = await checkAndCharge(deps.counter, {
    ipHash: ctx.ipHash,
    costPence: estimate,
    countsTowardRate: !lesson,
    perVisitor: c.perVisitor,
    perVisitorPence: c.perVisitorPence,
    dailyCapPence: c.dailyCapPence,
    now: deps.now(),
  });
  if (!gate.ok) return fail(429, 'The live demo is busy.', { reason: gate.reason });

  const res = await deps.model({
    system: SYSTEM,
    instruction: buildInstruction({ question: lesson ? LESSON_ASK : undefined, width, height, layout, prior, transcript, demo, force }),
    base64: m[1],
    lesson,
  });
  if (res.kind === 'fail') return fail(502, 'The tutor could not answer that time.');
  // True-up: charge what the call really cost beyond the up-front estimate.
  const actual = Math.ceil((res.usage.input * c.prices.inPerMTokGbp + res.usage.output * c.prices.outPerMTokGbp) / 10_000);
  if (actual > estimate) await addSpend(deps.counter, { ipHash: ctx.ipHash, pence: actual - estimate, now: deps.now() }).catch(() => {});
  const headers = { 'x-tutor-model': res.model, 'x-tutor-tokens': res.tokens };

  if (lesson) {
    const parsed = res.parsed as { steps?: { say?: string; write?: unknown[] }[] };
    const steps = (parsed.steps ?? [])
      .slice(0, 8)
      .map((st) => {
        const say = withoutBannedSentences(String(st.say ?? '').trim());
        return {
          say: statesResult(say, demo) ? FINISH_YOURSELF : say,
          write: withoutAnswer((st.write ?? []).filter(validAnnotation), demo).slice(0, 10),
        };
      })
      .filter((st) => st.say || st.write.length);
    await deps.stat('teach_taps').catch(() => {});
    const reply: TutorReply = { worthResponding: true, correct: true, speech: '', annotations: [], steps };
    return { status: 200, json: reply, headers };
  }

  const p = res.parsed as { worthResponding?: boolean; correct?: boolean; speech?: string; annotations?: unknown[] };
  const proposed = (p.annotations ?? []).filter(validAnnotation);
  const reply: TutorReply = {
    worthResponding: p.worthResponding === true,
    correct: p.correct === true,
    speech: String(p.speech ?? '').trim(),
    annotations: withoutAnswer(proposed, demo).slice(0, 4),
  };
  // The guard dropped every mark the model meant to make: its speech may point at
  // ink that is not there, so say the no-mark line instead.
  const marksDropped = proposed.length > 0 && reply.annotations.length === 0;
  if (!reply.worthResponding) {
    reply.speech = '';
    reply.annotations = [];
  } else {
    // Code guard behind the prompt rule: the spoken line never states the result
    // (a correct reply cannot tell "right so far" from "finished", so it gets a
    // plain "That's right.") and never uses a banned word.
    const fallback = reply.correct ? THATS_RIGHT : reply.annotations.length ? LOOK_AGAIN_MARKED : LOOK_AGAIN;
    const said = reply.speech;
    const speech = withoutBannedSentences(said);
    reply.speech = statesResult(speech, demo) || (said && !speech) || (marksDropped && !reply.correct) ? fallback : speech;
  }
  await deps.stat('checks').catch(() => {});
  if (reply.worthResponding && !reply.correct && reply.annotations.length) await deps.stat('errors_caught').catch(() => {});
  return { status: 200, json: reply, headers };
}
