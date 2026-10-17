import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LessonSchema, ReplyPlain } from './schema';
import type { ModelCall } from './handler';
import { markTimeoutMs } from '@/lib/config';

const MODEL = process.env.TUTOR_MODEL ?? 'claude-sonnet-5';
// A stalled call fails fast (one retry at most) instead of holding the visitor for minutes.
export const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: markTimeoutMs(), maxRetries: 1 });

export const callAnthropic: ModelCall = async ({ system, instruction, base64, lesson }) => {
  try {
    const format = lesson ? zodOutputFormat(LessonSchema) : zodOutputFormat(ReplyPlain);
    const response = await anthropicClient.messages.parse(
      {
        model: MODEL,
        max_tokens: 4096,
        system,
        output_config: { effort: lesson ? 'medium' : 'low', format },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
              { type: 'text', text: instruction },
            ],
          },
        ],
      },
      { timeout: markTimeoutMs(lesson) },
    );
    if (response.stop_reason === 'refusal') return { kind: 'fail', reason: 'refusal' };
    if (response.stop_reason === 'max_tokens') return { kind: 'fail', reason: 'max_tokens' };
    if (!response.parsed_output) return { kind: 'fail', reason: 'invalid' };
    return {
      kind: 'ok',
      parsed: response.parsed_output,
      model: response.model,
      tokens: `${response.usage.input_tokens}/${response.usage.output_tokens}`,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    };
  } catch (err) {
    console.error('mark: model call failed', err instanceof Error ? err.message : err);
    return { kind: 'fail', reason: 'api' };
  }
};
