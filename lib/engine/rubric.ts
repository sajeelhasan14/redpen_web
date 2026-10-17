import { z } from 'zod';
import type { Question } from './types';

export const TOPICS = ['limits', 'derivatives', 'related_rates', 'optimisation', 'mvt', 'riemann', 'ftc', 'substitution'] as const;
export const CHECK_TYPES = ['equivalent', 'equation', 'antiderivative', 'exact_value'] as const;

const PointSchema = z.object({
  id: z.string().regex(/^P\d+$/),
  label: z.string().min(1).max(120),
  value: z.number().int().min(1).max(10),
  kind: z.enum(['cas', 'judge']),
  check: z
    .object({ type: z.enum(CHECK_TYPES), expected: z.string().min(1).max(300), requireConstant: z.boolean().optional() })
    .optional(),
  criterion: z.string().min(1).max(300).optional(),
  requires: z.array(z.string()),
  followThrough: z.boolean(),
});

export const QuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  topic: z.enum(TOPICS),
  prompt: z.string().min(1).max(600),
  variable: z.string().regex(/^[A-Za-z]$/),
  variables: z.array(z.string().regex(/^[A-Za-z][A-Za-z_]*$/)).min(1).max(12),
  given: z.string().min(1).max(300).optional(),
  answer: z.string().min(1).max(300),
  points: z.array(PointSchema).min(1).max(20),
});

const REF = /\{(P\d+)\}/g;

/** Rubric faults the schema cannot express. Empty when the rubric is sound. */
export function rubricProblems(q: Question): string[] {
  const out: string[] = [];
  if (!q.variables.includes(q.variable)) out.push(`variable ${q.variable} is not in variables`);
  const seen = new Map<string, 'cas' | 'judge'>();
  for (const p of q.points) {
    if (seen.has(p.id)) out.push(`${p.id}: duplicate id`);
    if (p.kind === 'cas' && (!p.check || p.criterion !== undefined)) out.push(`${p.id}: a cas point needs check and no criterion`);
    if (p.kind === 'judge' && (!p.criterion || p.check !== undefined)) out.push(`${p.id}: a judge point needs criterion and no check`);
    if (p.kind === 'judge' && p.followThrough) out.push(`${p.id}: a judge point cannot follow through`);
    for (const r of p.requires) if (!seen.has(r)) out.push(`${p.id}: requires ${r}, which is not an earlier point`);
    const refs = p.check ? [...p.check.expected.matchAll(REF)].map((m) => m[1]) : [];
    for (const r of refs) if (seen.get(r) !== 'cas') out.push(`${p.id}: expected references ${r}, which is not an earlier cas point`);
    if (p.followThrough && refs.length === 0) out.push(`${p.id}: followThrough needs an earlier point in expected`);
    if (p.check?.requireConstant && p.check.type !== 'antiderivative') out.push(`${p.id}: requireConstant is for antiderivative checks only`);
    seen.set(p.id, p.kind);
  }
  return out;
}

/** A validated question, or an Error naming every fault. Unknown keys are dropped. */
export function parseQuestion(raw: unknown): Question {
  const r = QuestionSchema.safeParse(raw);
  if (!r.success) throw new Error(`Invalid question: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const q = r.data as Question;
  const problems = rubricProblems(q);
  if (problems.length) throw new Error(`Invalid rubric for ${q.id}: ${problems.join('; ')}`);
  return q;
}
