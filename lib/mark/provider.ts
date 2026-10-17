import { markProvider } from '@/lib/config';
import { callAnthropic } from './anthropic';
import { callOpenAI } from './openai';
import type { ModelCall } from './handler';

/** The marking model for MARK_PROVIDER: anthropic (default) | openai. */
export function modelFor(env: Record<string, string | undefined> = process.env): ModelCall {
  return markProvider(env) === 'openai' ? callOpenAI : callAnthropic;
}
