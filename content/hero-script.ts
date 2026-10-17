import type { Annotation } from '@/lib/types';
import { emFor, measureWritten, type Measure } from '@/lib/ink';

// The scripted wrong attempt at the hero challenge. It costs nothing, looks the
// same every time, and is what a visitor who will not write sees instead. The
// student's lines are drawn with the tutor's own single-stroke glyphs in the
// student's navy pen.

const X = 90;
// The challenge's trap: du = 2x dx, so 6x dx is 3 du, but the student writes 6 du.
// The value on line 3 then follows correctly from that slip.
const BEFORE_SLIP = '= ∫ ';
const SLIP = '6';
const BEFORE_VALUE = '= 6 + 6 = ';
export const HERO_STUDENT: Annotation[] = [
  { kind: 'write', x: X, y: 170, text: 'u = x², du = 2x dx', size: 'big' },
  { kind: 'write', x: X, y: 300, text: `${BEFORE_SLIP}${SLIP} sin u du`, size: 'big' },
  { kind: 'write', x: X, y: 430, text: `${BEFORE_VALUE}12`, size: 'big' },
];

// The result is 6, so the speech never says a bare 6 (only "6x"), as the live tutor's guard requires.
export const HERO_SPEECH = 'Look at your du. If du is 2x dx, what does 6x dx become in terms of du?';

/** Positions the strike on the 6 of line 2 and the ring on line 3's value, by measuring the student's own text. */
export function buildHeroMarks(measure: Measure): Annotation[] {
  const em = emFor('big');
  const line2 = HERO_STUDENT[1] as Extract<Annotation, { kind: 'write' }>;
  const line3 = HERO_STUDENT[2] as Extract<Annotation, { kind: 'write' }>;
  const x0 = line2.x + measureWritten(BEFORE_SLIP, em, measure);
  const x1 = line2.x + measureWritten(BEFORE_SLIP + SLIP, em, measure);
  const v0 = line3.x + measureWritten(BEFORE_VALUE, em, measure);
  const v1 = line3.x + measureWritten(line3.text, em, measure);
  // STRIKE_DY: offset from the write baseline to the middle of the glyphs.
  const STRIKE_DY = -20;
  const y = line2.y + STRIKE_DY;
  return [
    { kind: 'strike', x1: x0 - 8, y1: y + 6, x2: x1 + 8, y2: y - 6 },
    { kind: 'write', x: x0 - 4, y: line2.y - 62, text: '3', size: 'big' },
    // The value on line 3 follows from the slip, so it is ringed, not struck.
    { kind: 'circle', x: (v0 + v1) / 2, y: line3.y - 18, rx: (v1 - v0) / 2 + 22, ry: 44 },
  ];
}
