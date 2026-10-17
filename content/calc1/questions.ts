import raw from './questions.json';
import { parseQuestion } from '@/lib/engine/rubric';
import type { Question, TransitionKind } from '@/lib/engine/types';

/** One line of a model solution, with the alignment a perfect matcher would give it. */
export interface ModelLine {
  latex: string;
  kind: TransitionKind;
  point: string | null;
  sub: { variable: string; latex: string } | null;
  /** True for a line of words, which the checker is expected not to parse. */
  words: boolean;
}
export type SeedQuestion = Question & { model: ModelLine[] };

// The seed bank for fixtures and the launch evaluation. Each rubric is validated on
// load, so a bad edit to the JSON fails at import instead of mid-marking.
export const CALC1_QUESTIONS: SeedQuestion[] = (raw as unknown as (Record<string, unknown> & { model: ModelLine[] })[]).map((q) => ({
  ...parseQuestion(q),
  model: q.model,
}));

export function getCalc1Question(id: unknown): SeedQuestion | undefined {
  return CALC1_QUESTIONS.find((q) => q.id === id);
}
