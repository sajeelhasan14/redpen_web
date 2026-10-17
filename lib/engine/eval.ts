import { EngineError } from './model';
import type { MarkResult } from './types';

// The launch bar from the spec. A hand-in path may go live when both hold on its own evaluation set.
export const FALSE_RED_MAX = 0.02;
export const AGREEMENT_MIN = 0.85;

export type HandInPath = 'canvas' | 'photo';

/** What the human grader recorded for one solution, without seeing the engine's output. */
export interface GraderMark {
  /** Rubric point id -> awarded. */
  points: Record<string, boolean>;
  score: number;
  /** How many of the student's lines the grader judged correct. */
  correctLines: number;
}
export interface EvalSolution {
  id: string;
  questionId: string;
  path: HandInPath;
  /** Image paths relative to the manifest. */
  images: string[];
  grader: GraderMark;
}
/** `result` is null when the engine asked for a retake or failed: it scored nothing and settled nothing. */
export interface EvalRun {
  solution: EvalSolution;
  result: MarkResult | null;
}
/** Second pass: for each line the engine marked wrong, did the grader agree it is wrong? solution id -> line n -> really wrong. */
export type Adjudication = Record<string, Record<string, boolean>>;

export interface PathMetrics {
  path: HandInPath;
  solutions: number;
  /** null until every red line has been adjudicated. */
  falseRedRate: number | null;
  pendingRedLines: number;
  scoreAgreement: number;
  falseCreditRate: number;
  coverage: number;
  /** null while the false-red rate is pending. */
  passes: boolean | null;
}

export function redLines(runs: EvalRun[]): { solutionId: string; line: number }[] {
  return runs.flatMap((r) => (r.result?.lines ?? []).filter((l) => l.status === 'wrong').map((l) => ({ solutionId: r.solution.id, line: l.n })));
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function metricsFor(path: HandInPath, all: EvalRun[], adjudication: Adjudication): PathMetrics {
  const runs = all.filter((r) => r.solution.path === path);
  const reds = redLines(runs);
  const verdicts = reds.map((r) => adjudication[r.solutionId]?.[String(r.line)]);
  const pending = verdicts.filter((v) => v === undefined).length;
  const falseReds = verdicts.filter((v) => v === false).length;
  const correctLines = runs.reduce((a, r) => a + r.solution.grader.correctLines, 0);

  // An unchecked point is not in `earned`, so it already counts as not earned here.
  const agree = runs.filter((r) => Math.abs((r.result?.earned ?? 0) - r.solution.grader.score) <= 1).length;

  let credited = 0;
  let falseCredit = 0;
  let points = 0;
  let unchecked = 0;
  for (const r of runs) {
    const graded = Object.keys(r.solution.grader.points).length;
    points += graded;
    if (!r.result) {
      unchecked += graded;
      continue;
    }
    for (const p of r.result.points) {
      if (p.status === 'unchecked') unchecked += 1;
      if (p.status === 'earned' || p.status === 'earned_follow_through') {
        credited += 1;
        if (r.solution.grader.points[p.id] === false) falseCredit += 1;
      }
    }
  }

  const falseRedRate = pending > 0 ? null : ratio(falseReds, correctLines);
  const scoreAgreement = ratio(agree, runs.length);
  return {
    path,
    solutions: runs.length,
    falseRedRate,
    pendingRedLines: pending,
    scoreAgreement,
    falseCreditRate: ratio(falseCredit, credited),
    coverage: points === 0 ? 0 : 1 - unchecked / points,
    passes: runs.length === 0 ? false : falseRedRate === null ? null : falseRedRate <= FALSE_RED_MAX && scoreAgreement >= AGREEMENT_MIN,
  };
}

/**
 * Runs one solution through the engine. `final` is false when the engine failed
 * for a reason that may not happen again (an API error, the checker down): such a
 * run must not be cached, so a resumed evaluation tries it again instead of
 * counting an outage against the engine. A retake request (`null`) is final.
 */
export async function attempt(run: () => Promise<MarkResult | null>): Promise<{ result: MarkResult | null; final: boolean }> {
  try {
    return { result: await run(), final: true };
  } catch (err) {
    if (!(err instanceof EngineError)) throw err;
    return { result: null, final: false };
  }
}
