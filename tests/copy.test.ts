import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { COPY } from '@/content/copy';
import { DEMO_QUESTIONS } from '@/content/demo-questions';
import { HERO_SPEECH } from '@/content/hero-script';
import { waitlistConfirmEmail } from '@/lib/email';

const BANNED = /\bsolv(e|es|ed|ing|er)\b|\banswers?\b|homework done/i;

test('landing copy, demo questions and hero speech avoid banned words', () => {
  // Only the fields a visitor actually sees; answer-key fields are never rendered.
  const visible = JSON.stringify(DEMO_QUESTIONS.map((q) => [q.topic, q.text, q.solution]));
  const all = JSON.stringify(COPY) + visible + JSON.stringify(HERO_SPEECH);
  const hit = BANNED.exec(all);
  assert.equal(hit, null, `banned word: ${hit?.[0]}`);
});

test('page and component source avoids banned words in visible text', () => {
  const files = [
    ...readdirSync('app', { recursive: true }).map((f) => `app/${f}`),
    ...readdirSync('components', { recursive: true }).map((f) => `components/${f}`),
  ].filter((f) => /\.tsx$/.test(f));
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    const hit = BANNED.exec(text);
    assert.equal(hit, null, `${f}: banned word "${hit?.[0]}"`);
  }
});

test('no accuracy figures or invented social proof', () => {
  const all = JSON.stringify(COPY);
  assert.doesNotMatch(all, /\d+\s?%\s?(accura|agree)/i);
  assert.doesNotMatch(all, /trusted by|thousands of|★/i);
});

test('prices match the plan: first marked exam free, then a semester pass or a monthly plan', () => {
  assert.equal(COPY.pricing.pass, '$49');
  assert.equal(COPY.pricing.monthly, '$14.99');
  assert.match(COPY.pricing.free, /free/i);
});

// The site is for US college students taking Calculus I, who pay for themselves.
const OLD_AUDIENCE = /GCSE|£|\bparents?\b|\bguardian|your child|exam board|AQA|Edexcel|OCR|Foundation and Higher|early-bird/i;

test('copy speaks to US calculus students, not to UK parents', () => {
  const all = JSON.stringify(COPY).replaceAll(COPY.brand, '');
  const hit = OLD_AUDIENCE.exec(all);
  assert.equal(hit, null, `old audience wording: ${hit?.[0]}`);
  assert.doesNotMatch(all, /\bmaths\b/i, 'US students say math');
  assert.match(all, /calculus/i);
});

test('page metadata, legal pages, the sign-up form and the confirmation email are for the same audience', () => {
  const files = ['app/layout.tsx', 'app/privacy/page.tsx', 'app/terms/page.tsx', 'app/refunds/page.tsx', 'components/WaitlistForm.tsx', 'components/desk/Marks.tsx', 'app/page.tsx'];
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replaceAll(COPY.brand, '');
    const hit = OLD_AUDIENCE.exec(text);
    assert.equal(hit, null, `${f}: old audience wording "${hit?.[0]}"`);
  }
  const email = waitlistConfirmEmail('https://redpenmaths.com/x');
  assert.doesNotMatch(email.subject + email.html, /waitlist for parents|GCSE/i);
  assert.match(readFileSync('app/layout.tsx', 'utf8'), /lang="en-US"/);
});

test('nothing is claimed as open that is not: practice exams are described as coming', () => {
  assert.match(COPY.pricing.note, /nothing to pay today/i);
  assert.match(JSON.stringify(COPY.faq), /aiming|being built|not open yet/i);
});
