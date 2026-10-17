import { Annotation } from './types';
import { glyph } from './glyphs';

// Turns the tutor's annotations into hand-drawn ink and draws it in real time.
//
// Everything is planned as a sequence of *items* - pen strokes, pen lifts, and
// (for characters we have no glyph for) a left-to-right reveal of font text.
// The animation is time-based: a stroke takes as long as a hand would take to
// draw it at PEN_SPEED, so a short strike is quick and a big circle takes a
// second or so, regardless of frame rate. Geometry is seeded, so the static
// render used after burn-in matches the animated end state exactly.

export const INK = '#dd1b27';
const FACE = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';

/** Pen travel speed in canvas px per second. Tuned to look like unhurried marking. */
const PEN_SPEED = 300;
/** Time the pen spends in the air between strokes. */
const LIFT_MS: [number, number] = [70, 200];
/** Reveal speed for font-rendered text (no glyph available). */
const REVEAL_MS_PER_CHAR = 95;

export type Stroke = { pts: [number, number][]; width: number };

type Item =
  | { kind: 'stroke'; pts: [number, number][]; width: number; len: number }
  | { kind: 'reveal'; x: number; y: number; text: string; font: string; width: number; ms: number }
  | { kind: 'lift'; ms: number };

export type Measure = (text: string, font: string) => number;

// ---------------------------------------------------------------------------
// Geometry helpers

function jitter(seed: number) {
  // Deterministic pseudo-random so a redraw of the same annotation looks identical.
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

/** Ease-in-out: a hand accelerates out of a corner and slows into the next one. */
function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function pathLength(pts: [number, number][]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/**
 * Resamples a path so points bunch at the ends and spread through the middle,
 * and adds low-frequency drift: a hand wanders off-line and comes back, it
 * does not vibrate.
 */
function humanize(pts: [number, number][], amt: number, seed: number): [number, number][] {
  if (pts.length < 2) return pts;
  const rnd = jitter(seed);
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!total) return pts;

  const out: [number, number][] = [];
  const steps = Math.max(8, Math.round(total / 4));
  const driftA = rnd() * amt * 2;
  const driftB = rnd() * amt * 2;
  const phase = rnd() * Math.PI * 2;

  for (let i = 0; i <= steps; i++) {
    const target = ease(i / steps) * total;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < target) k++;
    const span = cum[k] - cum[k - 1] || 1;
    const f = (target - cum[k - 1]) / span;
    const x = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f;
    const y = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f;
    const u = i / steps;
    out.push([
      x + Math.sin(u * 3.1 + phase) * driftA + rnd() * amt * 0.4,
      y + Math.cos(u * 2.3 + phase) * driftB + rnd() * amt * 0.4,
    ]);
  }
  return out;
}

function circleStroke(cx: number, cy: number, rx: number, ry: number): Stroke {
  const seed = Math.round(cx * 31 + cy);
  const rnd = jitter(seed);
  const pts: [number, number][] = [];
  // Overshoot past a full turn and start off-axis: nobody closes a circle exactly.
  const start = -0.6 + rnd() * 0.5;
  const end = Math.PI * 2 + 0.3 + rnd() * 0.4;
  const steps = 48;
  // A hand-drawn ring is slightly egg-shaped and tilted, not a true ellipse.
  const tilt = rnd() * 0.24;
  const squash = 1 + rnd() * 0.12;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    const px = Math.cos(t) * rx;
    const py = Math.sin(t) * ry * squash;
    pts.push([cx + px * Math.cos(tilt) - py * Math.sin(tilt), cy + px * Math.sin(tilt) + py * Math.cos(tilt)]);
  }
  return { pts: humanize(pts, 2.2, seed), width: 3 };
}

function arrowStrokes(x1: number, y1: number, x2: number, y2: number): Stroke[] {
  const seed = Math.round(x1 * 17 + y2);
  const rnd = jitter(seed);
  const pts: [number, number][] = [];
  const steps = 24;
  // Bow the shaft a little so it is not a ruler-straight line.
  const bow = (rnd() + 0.15) * Math.hypot(x2 - x1, y2 - y1) * 0.12;
  const nx = -(y2 - y1);
  const ny = x2 - x1;
  const nl = Math.hypot(nx, ny) || 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const arc = Math.sin(t * Math.PI) * bow;
    pts.push([x1 + (x2 - x1) * t + (nx / nl) * arc, y1 + (y2 - y1) * t + (ny / nl) * arc]);
  }
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = 13 + rnd() * 4;
  // The two head strokes are separate quick flicks, never symmetric.
  return [
    { pts: humanize(pts, 1.8, seed), width: 3 },
    { pts: humanize([[x2, y2], [x2 - head * Math.cos(ang - 0.42), y2 - head * Math.sin(ang - 0.42)]], 1.1, seed + 5), width: 2.8 },
    { pts: humanize([[x2, y2], [x2 - head * 0.92 * Math.cos(ang + 0.38), y2 - head * 0.92 * Math.sin(ang + 0.38)]], 1.1, seed + 9), width: 2.8 },
  ];
}

function strikeStroke(x1: number, y1: number, x2: number, y2: number): Stroke {
  const seed = Math.round(x1 * 13 + y1);
  const rnd = jitter(seed);
  const dx = x2 - x1;
  const dy = y2 - y1;
  // A crossing-out is one fast flick: it overshoots both ends and bows slightly.
  const nx = -dy;
  const ny = dx;
  const nl = Math.hypot(nx, ny) || 1;
  const bow = rnd() * 3;
  const pts: [number, number][] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = -0.06 + (1.12 * i) / steps;
    const arc = Math.sin(t * Math.PI) * bow;
    pts.push([x1 + dx * t + (nx / nl) * arc, y1 + dy * t + (ny / nl) * arc]);
  }
  return { pts: humanize(pts, 1.4, seed), width: 3.5 };
}

/** A ruled-by-hand straight line: slight bow, tiny overshoot at each end. */
function lineStroke(x1: number, y1: number, x2: number, y2: number, width = 2.8): Stroke {
  const seed = Math.round(x1 * 7 + y1 * 3 + x2);
  const rnd = jitter(seed);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = rnd() * Math.min(6, len * 0.02);
  const pts: [number, number][] = [];
  const steps = Math.max(6, Math.round(len / 40));
  for (let i = 0; i <= steps; i++) {
    const t = -0.015 + (1.03 * i) / steps;
    const arc = Math.sin(t * Math.PI) * bow;
    pts.push([x1 + dx * t + nx * arc, y1 + dy * t + ny * arc]);
  }
  return { pts: humanize(pts, 1.2, seed), width };
}

/** A rectangle drawn the way a hand draws one: four lines, corners slightly overshot. */
function rectStrokes(x: number, y: number, w: number, h: number): Stroke[] {
  return [
    lineStroke(x, y, x + w, y),
    lineStroke(x + w, y, x + w, y + h),
    lineStroke(x + w, y + h, x, y + h),
    lineStroke(x, y + h, x, y),
  ];
}

function pathStroke(pts: { x: number; y: number }[]): Stroke {
  const seed = Math.round(pts[0].x * 11 + pts[0].y + pts.length);
  return { pts: humanize(pts.map((p) => [p.x, p.y] as [number, number]), 1.4, seed), width: 2.8 };
}

// ---------------------------------------------------------------------------
// Planning

function lift(rnd: () => number): Item {
  return { kind: 'lift', ms: LIFT_MS[0] + (rnd() + 0.5) * (LIFT_MS[1] - LIFT_MS[0]) };
}

function strokeItem(s: Stroke): Item {
  return { kind: 'stroke', pts: s.pts, width: s.width, len: pathLength(s.pts) };
}

/**
 * Writes text the way a hand would: digits and maths symbols as single-stroke
 * glyphs drawn point by point; anything else as font text revealed left to
 * right at writing pace.
 */
function writeItems(x: number, y: number, text: string, em: number, measure: Measure, seed: number): Item[] {
  const items: Item[] = [];
  const rnd = jitter(seed);
  const capH = em * 0.72;
  const font = `600 ${em}px ${FACE}`;
  const strokeW = em >= 40 ? 3.4 : em >= 26 ? 2.6 : 2.1;
  let penX = x;
  let run = '';

  const flushRun = () => {
    if (!run) return;
    const width = measure(run, font);
    items.push({ kind: 'reveal', x: penX, y, text: run, font, width, ms: run.length * REVEAL_MS_PER_CHAR });
    penX += width;
    run = '';
  };

  for (const ch of text) {
    const g = glyph(ch);
    if (!g) {
      run += ch;
      continue;
    }
    flushRun();
    const adv = g.adv * em * 0.92;
    for (const path of g.strokes) {
      const pts: [number, number][] = path.map(([gx, gy]) => [penX + gx * adv, y - capH + gy * capH]);
      // Digits wobble a little; big writing wobbles more, in proportion.
      items.push(strokeItem({ pts: humanize(pts, 0.9 * (em / 62) + 0.3, seed + penX), width: strokeW }));
      items.push(lift(rnd));
    }
    penX += adv + em * 0.06;
  }
  flushRun();
  return items;
}

/** Font size in px for a write annotation's size keyword. */
export function emFor(size: 'small' | 'normal' | 'big' | undefined) {
  return size === 'big' ? 62 : size === 'small' ? 20 : 30;
}

/** Width of text as the pen would write it (glyph advances plus font runs). */
export function measureWritten(text: string, em: number, measure: Measure): number {
  const font = `600 ${em}px ${FACE}`;
  let w = 0;
  let run = '';
  for (const ch of text) {
    const g = glyph(ch);
    if (!g) {
      run += ch;
      continue;
    }
    if (run) {
      w += measure(run, font);
      run = '';
    }
    w += g.adv * em * 0.92 + em * 0.06;
  }
  if (run) w += measure(run, font);
  return w;
}

export function planInk(annotations: Annotation[], measure: Measure): Item[] {
  const items: Item[] = [];
  const rnd = jitter(annotations.length * 7919 + 1);
  for (const a of annotations) {
    if (a.kind === 'circle') {
      items.push(strokeItem(circleStroke(a.x, a.y, Math.max(a.rx, 12), Math.max(a.ry, 12))), lift(rnd));
    } else if (a.kind === 'arrow') {
      for (const s of arrowStrokes(a.x1, a.y1, a.x2, a.y2)) items.push(strokeItem(s), lift(rnd));
    } else if (a.kind === 'strike') {
      items.push(strokeItem(strikeStroke(a.x1, a.y1, a.x2, a.y2)), lift(rnd));
    } else if (a.kind === 'line') {
      items.push(strokeItem(lineStroke(a.x1, a.y1, a.x2, a.y2)), lift(rnd));
    } else if (a.kind === 'rect') {
      for (const s of rectStrokes(a.x, a.y, a.w, a.h)) items.push(strokeItem(s), lift(rnd));
    } else if (a.kind === 'path') {
      if (a.pts.length >= 2) items.push(strokeItem(pathStroke(a.pts)), lift(rnd));
    } else if (a.kind === 'write') {
      items.push(...writeItems(a.x, a.y, a.text, emFor(a.size), measure, Math.round(a.x * 3 + a.y)));
    } else if (a.kind === 'ring') {
      // Unresolved ring (no written text to attach to): nothing to draw.
    } else {
      items.push(...writeItems(a.x, a.y, a.text, 19, measure, Math.round(a.x * 5 + a.y)));
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Drawing

function drawStrokePartial(ctx: CanvasRenderingContext2D, pts: [number, number][], width: number, upTo: number, color: string) {
  // Segment by segment so the line can thin where the pen moved fastest.
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let cum = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    let [bx, by] = pts[i];
    const d = Math.hypot(bx - ax, by - ay);
    if (cum >= upTo) break;
    if (cum + d > upTo) {
      const f = (upTo - cum) / (d || 1);
      bx = ax + (bx - ax) * f;
      by = ay + (by - ay) * f;
    }
    ctx.lineWidth = Math.max(1.2, width * (1 - Math.min(0.45, d / 26)));
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    cum += d;
  }
}

function drawReveal(ctx: CanvasRenderingContext2D, it: Extract<Item, { kind: 'reveal' }>, fraction: number, color: string) {
  ctx.save();
  ctx.beginPath();
  // Clip a little above and below the line so ascenders and descenders survive.
  ctx.rect(it.x - 2, it.y - it.width * 2, it.width * fraction + 4, it.width * 4);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.font = it.font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(it.text, it.x, it.y);
  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item, progress: number, color: string) {
  if (it.kind === 'stroke') drawStrokePartial(ctx, it.pts, it.width, progress, color);
  else if (it.kind === 'reveal') drawReveal(ctx, it, Math.min(1, progress / it.ms), color);
}

function itemLength(it: Item) {
  return it.kind === 'stroke' ? it.len : it.ms;
}

/** Draws the finished marking in one go. Used for burn-in and re-renders. */
export function renderInk(ctx: CanvasRenderingContext2D, annotations: Annotation[], color = INK) {
  const measure: Measure = (t, f) => {
    ctx.font = f;
    return ctx.measureText(t).width;
  };
  for (const it of planInk(annotations, measure)) drawItem(ctx, it, itemLength(it), color);
}

/** Rough duration of the animation, for status text. */
export function inkDurationMs(annotations: Annotation[], measure: Measure) {
  let ms = 0;
  for (const it of planInk(annotations, measure)) ms += it.kind === 'stroke' ? (it.len / PEN_SPEED) * 1000 : it.ms;
  return ms;
}

/**
 * Animates the marking onto ctx in real time. Returns a cancel function; the
 * cancel takes a flag saying whether to leave the finished ink on the canvas.
 */
export function drawInk(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  onDone?: () => void,
  color = INK,
): (finish?: boolean) => void {
  const measure: Measure = (t, f) => {
    ctx.font = f;
    return ctx.measureText(t).width;
  };
  const items = planInk(annotations, measure);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  let idx = 0;
  let progress = 0;
  let last = 0;
  let raf = 0;
  let done = false;

  const paint = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.restore();
    for (let i = 0; i < idx; i++) drawItem(ctx, items[i], itemLength(items[i]), color);
    if (idx < items.length) drawItem(ctx, items[idx], progress, color);
  };

  const step = (now: number) => {
    if (done) return;
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    const it = items[idx];
    if (it) {
      // A real hand does not move at one constant speed.
      const wobble = 0.85 + Math.random() * 0.3;
      progress += it.kind === 'stroke' ? (dt / 1000) * PEN_SPEED * wobble : dt;
      while (idx < items.length && progress >= itemLength(items[idx])) {
        progress -= itemLength(items[idx]);
        idx++;
      }
    }
    paint();
    if (idx < items.length) raf = requestAnimationFrame(step);
    else {
      done = true;
      onDone?.();
    }
  };

  raf = requestAnimationFrame(step);
  return (finish = false) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    if (finish) {
      idx = items.length;
      paint();
    }
  };
}
