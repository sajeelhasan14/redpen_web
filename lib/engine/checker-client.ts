import { z } from 'zod';
import type { Alignment, CheckRequest, CheckResponse, Question, Transcript } from './types';

const OUTCOME = z.enum(['right', 'wrong', 'unchecked']);
export const CheckResponseSchema = z.object({
  lines: z.array(z.object({ n: z.number(), parsed: z.boolean() })),
  transitions: z.array(z.object({ to: z.number(), outcome: OUTCOME })),
  points: z.array(
    z.object({
      id: z.string(),
      outcome: OUTCOME,
      ftOutcome: OUTCOME.nullable(),
      ftRefused: z.boolean(),
      note: z.enum(['missing_constant', 'inexact']).nullable(),
      line: z.number().nullable(),
    }),
  ),
  final: OUTCOME,
});

/** What the checker is asked for one problem. The judge's points are not sent. */
export function buildCheckRequest(question: Question, transcript: Transcript, alignment: Alignment): CheckRequest {
  const stepOf = new Map(alignment.lines.map((l) => [l.n, l]));
  const lineOf = new Map(alignment.points.map((p) => [p.id, p.line]));
  const last = question.points[question.points.length - 1];
  return {
    variable: question.variable,
    variables: question.variables,
    given: question.given ?? null,
    lines: transcript.lines.map((l) => ({ n: l.n, latex: l.latex })),
    transitions: transcript.lines.map((l) => ({
      to: l.n,
      kind: stepOf.get(l.n)?.transition ?? 'unknown',
      substitution: stepOf.get(l.n)?.substitution ?? null,
    })),
    points: question.points
      .filter((p) => p.kind === 'cas' && p.check)
      .map((p) => ({
        id: p.id,
        type: p.check!.type,
        expected: p.check!.expected,
        followThrough: p.followThrough,
        requireConstant: p.check!.requireConstant === true,
        line: lineOf.get(p.id) ?? null,
      })),
    finalPoint: last.kind === 'cas' ? last.id : null,
  };
}

export type CheckerCall = (req: CheckRequest) => Promise<{ kind: 'ok'; data: CheckResponse } | { kind: 'down' }>;

export function checkerTimeoutMs(): number {
  const v = Number(process.env.CHECKER_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

/** Calls the private SymPy service. Any failure is `down`: the caller decides what that means. */
export const callChecker: CheckerCall = async (req) => {
  const base = process.env.CHECKER_URL?.trim().replace(/\/+$/, '');
  if (!base) {
    console.error('engine: CHECKER_URL is not set');
    return { kind: 'down' };
  }
  try {
    const res = await fetch(`${base}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-checker-secret': process.env.CHECKER_SECRET ?? '' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(checkerTimeoutMs()),
    });
    if (!res.ok) {
      console.error('engine: checker answered', res.status);
      return { kind: 'down' };
    }
    const parsed = CheckResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.error('engine: checker reply did not match the schema');
      return { kind: 'down' };
    }
    return { kind: 'ok', data: parsed.data };
  } catch (err) {
    console.error('engine: checker call failed', err instanceof Error ? err.message : String(err));
    return { kind: 'down' };
  }
};
