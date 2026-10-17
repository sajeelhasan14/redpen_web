import { z } from 'zod';
import type { Annotation, PageLayout } from '@/lib/types';

// Output schema, copied from the POC tutor route. Field order matters: the model
// fills these in order, so the verification comes before the verdict.

export const AnnotationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('strike'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ kind: z.literal('write'), x: z.number(), y: z.number(), text: z.string(), size: z.enum(['small', 'normal', 'big']) }),
  z.object({ kind: z.literal('circle'), x: z.number(), y: z.number(), rx: z.number(), ry: z.number() }),
  z.object({ kind: z.literal('arrow'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ kind: z.literal('text'), x: z.number(), y: z.number(), text: z.string() }),
  z.object({ kind: z.literal('line'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ kind: z.literal('rect'), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  z.object({ kind: z.literal('path'), pts: z.array(z.object({ x: z.number(), y: z.number() })) }),
  z.object({ kind: z.literal('ring'), text: z.string() }),
]);

export const ReplyPlain = z.object({
  worthResponding: z.boolean(),
  correct: z.boolean(),
  speech: z.string(),
  annotations: z.array(AnnotationSchema),
});

export const LessonSchema = z.object({
  steps: z.array(z.object({ say: z.string(), write: z.array(AnnotationSchema) })),
});

export function validAnnotation(a: unknown): a is Annotation {
  const r = AnnotationSchema.safeParse(a);
  if (!r.success) return false;
  const v = r.data;
  if ('text' in v) return v.text.length > 0 && v.text.length <= 80;
  if (v.kind === 'path') return v.pts.length >= 2 && v.pts.length <= 60;
  if (v.kind === 'rect') return v.w > 2 && v.h > 2;
  return true;
}

// Client-sent page layout. It goes into the prompt, so it is validated strictly:
// finite numbers only, a bounded number of regions, and `where` from a fixed list.
const fin = z.number().refine(Number.isFinite);
const BoxSchema = z.object({ x0: fin, y0: fin, x1: fin, y1: fin });
const FreeRegionSchema = BoxSchema.extend({
  where: z.enum(['left of it', 'right of it', 'below it', 'above it', 'the whole page']),
  charsNormal: fin,
  charsSmall: fin,
});
export const LayoutSchema = z.object({
  student: BoxSchema.nullable(),
  tutor: BoxSchema.nullable(),
  free: z.array(FreeRegionSchema).max(8),
});

/** A valid layout, or undefined: a malformed one is dropped rather than refused. */
export function parseLayout(v: unknown): PageLayout | undefined {
  const r = LayoutSchema.safeParse(v);
  return r.success ? r.data : undefined;
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[−‒–—‐‑﹣－]/g, '-');

/**
 * True when a piece of tutor-written text would hand over the question's final
 * result: it contains the key's result (e.g. "x = 11", "x=11") as a whole value,
 * so "x = 110" or "2x = 11" do not count.
 */
export function revealsAnswer(text: string, answer: string): boolean {
  const a = normalise(answer);
  if (!a) return false;
  const t = normalise(text);
  for (let i = t.indexOf(a); i !== -1; i = t.indexOf(a, i + 1)) {
    if (/[\d.]/.test(t[i - 1] ?? '')) continue;
    // A digit or a variable straight after it means a longer number or a coefficient: the 6 in "60" or "6x" is not 6.
    if (/\d/.test(a[a.length - 1]) && /^(\d|[./]\d|[a-z])/.test(t.slice(i + a.length, i + a.length + 2))) continue;
    return true;
  }
  return false;
}

/**
 * Drops write/text annotations that state the final result in any form (the key's
 * result line, a bare "= 11", "10 cm", "17/12") or use a banned word. A corrected
 * intermediate value ("−6", "3x − 6", "5 + 6") is kept.
 */
export function withoutAnswer(anns: Annotation[], q: { answer: string; spokenForms: readonly string[] }): Annotation[] {
  return anns.filter((a) => !((a.kind === 'write' || a.kind === 'text') && (statesResult(a.text, q) || hasBannedWord(a.text))));
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5,
  sixth: 6, sixths: 6, seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9, tenth: 10, tenths: 10,
  eleventh: 11, elevenths: 11, twelfth: 12, twelfths: 12,
};

/**
 * Spoken or written text in one canonical form, so every way of stating a value
 * looks the same: lowercase, one kind of dash, number words as digits, fractions
 * as a/b ("five twelfths", "5 over 12", "5⁄12", "17/12ths" → 5/12, 17/12), mixed
 * numbers as "1 5/12" ("one and five twelfths", "1 and 5/12"), lengths as "10 cm".
 */
export function canonical(s: string): string {
  let t = s
    .toLowerCase()
    .replace(/[\u2044\u2215]/g, '/')
    .replace(/[−‒–—‐‑﹣－]/g, '-')
    .replace(/(?<=[a-z])-(?=[a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\b[a-z]+\b/g, (w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w));
  t = t.replace(/\b(\d+) ([a-z]+)\b/g, (m, n: string, w: string) => (w in DENOMINATORS ? `${n}/${DENOMINATORS[w]}` : m));
  t = t.replace(/(\d+) ?(?:over|\/) ?(\d+)/g, '$1/$2');
  t = t.replace(/(\d+\/\d+)(?:st|nd|rd|th)s?\b/g, '$1');
  t = t.replace(/(\d+) and (\d+\/\d+)/g, '$1 $2');
  t = t.replace(/(\d+) ?(?:centimetres?|centimeters?|cm)\b/g, '$1 cm');
  return t;
}

/**
 * True when spoken or shown text states the question's final value: the key's
 * result line, or any of its spoken forms as a whole token ("11" and "eleven"
 * for x = 11, but not the 11 in "110", "11.5" or "x = 1"). Both sides are
 * compared in canonical form, so mixed digit/word forms match too.
 */
export function statesResult(text: string, q: { answer: string; spokenForms: readonly string[] }): boolean {
  if (revealsAnswer(text, q.answer)) return true;
  const t = canonical(text);
  return [q.answer, ...q.spokenForms].some((f) => {
    const form = canonical(f);
    return form.length > 0 && new RegExp(`(?<![\\w./])${escapeRe(form)}(?![\\w]|[./]\\d)`).test(t);
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// The copy rules ban these in anything the student sees or hears.
const BANNED = /\b(solv\w*|answer\w*)\b/i;
export const hasBannedWord = (text: string) => BANNED.test(text);

/** Drops every sentence that uses a banned word; '' when none survive. */
export function withoutBannedSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !hasBannedWord(s))
    .join(' ')
    .trim();
}
