import { DEFAULT_OPENAI_MODEL } from '@/lib/config';

// Production must fail loud on missing configuration instead of quietly running
// with an empty secret, a shared salt or an in-memory rate limiter.
export const REQUIRED_IN_PRODUCTION = [
  'IP_SALT',
  'SESSION_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
  'TURNSTILE_SECRET_KEY',
  'RESEND_API_KEY',
] as const;

// Only required when payments are switched on (NEXT_PUBLIC_PAYMENTS_ENABLED=1).
export const PADDLE_REQUIRED = ['PADDLE_WEBHOOK_SECRET', 'PADDLE_API_KEY'] as const;

// The OpenAI true-up price defaults are the default model's; any other model needs its own.
export const OPENAI_PRICES = ['PRICE_IN_PER_MTOK_GBP_OPENAI', 'PRICE_OUT_PER_MTOK_GBP_OPENAI'] as const;

// The marking provider's key: MARK_PROVIDER=anthropic (default) | openai.
export const PROVIDER_KEY = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' } as const;

/** Throws, naming every missing variable, when NODE_ENV is production. A no-op otherwise. */
export function assertProdEnv(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const provider = (env.MARK_PROVIDER?.trim() || 'anthropic').toLowerCase();
  if (provider !== 'anthropic' && provider !== 'openai') throw new Error(`MARK_PROVIDER must be anthropic or openai, not "${env.MARK_PROVIDER}"`);
  const required: string[] = [...REQUIRED_IN_PRODUCTION, PROVIDER_KEY[provider]];
  if (env.NEXT_PUBLIC_PAYMENTS_ENABLED === '1') required.push(...PADDLE_REQUIRED);
  const openaiModel = env.MARK_MODEL_OPENAI?.trim();
  if (provider === 'openai' && openaiModel && openaiModel !== DEFAULT_OPENAI_MODEL) required.push(...OPENAI_PRICES);
  const missing = required.filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
