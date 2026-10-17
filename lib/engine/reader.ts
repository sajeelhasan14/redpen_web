import { z } from 'zod';
import { EngineError, engineModelFor, withRetry, type EngineImage, type EngineModel, type EngineUsage } from './model';
import type { Question, Transcript } from './types';

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BASE64 = 6_000_000;
export const MAX_LINES = 40;
export const MAX_LATEX = 400;

export const RETAKE_DEFAULT = 'We could not read this. Please retake the photo straight on, in good light.';
export const RETAKE_EMPTY = 'No working was found on this page.';
export const RETAKE_TOO_LARGE = 'That image is too large. Please retake it at a lower resolution.';

const Frac = z.number();
export const ReaderSchema = z.object({
  readable: z.boolean(),
  retakeReason: z.string(),
  lines: z.array(
    z.object({
      image: z.number(),
      latex: z.string(),
      box: z.object({ x0: Frac, y0: Frac, x1: Frac, y1: Frac }),
      confidence: z.enum(['high', 'low']),
    }),
  ),
});

export const READER_SYSTEM = `You transcribe a student's handwritten calculus working. You do not mark it.

Return one entry per written line, in reading order.

Rules for each line:
- Copy exactly what is written, including mistakes. Never correct, complete or tidy the maths.
- Write LaTeX using only: \\frac, \\sqrt, ^{}, _{}, \\sin \\cos \\tan \\sec \\csc \\cot, \\arcsin \\arccos \\arctan, \\ln, \\log, \\int, \\lim, \\to, \\infty, \\pi, \\theta, \\Delta, \\cdot, \\sum, \\left, \\right.
- Always put braces round an exponent or subscript: x^{2}, \\int_{0}^{2}, x^{10}.
- Write a derivative as a fraction, \\frac{dy}{dx}, never dy/dx.
- If the line begins with an equals sign, begin the LaTeX with =.
- For an evaluation bar or bracket with limits, write only the expression being evaluated.
- Put words inside \\text{...}. A line of only words is one \\text{...}.
- Skip anything crossed out.
- box is the line's position as fractions of that image's width and height: x0,y0 top-left, x1,y1 bottom-right, each between 0 and 1.
- image is the index of the image the line is on, starting at 0.
- confidence is "low" if any character is unclear or could be read two ways, otherwise "high".

If the image is too blurred, dark, rotated or cropped to read, or shows no handwritten maths, set readable to false, give a short retakeReason telling the student what to fix, and return no lines. Otherwise set readable to true and retakeReason to "".`;

/** The question is shown only to settle which letters are variables, never to guess what was meant. */
export function readerInstruction(question: Question, imageCount: number): string {
  return [
    `The student is answering: ${question.prompt}`,
    `Variables in this question: ${question.variables.join(', ')}.`,
    `There ${imageCount === 1 ? 'is 1 image' : `are ${imageCount} images`}.`,
    'Do not use the question to guess what the student meant. Transcribe what is on the page.',
  ].join('\n');
}

export type ReadOutcome =
  | { kind: 'transcript'; transcript: Transcript; usage: EngineUsage }
  | { kind: 'retake'; reason: string };

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const unit = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export async function readProblem(
  images: EngineImage[],
  question: Question,
  deps: { model: EngineModel } = { model: engineModelFor() },
): Promise<ReadOutcome> {
  if (images.length === 0 || images.length > MAX_IMAGES) throw new TypeError(`readProblem takes 1 to ${MAX_IMAGES} images`);
  if (images.some((i) => i.base64.length > MAX_IMAGE_BASE64)) return { kind: 'retake', reason: RETAKE_TOO_LARGE };

  const res = await withRetry(() =>
    deps.model({ role: 'reader', system: READER_SYSTEM, instruction: readerInstruction(question, images.length), images, schema: ReaderSchema }),
  );
  if (res.kind === 'fail') throw new EngineError('reader', `The reader failed: ${res.reason}`);
  if (!res.data.readable) return { kind: 'retake', reason: clean(res.data.retakeReason, 200) || RETAKE_DEFAULT };

  const lines = res.data.lines
    .map((l) => ({ ...l, latex: clean(l.latex, MAX_LATEX + 1) }))
    .filter((l) => l.latex)
    .slice(0, MAX_LINES)
    .map((l, k) => {
      const [x0, x1] = [unit(l.box.x0), unit(l.box.x1)].sort((a, b) => a - b);
      const [y0, y1] = [unit(l.box.y0), unit(l.box.y1)].sort((a, b) => a - b);
      const tooLong = l.latex.length > MAX_LATEX;
      return {
        n: k + 1,
        image: Math.min(images.length - 1, Math.max(0, Math.round(Number.isFinite(l.image) ? l.image : 0))),
        latex: l.latex.slice(0, MAX_LATEX),
        box: { x0, y0, x1, y1 },
        // A line cut short cannot be trusted to say what the student wrote.
        confidence: tooLong ? ('low' as const) : l.confidence,
        confirmed: false,
      };
    });
  if (lines.length === 0) return { kind: 'retake', reason: RETAKE_EMPTY };
  return { kind: 'transcript', transcript: { lines }, usage: res.usage };
}
