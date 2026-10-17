import { PEN } from './page';
import { BAND_BOTTOM } from './layout';

// View-only decoration on the student's sheet: the printed question at the top
// and, on an empty page, a faint hint of where to start. Drawn by TryIt beneath
// the ink (Page.render's `under`), never into the capture the tutor sees; the
// tutor is told the band is there (lib/layout BAND_BOTTOM, lib/mark/prompt).

const TYPE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const HAND = '"Bradley Hand", "Marker Felt", "Segoe Print", "Comic Sans MS", cursive';
const LABEL = '#7a8290';
const RULE = '#d9d4c7';
const LEFT = 26;
const RIGHT = 26;
const TOP = 12;
/** The band's bottom edge (its rule) never goes below this. */
const BAND_MAX = BAND_BOTTOM - 4;

export const HINT = 'write your first step here, then pause';

type Ctx = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

/** Greedy word wrap of `text` into lines no wider than `width` at the ctx's current font. */
function wrap(ctx: Ctx, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export interface BandLayout {
  size: number;
  labelSize: number;
  labelWidth: number;
  textX: number;
  baselines: number[];
  lines: string[];
  ruleY: number;
}

/**
 * Lays the question out in the band: one line at 26 units, or two at 22, never
 * smaller than `minSize` units (about 11 CSS px at the sheet's current scale,
 * so it stays legible on a phone) unless that is the only way to fit two lines.
 */
export function layoutBand(ctx: Ctx, text: string, pageW: number, minSize: number): BandLayout {
  const plan = (size: number) => {
    const labelSize = Math.round(size * 0.58 * 10) / 10;
    ctx.font = `700 ${labelSize}px ${TYPE}`;
    const labelWidth = ctx.measureText('QUESTION').width + labelSize * 0.9; // letter-spaced by hand below
    const textX = LEFT + labelWidth + size * 0.55;
    ctx.font = `600 ${size}px ${TYPE}`;
    const lines = wrap(ctx, text.replace(/\s+/g, ' ').trim(), pageW - RIGHT - textX);
    const first = TOP + size * 0.95;
    const baselines = lines.map((_, i) => Math.round(first + i * size * 1.22));
    const ruleY = Math.round(baselines[baselines.length - 1] + size * 0.5);
    return { size, labelSize, labelWidth, textX, baselines, lines, ruleY };
  };
  const one = plan(Math.max(26, minSize));
  if (one.lines.length === 1) return one;
  let size = Math.max(22, minSize);
  let p = plan(size);
  while ((p.lines.length > 2 || p.ruleY > BAND_MAX) && size > 14) p = plan((size -= 0.5));
  return p;
}

/** Paints the printed question band. ctx is in page units. */
export function drawQuestionBand(ctx: CanvasRenderingContext2D, text: string, pageW: number, minSize: number) {
  const b = layoutBand(ctx, text, pageW, minSize);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  // "QUESTION": small grey caps, letter-spaced, on the first line's baseline.
  ctx.font = `700 ${b.labelSize}px ${TYPE}`;
  ctx.fillStyle = LABEL;
  let x = LEFT;
  for (const ch of 'QUESTION') {
    ctx.fillText(ch, x, b.baselines[0]);
    x += ctx.measureText(ch).width + b.labelSize * 0.11;
  }
  ctx.font = `600 ${b.size}px ${TYPE}`;
  ctx.fillStyle = PEN;
  b.lines.forEach((line, i) => ctx.fillText(line, b.textX, b.baselines[i]));
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(LEFT - 6, b.ruleY);
  ctx.lineTo(pageW - RIGHT + 6, b.ruleY);
  ctx.stroke();
  return b;
}

/** The faint "start here" hint under the band, in the handwriting face. */
export function drawHint(ctx: CanvasRenderingContext2D, minSize: number) {
  const size = Math.max(30, minSize * 1.1);
  ctx.font = `${size}px ${HAND}`;
  ctx.fillStyle = 'rgba(28, 39, 51, 0.26)';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(HINT, 60, Math.round(BAND_BOTTOM + 40 + size));
}
