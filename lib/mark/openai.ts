import { z } from 'zod';
import { LessonSchema, ReplyPlain } from './schema';
import type { ModelCall } from './handler';
import { DEFAULT_OPENAI_MODEL, markTimeoutMs } from '@/lib/config';

// OpenAI marking via the Responses API, with plain fetch (no SDK dependency).
// Verified live on 2026-10-02: strict json_schema rejects `oneOf` (zod's encoding of
// a discriminated union) but accepts `anyOf`; `max_output_tokens` caps reasoning +
// answer together; a cut-off reply comes back as status "incomplete".

export const OPENAI_URL = 'https://api.openai.com/v1/responses';
export { DEFAULT_OPENAI_MODEL };
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

/** A zod schema as a JSON Schema that OpenAI's strict structured output accepts. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== '$schema')
        .map(([k, x]) => [k === 'oneOf' ? 'anyOf' : k, swap(x)]),
    );
  };
  return swap(z.toJSONSchema(schema)) as Record<string, unknown>;
}

const REPLY = strictJsonSchema(ReplyPlain);
const LESSON = strictJsonSchema(LessonSchema);

function effortFor(lesson: boolean): Effort {
  if (lesson) return 'medium';
  const e = process.env.MARK_EFFORT_OPENAI?.trim().toLowerCase() as Effort | undefined;
  return e && EFFORTS.includes(e) ? e : 'low';
}

/** The request body for one marking call. Exported for tests. */
export function openAIRequest(a: { system: string; instruction: string; base64: string; lesson: boolean }, model: string) {
  return {
    model,
    instructions: a.system,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/png;base64,${a.base64}`, detail: 'high' },
          { type: 'input_text', text: a.instruction },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: a.lesson ? 'lesson' : 'reply', schema: a.lesson ? LESSON : REPLY, strict: true } },
    reasoning: { effort: effortFor(a.lesson) },
    max_output_tokens: a.lesson ? 8192 : 4096,
    store: false,
  };
}

type OutputItem = { type?: string; content?: { type?: string; text?: string; refusal?: string }[] };
type ResponsesReply = {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string } | null;
};

const log = (msg: string) => console.error('mark: openai call failed', msg);

export const callOpenAI: ModelCall = async (a) => {
  const model = process.env.MARK_MODEL_OPENAI?.trim() || DEFAULT_OPENAI_MODEL;
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
      body: JSON.stringify(openAIRequest(a, model)),
      signal: AbortSignal.timeout(markTimeoutMs(a.lesson)),
    });
    const j = (await res.json().catch(() => ({}))) as ResponsesReply;
    if (!res.ok) {
      log(`HTTP ${res.status}: ${j.error?.message ?? 'no error message'}`);
      return { kind: 'fail', reason: 'api' };
    }
    if (j.status === 'incomplete') {
      const why = j.incomplete_details?.reason;
      if (why === 'max_output_tokens') return { kind: 'fail', reason: 'max_tokens' };
      if (why === 'content_filter') return { kind: 'fail', reason: 'refusal' };
      log(`incomplete: ${why ?? 'unknown'}`);
      return { kind: 'fail', reason: 'api' };
    }
    if (j.status !== 'completed') {
      log(`status ${j.status ?? 'missing'}${j.error?.message ? `: ${j.error.message}` : ''}`);
      return { kind: 'fail', reason: 'api' };
    }
    const parts = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
    if (parts.some((p) => p.type === 'refusal')) return { kind: 'fail', reason: 'refusal' };
    const text = parts.find((p) => p.type === 'output_text')?.text;
    if (!text) return { kind: 'fail', reason: 'invalid' };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: 'fail', reason: 'invalid' };
    }
    const parsed = (a.lesson ? LessonSchema : ReplyPlain).safeParse(json);
    if (!parsed.success) return { kind: 'fail', reason: 'invalid' };
    const input = j.usage?.input_tokens ?? 0;
    const output = j.usage?.output_tokens ?? 0;
    return { kind: 'ok', parsed: parsed.data, model: j.model ?? model, tokens: `${input}/${output}`, usage: { input, output } };
  } catch (err) {
    log(err instanceof Error ? err.message : String(err));
    return { kind: 'fail', reason: 'api' };
  }
};
