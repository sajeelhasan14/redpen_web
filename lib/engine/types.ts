// Shared shapes for the Calc I marking engine. See
// docs/superpowers/specs/2026-10-02-calc1-marking-engine-design.md.

export type Topic = 'limits' | 'derivatives' | 'related_rates' | 'optimisation' | 'mvt' | 'riemann' | 'ftc' | 'substitution';
export type CheckType = 'equivalent' | 'equation' | 'antiderivative' | 'exact_value';
export type TransitionKind = 'rewrite' | 'differentiate' | 'integrate' | 'take_limit' | 'substitute' | 'evaluate' | 'unknown';
export type Outcome = 'right' | 'wrong' | 'unchecked';
/** Fractions (0 to 1) of the image's width and height. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export interface RubricPoint {
  id: string;
  label: string;
  value: number;
  kind: 'cas' | 'judge';
  /** kind 'cas'. `expected` is SymPy syntax and may reference earlier points as {P1}. */
  check?: { type: CheckType; expected: string; /** antiderivative only: a missing +C raises the penalty flag. */ requireConstant?: boolean };
  /** kind 'judge': what the student must state. */
  criterion?: string;
  requires: string[];
  followThrough: boolean;
}

export interface Question {
  id: string;
  topic: Topic;
  prompt: string;
  /** The variable of differentiation or integration. */
  variable: string;
  /** Every symbol the rubric uses, including `variable` and unknowns such as dV_dt. */
  variables: string[];
  /** SymPy syntax for the expression the question starts from, when there is one. */
  given?: string;
  answer: string;
  points: RubricPoint[];
}

export interface Profile {
  id: string;
  followThrough: boolean;
  plusC: { penalty: number; scope: 'exam' };
  exactForm: boolean;
}

export interface TranscriptLine {
  n: number;
  /** Index of the image the line was read from. */
  image: number;
  latex: string;
  box: Box;
  confidence: 'high' | 'low';
  confirmed: boolean;
}
export interface Transcript {
  lines: TranscriptLine[];
}

export interface Alignment {
  lines: { n: number; transition: TransitionKind; substitution: { variable: string; latex: string } | null }[];
  points: { id: string; line: number | null }[];
}

export interface CheckRequest {
  variable: string;
  variables: string[];
  given: string | null;
  lines: { n: number; latex: string }[];
  transitions: { to: number; kind: TransitionKind; substitution: { variable: string; latex: string } | null }[];
  points: { id: string; type: CheckType; expected: string; followThrough: boolean; requireConstant: boolean; line: number | null }[];
  finalPoint: string | null;
}

export interface CheckResponse {
  lines: { n: number; parsed: boolean }[];
  transitions: { to: number; outcome: Outcome }[];
  /** `line` is the line the point was settled on: the matched line, or a later one where the result was finished. */
  points: { id: string; outcome: Outcome; ftOutcome: Outcome | null; ftRefused: boolean; note: 'missing_constant' | 'inexact' | null; line: number | null }[];
  final: Outcome;
}

export interface Judgement {
  id: string;
  met: boolean;
  line: number | null;
  quote: string;
}

export type PointStatus = 'earned' | 'earned_follow_through' | 'not_earned' | 'unchecked';
export interface PointResult {
  id: string;
  status: PointStatus;
  line?: number;
  verifiedBy: 'cas' | 'judge';
  reason: string;
}
export interface LineResult {
  n: number;
  image: number;
  status: 'ok' | 'wrong' | 'unchecked';
  box: Box;
}

export interface MarkResult {
  questionId: string;
  points: PointResult[];
  lines: LineResult[];
  earned: number;
  /** Excludes unchecked points. */
  total: number;
  /** Value of the points left out of both `earned` and `total`. */
  unchecked: number;
  penaltyFlags: string[];
  trace: unknown;
}

export interface ExamScore {
  earned: number;
  total: number;
  unchecked: number;
  penalties: { id: string; value: number }[];
}
