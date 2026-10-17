// Every tunable number in one place, read from the environment with safe defaults.
const n = (v: string | undefined, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : d;
};

// Passed the marking suite 54/54 verdicts, 30/30 placement (3 runs, effort low) on 2026-10-02.
// The OpenAI price defaults below are this model's; another model must bring its own prices.
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

export type MarkProvider = 'anthropic' | 'openai';
export const MARK_PROVIDERS: readonly MarkProvider[] = ['anthropic', 'openai'];

/** Which model provider marks pages: MARK_PROVIDER=anthropic (default) | openai. */
export function markProvider(env: Record<string, string | undefined> = process.env): MarkProvider {
  return env.MARK_PROVIDER?.trim().toLowerCase() === 'openai' ? 'openai' : 'anthropic';
}

/**
 * How long one model call may take before it is abandoned: a check 20 s
 * (MARK_TIMEOUT_MS), a lesson 45 s (MARK_LESSON_TIMEOUT_MS), since a lesson thinks
 * at medium effort and writes several steps (measured 18-20 s on gpt-6-luna).
 */
export function markTimeoutMs(lesson = false): number {
  return lesson ? n(process.env.MARK_LESSON_TIMEOUT_MS, 45_000) || 45_000 : n(process.env.MARK_TIMEOUT_MS, 20_000) || 20_000;
}

export function config() {
  const provider = markProvider();
  return {
    provider,
    perVisitor: n(process.env.DEMO_PER_VISITOR, 10),
    /** Daily pence one visitor may spend across checks, lessons and speech. */
    perVisitorPence: n(process.env.DEMO_PER_VISITOR_PENCE, 40),
    dailyCapPence: Math.round(n(process.env.DEMO_DAILY_CAP_GBP, 10) * 100),
    passCap: n(process.env.PASS_CAP, 200),
    costs: {
      checkPence: n(process.env.COST_CHECK_PENCE, 1),
      lessonPence: n(process.env.COST_LESSON_PENCE, 3),
      speakPence: n(process.env.COST_SPEAK_PENCE, 1),
    },
    /**
     * GBP per million tokens for the provider in use, used to true-up spend from real usage.
     * Conservative defaults: Anthropic claude-sonnet-5; OpenAI gpt-6-luna at its cache-write
     * input rate ($0.125/MTok) and $0.50 output (published 2026-10-02), converted at 0.80 GBP/USD.
     */
    prices:
      provider === 'openai'
        ? {
            inPerMTokGbp: n(process.env.PRICE_IN_PER_MTOK_GBP_OPENAI, 0.1),
            outPerMTokGbp: n(process.env.PRICE_OUT_PER_MTOK_GBP_OPENAI, 0.4),
          }
        : {
            inPerMTokGbp: n(process.env.PRICE_IN_PER_MTOK_GBP, 3),
            outPerMTokGbp: n(process.env.PRICE_OUT_PER_MTOK_GBP, 15),
          },
  };
}
