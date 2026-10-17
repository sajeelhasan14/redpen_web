import { Annotation } from './types';
import { renderInk } from './ink';

// The student's page as a list of things on it, in the order they arrived.
// Rendering from this model - rather than treating the canvas as pixels -
// is what makes undo a pop, keeps the tutor's memory of its own marks exact,
// and lets the same page render crisply at any device pixel ratio.

export const PAGE_BG = '#fffdf7';
export const PEN = '#1c2733';
export const PEN_WIDTH = 4.5;

export type StudentStroke = { kind: 'stroke'; pts: [number, number][]; width: number; color: string };
export type TutorMark = { kind: 'tutor'; annotations: Annotation[] };
export type PageImage = { kind: 'image'; bitmap: CanvasImageSource; x: number; y: number; w: number; h: number };
export type PageItem = StudentStroke | TutorMark | PageImage;

export function drawStudentStroke(ctx: CanvasRenderingContext2D, s: StudentStroke) {
  if (s.pts.length === 0) return;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.pts[0][0], s.pts[0][1]);
  if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]); // a dot
  for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
  ctx.stroke();
}

export class Page {
  items: PageItem[] = [];

  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}

  push(item: PageItem) {
    this.items.push(item);
  }

  pop(): PageItem | undefined {
    return this.items.pop();
  }

  clear() {
    this.items = [];
  }

  get isEmpty() {
    return this.items.length === 0;
  }

  /** Every mark the tutor has burned into this page, in order. */
  tutorMarks(): Annotation[] {
    return this.items.flatMap((it) => (it.kind === 'tutor' ? it.annotations : []));
  }

  /** Whether the student has added anything since the tutor last marked. */
  studentWorkSinceLastMark(): boolean {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].kind === 'tutor') return false;
      return true;
    }
    return false;
  }

  /**
   * Cheap change-detection: two pages with the same signature look the same.
   * Items are immutable once pushed, so length plus a stamp of the last item
   * is enough. `n` gives the signature of the page's first n items.
   */
  signature(n = this.items.length): string {
    const last = this.items[n - 1];
    if (!last) return 'empty';
    let stamp: string;
    if (last.kind === 'stroke') {
      const a = last.pts[0];
      const b = last.pts[last.pts.length - 1];
      stamp = `s${last.pts.length}:${a[0] | 0},${a[1] | 0}-${b[0] | 0},${b[1] | 0}`;
    } else if (last.kind === 'tutor') stamp = `t${JSON.stringify(last.annotations).length}`;
    else stamp = `i${last.w | 0}x${last.h | 0}`;
    return `${n}:${stamp}`;
  }

  /**
   * Draws the whole page. ctx is expected to be in page units (already scaled for DPR).
   * `under` paints view-only decoration (the printed question) on the paper,
   * beneath the ink; the capture sent to the tutor never passes it.
   */
  render(ctx: CanvasRenderingContext2D, under?: (ctx: CanvasRenderingContext2D) => void) {
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, this.width, this.height);
    if (under) {
      ctx.save();
      under(ctx);
      ctx.restore();
    }
    for (const it of this.items) {
      if (it.kind === 'image') ctx.drawImage(it.bitmap, it.x, it.y, it.w, it.h);
      else if (it.kind === 'stroke') drawStudentStroke(ctx, it);
      else renderInk(ctx, it.annotations);
    }
  }
}

/** Fits an image inside the page with a margin, keeping its aspect ratio. */
export function fitImage(page: Page, iw: number, ih: number, margin = 24): { x: number; y: number; w: number; h: number } {
  const maxW = page.width - margin * 2;
  const maxH = page.height - margin * 2;
  const s = Math.min(maxW / iw, maxH / ih, 1.5);
  const w = iw * s;
  const h = ih * s;
  return { x: (page.width - w) / 2, y: (page.height - h) / 2, w, h };
}
