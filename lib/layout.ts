import type { Annotation, Box, FreeRegion, PageLayout } from './types';
import type { Page } from './page';
import { emFor, measureWritten, type Measure } from './ink';

// Layout facts the page model knows exactly and the vision model only guesses:
// where the student's work is, where there is room to write, and where the
// tutor's own written lines ended up. Used to steer the prompt and to fix up
// the model's marks before they are drawn.

const MARGIN = 40;
const GAP = 22;
/**
 * The top of the student's view shows the printed question (components/TryIt
 * draws it; it never enters the capture). The model is told to keep above
 * BAND_BOTTOM clear, free regions start at FREE_TOP, and tutor writing that
 * would reach into the band is nudged below it.
 */
export const BAND_BOTTOM = 100;
export const FREE_TOP = 104;
/** Average advance per character at each size, from the glyph widths. */
const PX_PER_CHAR = { normal: 19.5, small: 13 };

function union(a: Box | null, b: Box): Box {
  return a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b;
}

function region(where: FreeRegion['where'], x0: number, y0: number, x1: number, y1: number): FreeRegion | null {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 140 || h < 60) return null;
  return {
    where,
    x0: Math.round(x0),
    y0: Math.round(y0),
    x1: Math.round(x1),
    y1: Math.round(y1),
    charsNormal: Math.floor(w / PX_PER_CHAR.normal),
    charsSmall: Math.floor(w / PX_PER_CHAR.small),
  };
}

/** Box around the tutor's marks, using exact text extents for written lines. */
function tutorBox(marks: Annotation[], measure: Measure): Box | null {
  let box: Box | null = null;
  for (const a of marks) {
    let b: Box | null = null;
    if (a.kind === 'write' || a.kind === 'text') {
      const em = a.kind === 'write' ? emFor(a.size) : TEXT_EM;
      const w = measureWritten(a.text, em, measure);
      b = { x0: a.x, y0: a.y - em * 0.72, x1: a.x + w, y1: a.y + em * 0.3 };
    } else if (a.kind === 'circle') b = { x0: a.x - a.rx, y0: a.y - a.ry, x1: a.x + a.rx, y1: a.y + a.ry };
    else if (a.kind === 'rect') b = { x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h };
    else if (a.kind === 'line' || a.kind === 'arrow' || a.kind === 'strike')
      b = { x0: Math.min(a.x1, a.x2), y0: Math.min(a.y1, a.y2), x1: Math.max(a.x1, a.x2), y1: Math.max(a.y1, a.y2) };
    else if (a.kind === 'path') {
      const xs = a.pts.map((p) => p.x);
      const ys = a.pts.map((p) => p.y);
      b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    if (b) box = union(box, b);
  }
  return box;
}

export function computeLayout(page: Page, measure: Measure): PageLayout {
  let student: Box | null = null;
  for (const it of page.items) {
    if (it.kind === 'stroke') {
      for (const [x, y] of it.pts) student = union(student, { x0: x, y0: y, x1: x, y1: y });
    } else if (it.kind === 'image') student = union(student, { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h });
  }
  if (student) student = { x0: Math.floor(student.x0) - 6, y0: Math.floor(student.y0) - 6, x1: Math.ceil(student.x1) + 6, y1: Math.ceil(student.y1) + 6 };

  const tutor = tutorBox(page.tutorMarks(), measure);
  const taken = student && tutor ? union(student, tutor) : (student ?? tutor);

  const W = page.width;
  const H = page.height;
  const free: FreeRegion[] = [];
  if (!taken) {
    const r = region('the whole page', MARGIN, FREE_TOP, W - MARGIN, H - MARGIN);
    if (r) free.push(r);
  } else {
    const cands = [
      region('left of it', MARGIN, FREE_TOP, taken.x0 - GAP, H - MARGIN),
      region('right of it', taken.x1 + GAP, FREE_TOP, W - MARGIN, H - MARGIN),
      region('below it', MARGIN, Math.max(FREE_TOP, taken.y1 + GAP + 24), W - MARGIN, H - MARGIN),
      region('above it', MARGIN, FREE_TOP, W - MARGIN, taken.y0 - GAP),
    ].filter((r): r is FreeRegion => r !== null);
    // Biggest first: the model is told to pick one region and stay in it.
    cands.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    free.push(...cands);
  }
  return { student, tutor, free };
}

/** A written line the tutor has put down, with its exact geometry. */
export interface WrittenLine {
  x: number;
  y: number;
  text: string;
  em: number;
}

export function writtenLines(marks: Annotation[]): WrittenLine[] {
  return marks.flatMap((a) => (a.kind === 'write' ? [{ x: a.x, y: a.y, text: a.text, em: emFor(a.size) }] : []));
}

/** Em of a "text" hint, as drawn by lib/ink. */
const TEXT_EM = 19;

/** A baseline low enough that text of this em starts below the question band. */
function belowBand(y: number, em: number) {
  return Math.max(y, FREE_TOP, Math.round(BAND_BOTTOM + em * 0.72 + 2));
}

function textBox(x: number, y: number, w: number, em: number): Box {
  return { x0: x, y0: y - em * 0.72, x1: x + w, y1: y + em * 0.25 };
}

/**
 * Where a line `w` wide at `em` can go in the first free region that fits it,
 * below any line already written there in this reply; null when none fits.
 */
function freeSpot(layout: PageLayout, lines: WrittenLine[], w: number, em: number): { x: number; y: number } | null {
  for (const r of layout.free) {
    if (r.x1 - r.x0 < w) continue;
    const inside = lines.filter((l) => l.x >= r.x0 && l.x <= r.x1 && l.y >= r.y0 && l.y <= r.y1);
    const top = Math.round(r.y0 + em * 0.72 + 4);
    const y = inside.length ? Math.max(top, Math.round(Math.max(...inside.map((l) => l.y + l.em * 0.25)) + em * 0.72 + 18)) : top;
    if (y + em * 0.25 <= r.y1) return { x: r.x0, y };
  }
  return null;
}

function overlaps(a: Box, b: Box) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/**
 * Fixes up the model's marks with what the page knows:
 *  - "ring" becomes a circle around the exact extent of text the tutor wrote;
 *  - a written line that would run over the student's work or off the page is
 *    written smaller, and if still too wide, nudged left;
 *  - a written line or hint that would reach up into the question band is
 *    nudged down below it; if that lands it on the student's work, it moves to
 *    the first free region that fits it, or is dropped (strikes and circles on
 *    the student's own strokes are left where they are).
 */
export function resolveMarks(marks: Annotation[], written: WrittenLine[], layout: PageLayout, pageW: number, measure: Measure): Annotation[] {
  const lines = [...written];
  const out: Annotation[] = [];
  for (const a of marks) {
    if (a.kind === 'ring') {
      const needle = a.text.trim();
      const rec = [...lines].reverse().find((l) => l.text.includes(needle)) ?? lines[lines.length - 1];
      if (!rec) continue;
      const idx = rec.text.includes(needle) ? rec.text.indexOf(needle) : 0;
      const sub = rec.text.includes(needle) ? needle : rec.text;
      const left = rec.x + measureWritten(rec.text.slice(0, idx), rec.em, measure);
      const w = measureWritten(sub, rec.em, measure);
      const capH = rec.em * 0.72;
      out.push({ kind: 'circle', x: left + w / 2, y: rec.y - capH * 0.38, rx: w / 2 + rec.em * 0.4, ry: capH * 0.95 });
      continue;
    }
    // Long arrows are what turns a page into a mess; the labels already link
    // working to drawing. Keep only short, local pointers.
    if (a.kind === 'arrow' && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 160) continue;
    if (a.kind === 'text') {
      const y = belowBand(a.y, TEXT_EM);
      const w = measureWritten(a.text, TEXT_EM, measure);
      if (y !== a.y && layout.student && overlaps(textBox(a.x, y, w, TEXT_EM), layout.student)) {
        const spot = freeSpot(layout, lines, w, TEXT_EM);
        if (spot) out.push({ ...a, ...spot });
        continue;
      }
      out.push({ ...a, y });
      continue;
    }
    if (a.kind === 'write') {
      let size = a.size;
      let x = a.x;
      // A "small" label on a big drawing is illegible next to the student's hand.
      if (size === 'small' && layout.student && layout.student.y1 - layout.student.y0 > 200) {
        const em = emFor('small');
        const inside = a.x >= layout.student.x0 - 60 && a.x <= layout.student.x1 + 60 && a.y - em >= layout.student.y0 - 60 && a.y <= layout.student.y1 + 60;
        if (inside) size = 'normal';
      }
      const fits = (sz: typeof size, xx: number) => {
        const em = emFor(sz);
        const y = belowBand(a.y, em);
        const w = measureWritten(a.text, em, measure);
        const box: Box = { x0: xx, y0: y - em * 0.72, x1: xx + w, y1: y + em * 0.25 };
        const hitsStudent = layout.student ? overlaps(box, layout.student) : false;
        return { ok: !hitsStudent && box.x1 <= pageW - 12, w, hitsStudent };
      };
      let f = fits(size, x);
      if (!f.ok && size !== 'small') {
        size = size === 'big' ? 'normal' : 'small';
        f = fits(size, x);
      }
      if (!f.ok && !f.hitsStudent) x = Math.max(24, pageW - 12 - f.w); // off the right edge: pull it back
      let y = belowBand(a.y, emFor(size));
      if (y !== a.y && f.hitsStudent) {
        // Nudged out of the band onto the student's work: write it in free space instead.
        let spot: { x: number; y: number } | null = null;
        for (const sz of size === 'small' ? (['small'] as const) : ([size, 'small'] as const)) {
          spot = freeSpot(layout, lines, measureWritten(a.text, emFor(sz), measure), emFor(sz));
          if (spot) {
            size = sz;
            break;
          }
        }
        if (!spot) continue;
        ({ x, y } = spot);
      }
      const fixed: Annotation = { ...a, x, y, size };
      out.push(fixed);
      lines.push({ x, y, text: a.text, em: emFor(size) });
      continue;
    }
    out.push(a);
  }
  return out;
}
