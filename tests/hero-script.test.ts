import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_STUDENT, HERO_SPEECH, buildHeroMarks } from '@/content/hero-script';
import { getDemoQuestion } from '@/content/demo-questions';
import { statesResult, validAnnotation } from '@/lib/mark/schema';

const fakeMeasure = (text: string, font: string) => text.length * (Number(/(\d+)px/.exec(font)?.[1] ?? 30) * 0.5);

test('hero script annotations are all valid', () => {
  for (const a of [...HERO_STUDENT, ...buildHeroMarks(fakeMeasure)]) assert.ok(validAnnotation(a), JSON.stringify(a));
});

test('the strike sits on the second line, and the correction is written above it', () => {
  const marks = buildHeroMarks(fakeMeasure);
  const strike = marks.find((m) => m.kind === 'strike')!;
  const fix = marks.find((m) => m.kind === 'write')!;
  const line2 = HERO_STUDENT[1] as { y: number };
  assert.ok(strike.kind === 'strike' && strike.x2 > strike.x1);
  assert.ok(strike.kind === 'strike' && Math.abs(strike.y1 - line2.y) < 40);
  assert.ok(fix.kind === 'write' && fix.y < line2.y && fix.text === '3');
});

test('hero speech asks, and never gives the result away', () => {
  assert.match(HERO_SPEECH, /\?$/);
  // The challenge's result is 6, and the corrected factor is 3: the tutor asks, it does not tell.
  assert.equal(statesResult(HERO_SPEECH, getDemoQuestion('q-challenge')!), false);
  assert.doesNotMatch(HERO_SPEECH, /\b3\b|three/i);
});

test('the hero shows the challenge trap: the factor from du = 2x dx dropped', () => {
  const lines = HERO_STUDENT.map((a) => (a.kind === 'write' ? a.text : ''));
  assert.deepEqual(lines, ['u = x², du = 2x dx', '= ∫ 6 sin u du', '= 6 + 6 = 12']);
  const marks = buildHeroMarks(fakeMeasure);
  const strike = marks.find((m) => m.kind === 'strike')!;
  const line2 = HERO_STUDENT[1] as { x: number };
  // The strike covers only the 6 of line 2, the factor that should be 3.
  assert.ok(strike.kind === 'strike' && strike.x1 > line2.x + fakeMeasure('= ∫', '62px') - 10);
  assert.ok(strike.kind === 'strike' && strike.x2 < line2.x + fakeMeasure('= ∫ 6 s', '62px'));
  // Line 3 follows from the slip, so it is ringed, not struck.
  assert.equal(marks.filter((m) => m.kind === 'strike').length, 1);
  assert.ok(marks.some((m) => m.kind === 'circle'));
});
