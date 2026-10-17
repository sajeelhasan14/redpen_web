import { z } from 'zod';
import { engineModelFor, withRetry, type EngineModel, type EngineUsage } from './model';
import type { Judgement, Question, Transcript } from './types';

export const JudgeSchema = z.object({
  judgements: z.array(z.object({ id: z.string(), met: z.boolean(), line: z.number().nullable(), quote: z.string() })),
});

export const JUDGE_SYSTEM = `You check whether a student's working states a required reason. You do not check any calculation.

For each criterion, decide whether one of the student's lines states it. If one does, set met to true, give that line's number, and copy the exact characters from that line that state it into quote. If no line states it, set met to false, line to null and quote to "".

Only what is written counts. Do not give credit for a reason the student could have given, or one that is implied by correct working. The quote must be copied character for character from the line you name.`;

export function judgeInstruction(question: Question, transcript: Transcript): string {
  const criteria = question.points.filter((p) => p.kind === 'judge').map((p) => `${p.id}: ${p.criterion}`);
  return [`Question: ${question.prompt}`, '', 'Criteria:', ...criteria, '', 'Student lines:', ...transcript.lines.map((l) => `${l.n}. ${l.latex}`)].join('\n');
}

const NONE: EngineUsage = { input: 0, output: 0 };

/**
 * One judgement per judged point. `judgements` is null when the judge could not
 * be reached, which the scorer turns into "couldn't check". The scorer, not this
 * function, enforces that the quote is really on the named line.
 */
export async function judgePoints(
  question: Question,
  transcript: Transcript,
  deps: { model: EngineModel } = { model: engineModelFor() },
): Promise<{ judgements: Judgement[] | null; usage: EngineUsage }> {
  const judged = question.points.filter((p) => p.kind === 'judge');
  if (judged.length === 0) return { judgements: [], usage: NONE };
  const res = await withRetry(() =>
    deps.model({ role: 'judge', system: JUDGE_SYSTEM, instruction: judgeInstruction(question, transcript), images: [], schema: JudgeSchema }),
  );
  if (res.kind === 'fail') return { judgements: null, usage: NONE };
  return {
    judgements: judged.map((p) => {
      const j = res.data.judgements.find((x) => x.id === p.id);
      return j ? { id: p.id, met: j.met, line: j.line, quote: j.quote } : { id: p.id, met: false, line: null, quote: '' };
    }),
    usage: res.usage,
  };
}
