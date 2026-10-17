import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Page, PEN, PEN_WIDTH } from '@/lib/page';
import { BAND_BOTTOM, computeLayout, FREE_TOP, resolveMarks } from '@/lib/layout';
import { layoutBand } from '@/lib/board';
import { buildInstruction, QUESTION_BAND, SYSTEM } from '@/lib/mark/prompt';
import { DEMO_QUESTIONS, getDemoQuestion } from '@/content/demo-questions';
import { emFor, type Measure } from '@/lib/ink';
import type { Annotation } from '@/lib/types';

// Text measured as half an em per character, like a typical sans face.
const measure: Measure = (t, f) => t.length * Number(/(\d+(?:\.\d+)?)px/.exec(f)![1]) * 0.5;
const fakeCtx = () => {
  const c = { font: '', measureText: (t: string) => ({ width: measure(t, c.font) }) as TextMetrics };
  return c;
};
const stroke = (pts: [number, number][]) => ({ kind: 'stroke' as const, pts, width: PEN_WIDTH, color: PEN });

test('the band fits above the reserved line for every question, on desktop and on a phone', () => {
  for (const q of DEMO_QUESTIONS) {
    for (const cssW of [880, 358, 328]) {
      const minSize = (11 * 900) / cssW;
      const b = layoutBand(fakeCtx(), q.text, 900, minSize);
      assert.ok(b.lines.length <= 2, `${q.id} @${cssW}: ${b.lines.length} lines`);
      assert.ok(b.ruleY <= BAND_BOTTOM - 4, `${q.id} @${cssW}: rule at ${b.ruleY}`);
      assert.equal(b.lines.join(' '), q.text.replace(/\s+/g, ' '));
      if (b.lines.length === 1) assert.ok(b.size >= 26);
      else assert.ok(b.size >= 21, `${q.id} @${cssW}: ${b.size}`);
      for (const line of b.lines) assert.ok(b.textX + measure(line, `${b.size}px`) <= 900 - 20, `${q.id} @${cssW}: "${line}" overflows`);
    }
  }
  // Desktop: every question stays on one line at 26 units.
  assert.equal(layoutBand(fakeCtx(), DEMO_QUESTIONS[0].text, 900, 11).size, 26);
  for (const q of DEMO_QUESTIONS) assert.equal(layoutBand(fakeCtx(), q.text, 900, 11).lines.length, 1, q.id);
});

test('free regions start below the question band; the student box is still theirs inside it', () => {
  const p = new Page(900, 620);
  assert.ok(computeLayout(p, measure).free.every((r) => r.y0 >= FREE_TOP));
  p.push(stroke([[100, 40], [400, 80]])); // the student wrote inside the band
  const l = computeLayout(p, measure);
  assert.deepEqual(l.student, { x0: 94, y0: 34, x1: 406, y1: 86 });
  assert.ok(l.free.length > 0 && l.free.every((r) => r.y0 >= FREE_TOP));
});

test('tutor writing that would reach into the band is nudged below it; strikes and circles stay', () => {
  const p = new Page(900, 620);
  p.push(stroke([[100, 160], [400, 200]]));
  const layout = computeLayout(p, measure);
  const marks: Annotation[] = [
    { kind: 'write', x: 600, y: 60, text: '-6', size: 'normal' },
    { kind: 'text', x: 600, y: 30, text: 'sign?' },
    { kind: 'write', x: 600, y: 300, text: '3x - 6', size: 'normal' },
    { kind: 'strike', x1: 100, y1: 50, x2: 160, y2: 50 },
    { kind: 'circle', x: 120, y: 60, rx: 30, ry: 20 },
  ];
  const out = resolveMarks(marks, [], layout, 900, measure);
  const w0 = out[0] as Extract<Annotation, { kind: 'write' }>;
  assert.ok(w0.y - emFor('normal') * 0.72 >= BAND_BOTTOM, `write top at ${w0.y - emFor('normal') * 0.72}`);
  assert.ok((out[1] as { y: number }).y >= FREE_TOP);
  assert.equal((out[2] as { y: number }).y, 300);
  assert.deepEqual(out[3], marks[3]);
  assert.deepEqual(out[4], marks[4]);
});

test('the model is told about the band whenever the page layout is sent; the system prompt is unchanged', () => {
  const demo = getDemoQuestion('q-challenge')!;
  const p = new Page(900, 620);
  const withLayout = buildInstruction({ width: 900, height: 620, prior: [], transcript: [], demo, layout: computeLayout(p, measure) });
  assert.ok(withLayout.includes(QUESTION_BAND));
  assert.match(QUESTION_BAND, /above y = 100 shows the printed question.*never write or draw there/);
  assert.ok(!SYSTEM.includes('printed question'));
});

test('the capture render is unchanged: decoration only runs when the view asks for it', () => {
  const p = new Page(900, 620);
  p.push(stroke([[10, 10], [20, 20]]));
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_, k) => (typeof k === 'string' && k !== 'then' ? (...a: unknown[]) => void calls.push(k) : undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
  p.render(ctx);
  const plain = [...calls];
  calls.length = 0;
  let decorated = 0;
  p.render(ctx, () => void decorated++);
  assert.equal(decorated, 1);
  assert.deepEqual(calls.filter((c) => c !== 'save' && c !== 'restore'), plain);
});

test('signature(n) is the signature of the first n items', () => {
  const p = new Page(900, 620);
  p.push(stroke([[1, 1], [5, 5]]));
  const sig = p.signature();
  p.push({ kind: 'tutor', annotations: [{ kind: 'strike', x1: 0, y1: 0, x2: 10, y2: 0 }] });
  assert.equal(p.signature(1), sig);
  assert.notEqual(p.signature(), sig);
  assert.equal(p.signature(0), 'empty');
});

test('a write nudged out of the band onto the student\'s strokes moves to the first free region, or is dropped', () => {
  const p = new Page(900, 620);
  p.push(stroke([[100, 112], [400, 170]])); // student box y 106–176
  const layout = computeLayout(p, measure);
  assert.deepEqual([layout.student!.y0, layout.student!.y1], [106, 176]);
  const out = resolveMarks([{ kind: 'write', x: 150, y: 96, text: '-6', size: 'small' }], [], layout, 900, measure);
  assert.equal(out.length, 1);
  const w = out[0] as Extract<Annotation, { kind: 'write' }>;
  const em = emFor(w.size);
  const box = { x0: w.x, y0: w.y - em * 0.72, x1: w.x + measure('-6', `${em}px`), y1: w.y + em * 0.25 };
  const s = layout.student!;
  assert.ok(!(box.x0 < s.x1 && box.x1 > s.x0 && box.y0 < s.y1 && box.y1 > s.y0), `still on the student: ${JSON.stringify(w)}`);
  const r = layout.free[0];
  assert.ok(w.x >= r.x0 && w.x <= r.x1 && w.y >= r.y0 && w.y <= r.y1, `not in ${JSON.stringify(r)}: ${JSON.stringify(w)}`);
  assert.ok(w.y - em * 0.72 >= BAND_BOTTOM);
  // No free region at all: dropped rather than written on the student's work.
  const none = resolveMarks([{ kind: 'write', x: 150, y: 96, text: '-6', size: 'small' }], [], { ...layout, free: [] }, 900, measure);
  assert.deepEqual(none, []);
  // A write that is not nudged keeps its place (a correction just above a value is normal).
  const kept = resolveMarks([{ kind: 'write', x: 150, y: 300, text: '-6', size: 'small' }], [], layout, 900, measure);
  assert.deepEqual(kept, [{ kind: 'write', x: 150, y: 300, text: '-6', size: 'small' }]);
});
