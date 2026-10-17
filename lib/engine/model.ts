import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { DEFAULT_OPENAI_MODEL, markProvider } from '@/lib/config';
import { anthropicClient } from '@/lib/mark/anthropic';
import { OPENAI_URL, strictJsonSchema } from '@/lib/mark/openai';

// One structured model call for the engine's three roles. Unlike lib/mark's ModelCall
// it takes any output schema and several images (a problem may span photos).

export type EngineRole = 'reader' | 'matcher' | 'judge';
export interface EngineImage {
  mediaType: 'image/png' | 'image/jpeg';
  base64: string;
}
export interface EngineUsage {
  input: number;
  output: number;
}
export interface EngineModelArgs<T> {
  role: EngineRole;
  system: string;
  instruction: string;
  images: EngineImage[];
  schema: z.ZodType<T>;
}
export type EngineModelResult<T> =
  | { kind: 'ok'; data: T; model: string; usage: EngineUsage }
  | { kind: 'fail'; reason: 'refusal' | 'max_tokens' | 'invalid' | 'api' };
export type EngineModel = <T>(a: EngineModelArgs<T>) => Promise<EngineModelResult<T>>;

const ROLE_ENV = { reader: 'ENGINE_MODEL_READER', matcher: 'ENGINE_MODEL_MATCHER', judge: 'ENGINE_MODEL_JUDGE' } as const;
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** One model call may take 60 s (ENGINE_TIMEOUT_MS): a full page read is slower than a live check. */
export function engineTimeoutMs(): number {
  const v = Number(process.env.ENGINE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

function effort(): string {
  const e = process.env.ENGINE_EFFORT?.trim().toLowerCase();
  return e && EFFORTS.includes(e) ? e : 'low';
}

/** The request body for one engine call. Exported for tests. */
export function openAIEngineRequest<T>(a: EngineModelArgs<T>, model: string) {
  return {
    model,
    instructions: a.system,
    input: [
      {
        role: 'user',
        content: [
          ...a.images.map((i) => ({ type: 'input_image', image_url: `data:${i.mediaType};base64,${i.base64}`, detail: 'high' })),
          { type: 'input_text', text: a.instruction },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: a.role, schema: strictJsonSchema(a.schema), strict: true } },
    reasoning: { effort: effort() },
    max_output_tokens: 8192,
    store: false,
  };
}

type ResponsesReply = {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string } | null;
};

const log = (who: string, msg: string) => console.error(`engine: ${who} call failed`, msg);

export const openAIEngineModel: EngineModel = async (a) => {
  const model = process.env[ROLE_ENV[a.role]]?.trim() || process.env.MARK_MODEL_OPENAI?.trim() || DEFAULT_OPENAI_MODEL;
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
      body: JSON.stringify(openAIEngineRequest(a, model)),
      signal: AbortSignal.timeout(engineTimeoutMs()),
    });
    const j = (await res.json().catch(() => ({}))) as ResponsesReply;
    if (!res.ok) {
      log(a.role, `HTTP ${res.status}: ${j.error?.message ?? 'no error message'}`);
      return { kind: 'fail', reason: 'api' };
    }
    if (j.status === 'incomplete') {
      const why = j.incomplete_details?.reason;
      if (why === 'max_output_tokens') return { kind: 'fail', reason: 'max_tokens' };
      if (why === 'content_filter') return { kind: 'fail', reason: 'refusal' };
      log(a.role, `incomplete: ${why ?? 'unknown'}`);
      return { kind: 'fail', reason: 'api' };
    }
    if (j.status !== 'completed') {
      log(a.role, `status ${j.status ?? 'missing'}`);
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
    const parsed = a.schema.safeParse(json);
    if (!parsed.success) return { kind: 'fail', reason: 'invalid' };
    return { kind: 'ok', data: parsed.data, model: j.model ?? model, usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 } };
  } catch (err) {
    log(a.role, err instanceof Error ? err.message : String(err));
    return { kind: 'fail', reason: 'api' };
  }
};

export const anthropicEngineModel: EngineModel = async (a) => {
  const model = process.env[ROLE_ENV[a.role]]?.trim() || process.env.TUTOR_MODEL?.trim() || 'claude-sonnet-5';
  try {
    const response = await anthropicClient.messages.parse(
      {
        model,
        max_tokens: 8192,
        system: a.system,
        output_config: { effort: 'low', format: zodOutputFormat(a.schema) },
        messages: [
          {
            role: 'user',
            content: [
              ...a.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.base64 } })),
              { type: 'text' as const, text: a.instruction },
            ],
          },
        ],
      },
      { timeout: engineTimeoutMs() },
    );
    if (response.stop_reason === 'refusal') return { kind: 'fail', reason: 'refusal' };
    if (response.stop_reason === 'max_tokens') return { kind: 'fail', reason: 'max_tokens' };
    const parsed = a.schema.safeParse(response.parsed_output);
    if (!parsed.success) return { kind: 'fail', reason: 'invalid' };
    return { kind: 'ok', data: parsed.data, model: response.model, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
  } catch (err) {
    log(a.role, err instanceof Error ? err.message : String(err));
    return { kind: 'fail', reason: 'api' };
  }
};

/** The engine model for MARK_PROVIDER: anthropic (default) | openai. */
export function engineModelFor(env: Record<string, string | undefined> = process.env): EngineModel {
  return markProvider(env) === 'openai' ? openAIEngineModel : anthropicEngineModel;
}

/** One retry after any failure, as the spec requires; the second failure is returned. */
export async function withRetry<T>(call: () => Promise<EngineModelResult<T>>): Promise<EngineModelResult<T>> {
  const first = await call();
  return first.kind === 'ok' ? first : call();
}

/** Raised when a problem could not be marked this time. The caller may try again and must not count the attempt. */
export class EngineError extends Error {
  readonly retryable = true;
  constructor(
    public readonly stage: 'reader' | 'matcher' | 'checker',
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
