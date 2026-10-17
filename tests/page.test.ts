import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Page, PEN, PEN_WIDTH } from '@/lib/page';
import { config } from '@/lib/config';

test('page model tracks tutor marks and student work since last mark', () => {
  const p = new Page(900, 620);
  assert.equal(p.isEmpty, true);
  p.push({ kind: 'stroke', pts: [[1, 1], [5, 5]], width: PEN_WIDTH, color: PEN });
  assert.equal(p.studentWorkSinceLastMark(), true);
  p.push({ kind: 'tutor', annotations: [{ kind: 'strike', x1: 0, y1: 0, x2: 10, y2: 0 }] });
  assert.equal(p.studentWorkSinceLastMark(), false);
  assert.equal(p.tutorMarks().length, 1);
  const sig = p.signature();
  p.pop();
  assert.notEqual(p.signature(), sig);
});

test('config falls back to defaults on junk env', () => {
  process.env.DEMO_DAILY_CAP_GBP = 'abc';
  process.env.PASS_CAP = '-4';
  const c = config();
  assert.equal(c.dailyCapPence, 1000);
  assert.equal(c.passCap, 200);
  delete process.env.DEMO_DAILY_CAP_GBP;
  delete process.env.PASS_CAP;
});
