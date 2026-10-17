import { z } from 'zod';
import { EngineError, engineModelFor, withRetry, type EngineModel, type EngineUsage } from './model';
import type { Alignment, Question, Transcript, TransitionKind } from './types';

export const TRANSITIONS = ['rewrite', 'differentiate', 'integrate', 'take_limit', 'substitute', 'evaluate', 'unknown'] as const;

export const MatcherSchema = z.object({
  lines: z.array(
    z.object({
      n: z.number(),
      transition: z.enum(TRANSITIONS),
      substitution: z.object({ variable: z.string(), latex: z.string() }).nullable(),
    }),
  ),
  points: z.array(z.object({ id: z.string(), line: z.number().nullable() })),
});
export type RawAlignment = z.infer<typeof MatcherSchema>;

export const MATCHER_SYSTEM = `You line up a student's calculus working with a marking rubric. You never decide whether anything is correct.

For every numbered line, say how it follows from the line of maths above it (or, for the first line, from the question):
- "rewrite": the same quantity or equation in another form (expanding, factoring, simplifying, rearranging, solving).
- "differentiate": the line is meant to be the derivative of the line above.
- "integrate": the line is meant to be an antiderivative of the line above.
- "take_limit": the line is meant to be the value of the limit written above.
- "substitute": a value is put in for a variable. Give the variable and the value as LaTeX in substitution.
- "evaluate": arithmetic on numbers only.
- "unknown": a new starting point, words, or anything else.
Set substitution to null unless the transition is "substitute".

For every rubric point, give the number of the first line where the student attempts that step, or null if no line attempts it. Choose by what the line is trying to do, not by whether it is right. One line may attempt several points.`;

export function matcherInstruction(question: Question, transcript: Transcript): string {
  const points = question.points.filter((p) => p.kind === 'cas').map((p) => `${p.id}: ${p.label}`);
  return [
    `Question: ${question.prompt}`,
    '',
    'Rubric points:',
    ...points,
    '',
    'Student lines:',
    ...transcript.lines.map((l) => `${l.n}. ${l.latex}`),
  ].join('\n');
}

/** Keeps only what refers to real lines and real CAS points; everything else falls back to "unknown" or null. */
export function sanitiseAlignment(question: Question, transcript: Transcript, raw: RawAlignment): Alignment {
  const real = new Set(transcript.lines.map((l) => l.n));
  return {
    lines: transcript.lines.map((l) => {
      const m = raw.lines.find((x) => x.n === l.n);
      const transition: TransitionKind = m?.transition ?? 'unknown';
      const s = m?.substitution;
      const substitution =
        transition === 'substitute' && s && /^[A-Za-z]$/.test(s.variable) && s.latex.trim() && s.latex.length <= 100
          ? { variable: s.variable, latex: s.latex.trim() }
          : null;
      return { n: l.n, transition, substitution };
    }),
    points: question.points
      .filter((p) => p.kind === 'cas')
      .map((p) => {
        const line = raw.points.find((x) => x.id === p.id)?.line ?? null;
        return { id: p.id, line: line !== null && real.has(line) ? line : null };
      }),
  };
}

export async function matchLines(
  question: Question,
  transcript: Transcript,
  deps: { model: EngineModel } = { model: engineModelFor() },
): Promise<{ alignment: Alignment; usage: EngineUsage }> {
  const res = await withRetry(() =>
    deps.model({ role: 'matcher', system: MATCHER_SYSTEM, instruction: matcherInstruction(question, transcript), images: [], schema: MatcherSchema }),
  );
  if (res.kind === 'fail') throw new EngineError('matcher', `The matcher failed: ${res.reason}`);
  return { alignment: sanitiseAlignment(question, transcript, res.data), usage: res.usage };
}
