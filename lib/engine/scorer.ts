import type { Alignment, CheckResponse, ExamScore, Judgement, LineResult, MarkResult, PointResult, PointStatus, Profile, Question, Transcript, TranscriptLine } from './types';

export const MISSING_PLUS_C = 'missing_plus_c';
/** A different method must show working: the question restated and an answer is not a method. */
export const MIN_CHAIN_LINES = 3;

export const REASONS = {
  earned: 'Correct',
  followThrough: 'Correct from your earlier value',
  validMethod: 'Correct by a different method',
  notAttempted: 'Not attempted',
  wrong: 'This step is not correct',
  noReason: 'No reason given',
  unread: 'Could not read this line with confidence',
  unchecked: 'Could not check this point',
  inexact: 'Decimal given; could not check it against the exact value',
} as const;

export interface ScoreInput {
  question: Question;
  profile: Profile;
  transcript: Transcript;
  alignment: Alignment;
  check: CheckResponse;
  /** null when the judge could not be reached: judged points become unchecked. */
  judgements: Judgement[] | null;
}

const trusted = (l: TranscriptLine | undefined) => !!l && (l.confidence === 'high' || l.confirmed);
// For comparing a judge's quote with a line: the judge may copy the words without their \text{...} wrapper.
const squash = (s: string) => s.replace(/\\text|[{}\s]/g, '');
const isEarned = (s: PointStatus | undefined) => s === 'earned' || s === 'earned_follow_through';

export function scoreProblem(i: ScoreInput): MarkResult {
  const { question, profile, transcript, alignment, check, judgements } = i;
  const lineByN = new Map(transcript.lines.map((l) => [l.n, l]));
  const lineOf = new Map(alignment.points.map((p) => [p.id, p.line]));
  const status = new Map<string, PointStatus>();
  /** The line each point was settled on, for the line statuses below. */
  const settledOn = new Map<string, number>();
  const wrongLines = new Set<number>();
  const flags = new Set<string>();
  const points: PointResult[] = [];
  let ftBlocked = false;

  for (const p of question.points) {
    const c = p.kind === 'cas' ? check.points.find((x) => x.id === p.id) : undefined;
    // The checker may have found the point finished on a line after the matched one.
    const n = c?.line ?? lineOf.get(p.id) ?? null;
    const line = n === null ? undefined : lineByN.get(n);
    let st: PointStatus;
    let reason: string;
    let proven = false;
    let lineRef: number | undefined = line?.n;

    if (p.kind === 'judge') {
      const j = judgements?.find((x) => x.id === p.id);
      const quoted = j && j.line !== null ? lineByN.get(j.line) : undefined;
      if (!judgements) [st, reason] = ['unchecked', REASONS.unchecked];
      else if (j?.met && quoted && squash(j.quote) && squash(quoted.latex).includes(squash(j.quote))) {
        [st, reason] = ['earned', REASONS.earned];
        lineRef = quoted.n;
      } else [st, reason] = ['not_earned', REASONS.noReason];
    } else {
      const ftAllowed = profile.followThrough && p.followThrough && !!c && !c.ftRefused && !ftBlocked;
      if (!line) [st, reason] = ['not_earned', REASONS.notAttempted];
      else if (!c) [st, reason] = ['unchecked', REASONS.unchecked];
      else if (c.outcome === 'right') {
        [st, reason] = ['earned', REASONS.earned];
        if (c.note === 'missing_constant') flags.add(MISSING_PLUS_C);
      } else if (c.outcome === 'unchecked') {
        if (c.note === 'inexact') [st, reason] = profile.exactForm ? ['unchecked', REASONS.inexact] : ['earned', REASONS.earned];
        else [st, reason] = ['unchecked', REASONS.unchecked];
      } else if (!trusted(line)) [st, reason] = ['unchecked', REASONS.unread];
      else if (ftAllowed && c.ftOutcome === 'right') [st, reason] = ['earned_follow_through', REASONS.followThrough];
      else if (ftAllowed && c.ftOutcome === 'unchecked') [st, reason] = ['unchecked', REASONS.unchecked];
      else {
        [st, reason] = ['not_earned', REASONS.wrong];
        proven = true;
      }
      // A carried value that makes the problem easier ends follow-through for the rest of the problem.
      if (c?.ftRefused) ftBlocked = true;
    }

    if (isEarned(st)) {
      const needs = p.requires.map((id) => ({ id, s: status.get(id) }));
      const missing = needs.filter((x) => x.s === 'not_earned' || x.s === undefined);
      if (missing.length) [st, reason] = ['not_earned', `Needs ${missing.map((x) => x.id).join(', ')}`];
      else if (needs.some((x) => x.s === 'unchecked')) [st, reason] = ['unchecked', REASONS.unchecked];
    }
    if (proven && line) wrongLines.add(line.n);
    if (lineRef !== undefined) settledOn.set(p.id, lineRef);
    status.set(p.id, st);
    points.push({ id: p.id, status: st, ...(lineRef === undefined ? {} : { line: lineRef }), verifiedBy: p.kind, reason });
  }

  // Any valid method: every step from the question to a final line equal to the answer is proven right.
  const transitionOf = new Map(check.transitions.map((t) => [t.to, t.outcome]));
  // Lines of words do not parse and are skipped; every line of maths must be proven.
  const maths = check.lines.filter((l) => l.parsed);
  const chainProven = check.final === 'right' && maths.length >= MIN_CHAIN_LINES && maths.every((l) => transitionOf.get(l.n) === 'right');
  if (chainProven) {
    wrongLines.clear();
    question.points.forEach((p, k) => {
      if (p.kind !== 'cas' || isEarned(status.get(p.id))) return;
      status.set(p.id, 'earned');
      points[k] = { ...points[k], status: 'earned', reason: REASONS.validMethod };
    });
  }

  const parsed = new Map(check.lines.map((l) => [l.n, l.parsed]));
  const mathsAbove = (k: number) => transcript.lines.slice(0, k).reverse().find((l) => parsed.get(l.n));
  const lines: LineResult[] = transcript.lines.map((l, k) => {
    const here = question.points.filter((p) => settledOn.get(p.id) === l.n);
    const t = transitionOf.get(l.n);
    let st: LineResult['status'] = 'unchecked';
    // A line that earned a point is right, whatever another point matched to it made of it.
    if (here.some((p) => isEarned(status.get(p.id)))) st = 'ok';
    // A step proven to follow from the line above is not this line's error, even
    // when the point is lost (the error is further up, or the line was mismatched).
    else if (wrongLines.has(l.n)) st = t === 'right' ? 'unchecked' : 'wrong';
    else if (here.length === 0) {
      // The step was checked against the nearest line of maths above (or the question itself).
      const prev = mathsAbove(k);
      if (t === 'right') st = 'ok';
      else if (t === 'wrong' && parsed.get(l.n) && trusted(l) && (!prev || trusted(prev))) st = 'wrong';
    }
    return { n: l.n, image: l.image, status: st, box: l.box };
  });

  const sum = (f: (s: PointStatus) => boolean) => question.points.reduce((a, p) => a + (f(status.get(p.id)!) ? p.value : 0), 0);
  return {
    questionId: question.id,
    points,
    lines,
    earned: sum(isEarned),
    total: sum((s) => s !== 'unchecked'),
    unchecked: sum((s) => s === 'unchecked'),
    penaltyFlags: [...flags],
    trace: { transcript, alignment, check, judgements },
  };
}

/** Exam-scope penalties are applied once, however many problems raise the flag. */
export function scoreExam(results: MarkResult[], profile: Profile): ExamScore {
  const penalties: ExamScore['penalties'] = [];
  if (profile.plusC.penalty > 0 && results.some((r) => r.penaltyFlags.includes(MISSING_PLUS_C)))
    penalties.push({ id: MISSING_PLUS_C, value: profile.plusC.penalty });
  const raw = results.reduce((a, r) => a + r.earned, 0);
  return {
    earned: Math.max(0, raw - penalties.reduce((a, p) => a + p.value, 0)),
    total: results.reduce((a, r) => a + r.total, 0),
    unchecked: results.reduce((a, r) => a + r.unchecked, 0),
    penalties,
  };
}
