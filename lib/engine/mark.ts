import { buildCheckRequest, callChecker, type CheckerCall } from './checker-client';
import { judgePoints } from './judge';
import { matchLines } from './matcher';
import { EngineError, engineModelFor, type EngineModel } from './model';
import { scoreProblem } from './scorer';
import type { Alignment, CheckResponse, MarkResult, Profile, Question, Transcript } from './types';

export interface MarkDeps {
  model: EngineModel;
  checker: CheckerCall;
}
const defaults = (): MarkDeps => ({ model: engineModelFor(), checker: callChecker });

/**
 * Marks one problem from a transcript the student has had the chance to confirm.
 * Throws EngineError (retryable) when the matcher or the checker could not be
 * reached; the caller must not count that attempt against the student.
 */
export async function markProblem(question: Question, profile: Profile, transcript: Transcript, deps: MarkDeps = defaults()): Promise<MarkResult> {
  if (transcript.lines.length === 0) {
    // Nothing written: nothing to align or check, and no model call to pay for.
    const alignment: Alignment = { lines: [], points: [] };
    const check: CheckResponse = { lines: [], transitions: [], points: [], final: 'unchecked' };
    return scoreProblem({ question, profile, transcript, alignment, check, judgements: question.points.filter((p) => p.kind === 'judge').map((p) => ({ id: p.id, met: false, line: null, quote: '' })) });
  }
  const [matched, judged] = await Promise.all([matchLines(question, transcript, deps), judgePoints(question, transcript, deps)]);
  const check = await deps.checker(buildCheckRequest(question, transcript, matched.alignment));
  if (check.kind === 'down') throw new EngineError('checker', 'The checker could not be reached');
  const result = scoreProblem({ question, profile, transcript, alignment: matched.alignment, check: check.data, judgements: judged.judgements });
  const usage = { input: matched.usage.input + judged.usage.input, output: matched.usage.output + judged.usage.output };
  return { ...result, trace: { ...(result.trace as object), usage } };
}

/**
 * Line numbers of maths the checker cannot parse, for the read-back to ask the
 * student to retype. A line with words in it (\text{...}) is left out: the checker
 * reads what maths it can from such a line and does not treat it as a step.
 */
export async function unparsedLines(question: Question, transcript: Transcript, deps: { checker: CheckerCall } = { checker: callChecker }): Promise<number[]> {
  const res = await deps.checker(buildCheckRequest({ ...question, points: [question.points[0]] }, transcript, { lines: [], points: [] }));
  if (res.kind === 'down') throw new EngineError('checker', 'The checker could not be reached');
  const words = new Set(transcript.lines.filter((l) => l.latex.includes('\\text')).map((l) => l.n));
  return res.data.lines.filter((l) => !l.parsed && !words.has(l.n)).map((l) => l.n);
}
