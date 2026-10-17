# RedPen Maths Pre-sale Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `redpenmaths.com`: a parent-facing landing page with a scripted and a live red-pen marking demo, a £49 early-bird Paddle checkout capped at 200, and a double-opt-in waitlist.

**Architecture:** A Next.js 16 app on Vercel. The POC's page model, ink engine and tutor prompt are copied into `lib/` (the POC repo is never modified). Every route is a thin wrapper around a plain handler function (`lib/**/handler.ts`) that takes its dependencies as arguments. That way the handlers are unit-tested with fakes: an in-memory counter, PGlite for Postgres, and stub fetch and model calls. Abuse control works in three layers: a Turnstile-issued session cookie, a per-visitor daily rate limit, and a global daily spend cap. The rate limit and spend cap live in Upstash Redis. When a limit is hit, the live demo quietly swaps to the scripted one.

**Tech Stack:**
- Next.js 16 (App Router), React 19, TypeScript and zod 4
- `@anthropic-ai/sdk` (Claude Sonnet 5)
- OpenAI TTS over REST
- Neon Postgres (`@neondatabase/serverless`) and Upstash Redis (`@upstash/redis`)
- Resend, Cloudflare Turnstile and Paddle Billing (Paddle.js v2)
- Testing: `tsx` + `node:test`, `@electric-sql/pglite` and Playwright

**Spec:** `docs/superpowers/specs/2026-09-30-presale-site-design.md`

**POC source (read-only):** `/Users/mz/screen-tutor-poc`

## Global Constraints

- Commits are authored as `Mehroz <mehroz.muneer@gmail.com>` with no co-author or Claude credit lines. Task 2 sets this in the repo's git config.
- Never edit anything under `/Users/mz/screen-tutor-poc`. Copy files out of it only.
- Marketing and demo copy must never contain "solve", "answers" or "homework done" (case-insensitive). `tests/copy.test.ts` enforces this.
- Publish no accuracy figures, testimonials, logos or user counts. The scarcity counter shows only real remaining passes.
- Price: Early-bird Season Pass 2027, £49 one-off (full price £79), January–June 2027, capped at `PASS_CAP` (default 200).
- Per-visitor limit: 10 marking checks per 24 hours (UTC day), keyed on a salted IP hash. Global daily spend cap: `DEMO_DAILY_CAP_GBP` (default 10).
- Nothing a student writes is stored or logged. No child data goes into any table.
- The model is `claude-sonnet-5` by default (`TUTOR_MODEL` overrides it). Sonnet 5 thinks natively: no `temperature` and no "check" scratchpad.
- Next.js 16 has breaking changes. Before writing any route or page, read the relevant guide in `node_modules/next/dist/docs/` (as `AGENTS.md` says).
- Mobile first: every page works at 390×844 with no horizontal scroll.

## Review Focus

1. **Last-pass race:** two parents pay for the final pass at the same moment. Both orders must be recorded and honoured, and the counter shows 0, never a negative number. Test: Task 8, `records orders beyond the cap and clamps passes-left at 0`.
2. **Buyer reaches `/thanks` before Paddle's webhook:** the page shows "Confirming your payment…" and then the confirmation, never "order not found". Test: Task 8, `returns 202 pending for an unknown transaction`. Task 11 polls.
3. **Refund webhook arrives before, or without, the completed webhook:** the order ends as refunded and the pass returns to the pool. Test: Task 5, `a refund that arrives first wins over a later completed event`.
4. **UTC-midnight rollover:** visitors get a fresh allowance, and yesterday's rate and spend counters don't carry over. Test: Task 4, `a new UTC day starts a fresh allowance`.
5. **Phone visitor draws on the demo with a finger:** ink appears and the page doesn't scroll. Test: Task 13, the `touch drawing marks and does not scroll` check.

---

## File map

```
package.json, tsconfig.json, next.config.js, .gitignore, .env.example, AGENTS.md
app/layout.tsx, app/globals.css
app/page.tsx                         landing page
app/thanks/page.tsx                  post-purchase confirmation (client polling)
app/refunds/page.tsx, app/privacy/page.tsx, app/terms/page.tsx
app/api/session/route.ts             Turnstile token → signed session cookie
app/api/mark/route.ts                live demo marking + lessons
app/api/speak/route.ts               OpenAI TTS under the spend cap
app/api/waitlist/route.ts            join
app/api/waitlist/confirm/route.ts    double opt-in confirm
app/api/paddle/webhook/route.ts      Paddle events → orders
app/api/passes-left/route.ts         remaining early-bird passes
app/api/order/route.ts               GET order status, POST exam board
lib/types.ts, lib/page.ts, lib/ink.ts, lib/glyphs.ts, lib/layout.ts, lib/speech.ts   copied from POC
lib/config.ts                        env → typed config
lib/http.ts                          HandlerResult → Response, request context
lib/db.ts                            Query type, Neon adapter, repository functions
lib/guard/counter.ts                 Counter interface, memory + Upstash implementations
lib/guard/limits.ts                  rate limit + spend cap
lib/guard/ip.ts                      client IP + salted hash
lib/guard/turnstile.ts               Turnstile siteverify
lib/guard/session.ts                 HMAC session cookie
lib/mark/schema.ts                   zod schemas + validAnnotation (from POC route)
lib/mark/prompt.ts                   SYSTEM prompt (from POC) + answer-key instruction builder
lib/mark/anthropic.ts                real model call
lib/mark/handler.ts                  handleMark
lib/speak/handler.ts                 guardSpeak
lib/email.ts                         Resend wrapper + templates
lib/waitlist/handler.ts              handleJoin, handleConfirm
lib/payments.ts                      Paddle signature, event parsing, customer lookup
lib/orders/handler.ts                handleWebhook, passesLeft, handleGetOrder, handleSetBoard
content/demo-questions.ts            the 3 live-demo questions with answer keys
content/hero-script.ts               scripted hero demo
content/copy.ts                      all landing-page copy
components/HeroDemo.tsx, components/TryIt.tsx, components/useSession.ts
components/BuyButton.tsx, components/WaitlistForm.tsx, components/Faq.tsx, components/ParentReport.tsx
db/schema.sql, scripts/migrate.mjs, scripts/make-hero-audio.mjs, public/audio/hero.mp3
fixtures/make_demo.py, fixtures/run-demo.js
scripts/e2e.mjs
tests/*.test.ts
docs/decisions/paddle.md
```

---

### Task 1: Paddle pre-flight (gate)

A decision task: no product code. It settles the open risk in the spec before any checkout code exists.

**Files:**
- Create: `docs/decisions/paddle.md`

**Interfaces:**
- Produces: the confirmed webhook signature format, the event names and the JSON paths for transaction id, customer id, custom data, total and currency, plus the refund event shape. Task 8 codes against this document.

- [ ] **Step 1: Check Paddle's rules on pre-sales.** Read Paddle's Acceptable Use Policy and its seller-verification or website-review help pages. Search for "pre-order", "pre-sale", "products not yet available" and "crowdfunding". Quote the exact sentences you find in `docs/decisions/paddle.md`, with URLs.

- [ ] **Step 2: Check the webhook and event shapes against the current docs.** Per the "verify API, don't trust docs" rule, use the Paddle Billing docs *and* a live sandbox probe. Mehroz creates the sandbox account at `sandbox-vendors.paddle.com`; never sign up on his behalf. In the sandbox:
  1. Create the product "Early-bird Season Pass 2027" with a one-off GBP 49.00 price.
  2. Create a notification destination pointing at a temporary request-inspector URL, subscribed to `transaction.completed`, `adjustment.created` and `adjustment.updated`.
  3. Use the dashboard's webhook simulator to send one of each.
  4. Record the following in `docs/decisions/paddle.md`:
     - the `Paddle-Signature` header format (expected: `ts=<unix>;h1=<hex hmac-sha256 of "<ts>:<raw body>">`);
     - the event type strings;
     - the JSON paths for `data.id`, `data.customer_id`, `data.custom_data`, `data.currency_code` and the grand total in minor units (expected: `data.details.totals.grand_total`, a string);
     - the refund adjustment fields (expected: `data.action === "refund"`, `data.status === "approved"`, `data.transaction_id`);
     - the customer email lookup (`GET /customers/{id}` on `https://sandbox-api.paddle.com` or `https://api.paddle.com`).

  Delete the temporary destination afterwards.

- [ ] **Step 3: Write the verdict.** End `docs/decisions/paddle.md` with one of:
  - `VERDICT: PADDLE OK`: pre-sales are allowed or not prohibited. Continue with this plan.
  - `VERDICT: USE LEMON SQUEEZY`: stop after Task 7 and re-plan Task 8, `components/BuyButton.tsx` and the webhook route for Lemon Squeezy. Everything else stays the same.

  If any JSON path differs from the "expected" values above, note that Task 8's `parsePaddleEvent` must use the recorded path.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/paddle.md
git commit -m "Record Paddle pre-sale policy and webhook shapes"
```

---

### Task 2: Scaffold the app and copy the POC engine

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `.gitignore`, `.env.example`, `AGENTS.md`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (temporary), `lib/config.ts`
- Copy from POC: `lib/types.ts`, `lib/page.ts`, `lib/ink.ts`, `lib/glyphs.ts`, `lib/layout.ts`, `lib/speech.ts`
- Test: `tests/page.test.ts`

**Interfaces:**
- Produces:
  - `Page`, `PageItem`, `PEN`, `PEN_WIDTH`, `PAGE_BG` from `lib/page.ts`, and `Annotation`, `TutorReply`, `LessonStep`, `PageLayout`, `TranscriptLine` from `lib/types.ts`, all unchanged from the POC.
  - `config()` from `lib/config.ts`, returning `{ perVisitor: number; dailyCapPence: number; passCap: number; costs: { checkPence: number; lessonPence: number; speakPence: number } }`.

- [ ] **Step 1: Set up git identity and copy files**

```bash
cd /Users/mz/redpen-maths
git config user.name "Mehroz"
git config user.email "mehroz.muneer@gmail.com"
mkdir -p lib app tests content components db scripts fixtures public/audio
cp /Users/mz/screen-tutor-poc/lib/{types,page,ink,glyphs,layout,speech}.ts lib/
cp /Users/mz/screen-tutor-poc/tsconfig.json /Users/mz/screen-tutor-poc/AGENTS.md .
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "redpen-maths",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --import tsx --test \"tests/**/*.test.ts\"",
    "migrate": "node scripts/migrate.mjs",
    "fixtures": "python3 fixtures/make_demo.py",
    "test:marking": "node fixtures/run-demo.js --runs 3",
    "test:e2e": "node scripts/e2e.mjs",
    "hero-audio": "node scripts/make-hero-audio.mjs"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.124.0",
    "@neondatabase/serverless": "^1.0.0",
    "@upstash/redis": "^1.35.0",
    "next": "^16.3.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "resend": "^6.0.0",
    "zod": "^4.6.0"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.3.0",
    "@types/node": "^22",
    "@types/react": "^19",
    "playwright": "^1.62.1",
    "tsx": "^4.20.0",
    "typescript": "^5"
  }
}
```

Run `npm install`. If a caret range fails to resolve, install that package at `@latest` and keep the resolved version.

- [ ] **Step 3: Write the config and scaffolding files**

`next.config.js`:
```js
/** @type {import('next').NextConfig} */
module.exports = {};
```

`.gitignore`:
```
node_modules
.next
.env*.local
.vercel
scripts/e2e-out
fixtures/*.png
fixtures/last-run.json
tsconfig.tsbuildinfo
```

`.env.example`:
```
ANTHROPIC_API_KEY=
TUTOR_MODEL=claude-sonnet-5
OPENAI_API_KEY=
DATABASE_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RESEND_API_KEY=
EMAIL_FROM=RedPen Maths <hello@redpenmaths.com>
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
PADDLE_ENV=sandbox
PADDLE_API_KEY=
PADDLE_WEBHOOK_SECRET=
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=
NEXT_PUBLIC_PADDLE_ENV=sandbox
NEXT_PUBLIC_PADDLE_PRICE_ID=
SESSION_SECRET=
IP_SALT=
SITE_URL=http://localhost:3000
DEMO_DAILY_CAP_GBP=10
DEMO_PER_VISITOR=10
PASS_CAP=200
COST_CHECK_PENCE=1
COST_LESSON_PENCE=3
COST_SPEAK_PENCE=1
DEMO_DEV_OPEN=
```

The cost defaults are deliberately high estimates; Task 14 tunes them from measured token counts. `DEMO_DEV_OPEN=1` skips the session check outside production, and is used only by the fixture runner.

`lib/config.ts`:
```ts
// Every tunable number in one place, read from the environment with safe defaults.
const n = (v: string | undefined, d: number) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : d;
};

export function config() {
  return {
    perVisitor: n(process.env.DEMO_PER_VISITOR, 10),
    dailyCapPence: Math.round(n(process.env.DEMO_DAILY_CAP_GBP, 10) * 100),
    passCap: n(process.env.PASS_CAP, 200),
    costs: {
      checkPence: n(process.env.COST_CHECK_PENCE, 1),
      lessonPence: n(process.env.COST_LESSON_PENCE, 3),
      speakPence: n(process.env.COST_SPEAK_PENCE, 1),
    },
  };
}
```

`app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RedPen Maths: GCSE maths marking that teaches the fix',
  description: "Marks your child's GCSE maths working like an examiner, then teaches the fix.",
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
```

`app/globals.css` (base tokens; Task 11 adds the section styles):
```css
:root {
  --paper: #fffdf7; --ink: #1c2733; --red: #e5484d; --muted: #5b6675;
  --line: #e8e2d4; --bg: #faf7f0; --green: #27ae60; --radius: 14px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font); }
body { overflow-x: hidden; }
a { color: inherit; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
```

`app/page.tsx` (temporary; Task 11 replaces it):
```tsx
export default function Home() {
  return <main className="wrap"><h1>RedPen Maths</h1></main>;
}
```

- [ ] **Step 4: Write the failing test** in `tests/page.test.ts`

```ts
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
```

- [ ] **Step 5: Run the tests.** `npm test`. Expected: PASS. The copied POC code already implements `Page`, and `config` is written in Step 3. If the `@/` import fails to resolve, confirm `tsx` is reading `tsconfig.json` `paths`.

- [ ] **Step 6: Check the build.** `npm run build`. Expected: build succeeds. Then `npm run dev`, open `http://localhost:3000` and check it shows "RedPen Maths". Stop the server with `pkill -9 -f "next-server"`, not `pkill -f "next start"`, which leaves a stale build running.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app and copy the tutor engine from the POC"
```

---

### Task 3: Demo questions, marking schema and answer-key prompt

**Files:**
- Create: `content/demo-questions.ts`, `lib/mark/schema.ts`, `lib/mark/prompt.ts`
- Test: `tests/mark-prompt.test.ts`

**Interfaces:**
- Consumes: `Annotation`, `PageLayout`, `TranscriptLine` from `lib/types.ts`.
- Produces:
  - `interface DemoQuestion { id: 'q-algebra' | 'q-number' | 'q-geometry'; topic: string; text: string; answer: string; markScheme: string[] }`
  - `DEMO_QUESTIONS: DemoQuestion[]`
  - `getDemoQuestion(id: unknown): DemoQuestion | undefined`
  - `AnnotationSchema`, `ReplyPlain`, `LessonSchema`, `validAnnotation(a: unknown): a is Annotation`
  - `SYSTEM: string`
  - `buildInstruction(a: { question?: string; width: number; height: number; layout?: PageLayout; prior: Annotation[]; transcript: TranscriptLine[]; demo: DemoQuestion }): string`

- [ ] **Step 1: Write the failing test** in `tests/mark-prompt.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_QUESTIONS, getDemoQuestion } from '@/content/demo-questions';
import { buildInstruction, SYSTEM } from '@/lib/mark/prompt';
import { validAnnotation } from '@/lib/mark/schema';

test('three demo questions, one per topic, each with an answer and mark scheme', () => {
  assert.deepEqual(DEMO_QUESTIONS.map((q) => q.id), ['q-algebra', 'q-number', 'q-geometry']);
  for (const q of DEMO_QUESTIONS) {
    assert.ok(q.answer.length > 0);
    assert.ok(q.markScheme.length >= 2);
  }
});

test('unknown question ids are rejected', () => {
  assert.equal(getDemoQuestion('nope'), undefined);
  assert.equal(getDemoQuestion(undefined), undefined);
  assert.equal(getDemoQuestion('q-algebra')?.answer, 'x = 11');
});

test('the instruction carries the question, answer key and mark scheme', () => {
  const demo = getDemoQuestion('q-algebra')!;
  const s = buildInstruction({ width: 900, height: 620, prior: [], transcript: [], demo });
  assert.match(s, /3\(x − 2\) = 2x \+ 5/);
  assert.match(s, /x = 11/);
  assert.match(s, /3x − 6/);
  assert.match(s, /has paused writing/);
});

test('a question turns the instruction into a lesson request', () => {
  const demo = getDemoQuestion('q-number')!;
  const s = buildInstruction({ question: 'Teach me this step', width: 900, height: 620, prior: [], transcript: [], demo });
  assert.match(s, /asks aloud: "Teach me this step"/);
});

test('system prompt is the POC prompt plus the answer-key rules', () => {
  assert.match(SYSTEM, /holding a red pen/);
  assert.match(SYSTEM, /ANSWER KEY/);
});

test('annotation validation matches the POC limits', () => {
  assert.equal(validAnnotation({ kind: 'write', x: 1, y: 1, text: 'x'.repeat(81), size: 'big' }), false);
  assert.equal(validAnnotation({ kind: 'write', x: 1, y: 1, text: '11', size: 'big' }), true);
  assert.equal(validAnnotation({ kind: 'rect', x: 1, y: 1, w: 1, h: 50 }), false);
});
```

- [ ] **Step 2: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/content/demo-questions'".

- [ ] **Step 3: Write `content/demo-questions.ts`**

```ts
// The three questions the live demo offers. Each carries its answer key, so the
// tutor marks against a known result instead of diagnosing from scratch. This is
// a miniature of the question bank in sub-project 2. Question wording avoids the
// words banned by the copy rules.

export interface DemoQuestion {
  id: 'q-algebra' | 'q-number' | 'q-geometry';
  topic: string;
  text: string;
  answer: string;
  markScheme: string[];
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    id: 'q-algebra',
    topic: 'Algebra',
    text: 'Find x:  3(x − 2) = 2x + 5',
    answer: 'x = 11',
    markScheme: [
      'M1: expands the bracket correctly to 3x − 6',
      'M1: collects x terms on one side and numbers on the other, e.g. 3x − 2x = 5 + 6',
      'A1: x = 11',
    ],
  },
  {
    id: 'q-number',
    topic: 'Number',
    text: 'Work out 2/3 + 3/4. Give your result as a mixed number.',
    answer: '1 5/12',
    markScheme: [
      'M1: writes both fractions over a common denominator, e.g. 8/12 + 9/12',
      'M1: adds to 17/12',
      'A1: 1 5/12',
    ],
  },
  {
    id: 'q-geometry',
    topic: 'Geometry',
    text: 'A right-angled triangle has shorter sides 6 cm and 8 cm. Work out the length of the longest side.',
    answer: '10 cm',
    markScheme: [
      'M1: uses Pythagoras: 6² + 8² (= 36 + 64)',
      'M1: 100, then takes the square root',
      'A1: 10 cm',
    ],
  },
];

export function getDemoQuestion(id: unknown): DemoQuestion | undefined {
  return DEMO_QUESTIONS.find((q) => q.id === id);
}
```

- [ ] **Step 4: Write `lib/mark/schema.ts`.** Move the schema and validation code out of `/Users/mz/screen-tutor-poc/app/api/tutor/route.ts` unchanged:

```ts
import { z } from 'zod';
import type { Annotation } from '@/lib/types';

// Output schema, copied from the POC tutor route. Field order matters: the model
// fills these in order, so the verification comes before the verdict.

export const AnnotationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('strike'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ kind: z.literal('write'), x: z.number(), y: z.number(), text: z.string(), size: z.enum(['small', 'normal', 'big']) }),
  z.object({ kind: z.literal('circle'), x: z.number(), y: z.number(), rx: z.number(), ry: z.number() }),
  z.object({ kind: z.literal('arrow'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ kind: z.literal('text'), x: z.number(), y: z.number(), text: z.string() }),
  z.object({ kind: z.literal('line'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ kind: z.literal('rect'), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  z.object({ kind: z.literal('path'), pts: z.array(z.object({ x: z.number(), y: z.number() })) }),
  z.object({ kind: z.literal('ring'), text: z.string() }),
]);

export const ReplyPlain = z.object({
  worthResponding: z.boolean(),
  correct: z.boolean(),
  speech: z.string(),
  annotations: z.array(AnnotationSchema),
});

export const LessonSchema = z.object({
  steps: z.array(z.object({ say: z.string(), write: z.array(AnnotationSchema) })),
});

export function validAnnotation(a: unknown): a is Annotation {
  const r = AnnotationSchema.safeParse(a);
  if (!r.success) return false;
  const v = r.data;
  if ('text' in v) return v.text.length > 0 && v.text.length <= 80;
  if (v.kind === 'path') return v.pts.length >= 2 && v.pts.length <= 60;
  if (v.kind === 'rect') return v.w > 2 && v.h > 2;
  return true;
}
```

- [ ] **Step 5: Write `lib/mark/prompt.ts`.**
  1. Copy `const SYSTEM = \`…\`;` from the POC route verbatim, but delete the `${THINKS_NATIVELY ? … }` interpolation inside step 3. Sonnet 5 always thinks natively, so step 3 simply ends at "…never call a step correct because it looks routine."
  2. Remove the duplicated last "Example: the student draws a circle…" paragraph; the POC has it twice.
  3. Rename the copied constant to `BASE_SYSTEM`.
  4. Copy the `describePrior`, `describeLayout` and `describeTranscript` functions verbatim.
  5. Then add:

```ts
import type { Annotation, PageLayout, TranscriptLine } from '@/lib/types';
import type { DemoQuestion } from '@/content/demo-questions';

// const BASE_SYSTEM = `...` copied from the POC as described in Step 5.
// describePrior / describeLayout / describeTranscript copied verbatim.

const ANSWER_KEY_RULES = `

ANSWER KEY
The student is answering a set GCSE question. You are given the question, its correct final result, and the mark scheme. Use them:
- The final result in the key is correct. A student line that contradicts the key, or that does not follow from the line above it, is an error; mark the FIRST such line.
- Method marks (M1) are for correct method even if a later value is wrong. Accuracy marks (A1) need the exact result.
- If the working is correct but the student has not reached the final result yet, it is unfinished: worthResponding false, say nothing.
- If you cannot read a line with confidence, do not mark it red. Say in one sentence which line you could not read and ask them to rewrite it more clearly.
- Never write the final result on the page for them. Correct only the first wrong value, as usual.`;

export const SYSTEM = BASE_SYSTEM + ANSWER_KEY_RULES;

function describeQuestion(q: DemoQuestion) {
  return `\n\nTHE QUESTION (${q.topic}): ${q.text}\nCorrect final result: ${q.answer}\nMark scheme:\n${q.markScheme.map((m) => `- ${m}`).join('\n')}`;
}

export function buildInstruction(a: {
  question?: string;
  width: number;
  height: number;
  layout?: PageLayout;
  prior: Annotation[];
  transcript: TranscriptLine[];
  demo: DemoQuestion;
}): string {
  return (
    (a.question
      ? `The student is looking at this page and asks aloud: "${a.question}"`
      : `The student has paused writing. Check the working shown.`) +
    ` The image is ${a.width} by ${a.height} ruler units.` +
    describeQuestion(a.demo) +
    describeLayout(a.layout) +
    describePrior(a.prior) +
    describeTranscript(a.transcript)
  );
}
```

- [ ] **Step 6: Run the tests.** `npm test`. Expected: PASS (all tests in `mark-prompt.test.ts` and `page.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add content/demo-questions.ts lib/mark tests/mark-prompt.test.ts
git commit -m "Add demo questions and answer-key marking prompt"
```

---

### Task 4: Abuse guards: counters, limits, IP hash, Turnstile, session

**Files:**
- Create: `lib/guard/counter.ts`, `lib/guard/limits.ts`, `lib/guard/ip.ts`, `lib/guard/turnstile.ts`, `lib/guard/session.ts`
- Test: `tests/guard.test.ts`

**Interfaces:**
- Produces:
  - `interface Counter { incrBy(key: string, n: number, ttlSec: number): Promise<number>; get(key: string): Promise<number> }`
  - `class MemoryCounter implements Counter`
  - `upstashCounter(): Counter`
  - `dayKey(now: Date): string` returns the UTC date as `YYYY-MM-DD`
  - `checkAndCharge(counter: Counter, o: { ipHash: string; costPence: number; countsTowardRate: boolean; perVisitor: number; dailyCapPence: number; now: Date }): Promise<{ ok: true } | { ok: false; reason: 'rate' | 'cap' }>`
  - `clientIp(h: Headers): string`
  - `hashIp(ip: string, salt: string): string`
  - `verifyTurnstile(token: unknown, ip: string, o?: { secret?: string; fetchImpl?: typeof fetch; production?: boolean }): Promise<boolean>`
  - `SESSION_COOKIE = 'rp_session'`
  - `signSession(secret: string, nowMs: number, ttlMs?: number): string`
  - `verifySession(value: string | undefined, secret: string, nowMs: number): boolean`

- [ ] **Step 1: Write the failing test** in `tests/guard.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCounter } from '@/lib/guard/counter';
import { checkAndCharge, dayKey } from '@/lib/guard/limits';
import { clientIp, hashIp } from '@/lib/guard/ip';
import { verifyTurnstile } from '@/lib/guard/turnstile';
import { signSession, verifySession } from '@/lib/guard/session';

const base = { ipHash: 'a', costPence: 1, countsTowardRate: true, perVisitor: 10, dailyCapPence: 1000 };
const noon = new Date('2026-11-02T12:00:00Z');

test('the 11th check from one visitor in a day is rate-limited', async () => {
  const c = new MemoryCounter();
  for (let i = 0; i < 10; i++) assert.deepEqual(await checkAndCharge(c, { ...base, now: noon }), { ok: true });
  assert.deepEqual(await checkAndCharge(c, { ...base, now: noon }), { ok: false, reason: 'rate' });
  assert.deepEqual(await checkAndCharge(c, { ...base, ipHash: 'b', now: noon }), { ok: true });
});

test('calls that do not count toward the rate still spend', async () => {
  const c = new MemoryCounter();
  for (let i = 0; i < 20; i++) assert.deepEqual(await checkAndCharge(c, { ...base, countsTowardRate: false, now: noon }), { ok: true });
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 20);
});

test('the spend cap stops everyone once reached, without charging the refused call', async () => {
  const c = new MemoryCounter();
  const o = { ...base, costPence: 400, countsTowardRate: false, now: noon };
  assert.deepEqual(await checkAndCharge(c, o), { ok: true });
  assert.deepEqual(await checkAndCharge(c, o), { ok: true });
  assert.deepEqual(await checkAndCharge(c, o), { ok: false, reason: 'cap' }); // 1200 > 1000
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 800);
});

test('a rate-limited call is not charged', async () => {
  const c = new MemoryCounter();
  for (let i = 0; i < 10; i++) await checkAndCharge(c, { ...base, now: noon });
  await checkAndCharge(c, { ...base, now: noon });
  assert.equal(await c.get(`spend:${dayKey(noon)}`), 10);
});

test('a new UTC day starts a fresh allowance', async () => {
  const c = new MemoryCounter();
  const late = new Date('2026-11-02T23:59:30Z');
  const early = new Date('2026-11-03T00:00:30Z');
  for (let i = 0; i < 10; i++) await checkAndCharge(c, { ...base, now: late });
  assert.deepEqual(await checkAndCharge(c, { ...base, now: late }), { ok: false, reason: 'rate' });
  assert.deepEqual(await checkAndCharge(c, { ...base, now: early }), { ok: true });
  assert.equal(await c.get(`spend:${dayKey(early)}`), 1);
});

test('client ip comes from the first x-forwarded-for entry, hashed with salt', () => {
  const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
  assert.equal(clientIp(h), '203.0.113.9');
  assert.equal(clientIp(new Headers()), 'unknown');
  assert.notEqual(hashIp('203.0.113.9', 's1'), hashIp('203.0.113.9', 's2'));
  assert.equal(hashIp('x', 's').length, 32);
});

test('turnstile: success, failure, missing token, and dev bypass', async () => {
  const ok = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;
  const bad = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
  assert.equal(await verifyTurnstile('t', '1.1.1.1', { secret: 's', fetchImpl: ok, production: true }), true);
  assert.equal(await verifyTurnstile('t', '1.1.1.1', { secret: 's', fetchImpl: bad, production: true }), false);
  assert.equal(await verifyTurnstile('', '1.1.1.1', { secret: 's', fetchImpl: ok, production: true }), false);
  assert.equal(await verifyTurnstile('', '1.1.1.1', { secret: '', production: false }), true);
  assert.equal(await verifyTurnstile('', '1.1.1.1', { secret: '', production: true }), false);
});

test('session cookie: valid, expired, tampered, wrong secret', () => {
  const now = 1_800_000_000_000;
  const v = signSession('sec', now);
  assert.equal(verifySession(v, 'sec', now + 1000), true);
  assert.equal(verifySession(v, 'sec', now + 25 * 3600_000), false);
  assert.equal(verifySession(v.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), 'sec', now), false);
  assert.equal(verifySession(v, 'other', now), false);
  assert.equal(verifySession(undefined, 'sec', now), false);
});
```

- [ ] **Step 2: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/lib/guard/counter'".

- [ ] **Step 3: Write `lib/guard/counter.ts`**

```ts
import { Redis } from '@upstash/redis';

/** An atomic counter store. Upstash in production, a Map in tests. */
export interface Counter {
  incrBy(key: string, n: number, ttlSec: number): Promise<number>;
  get(key: string): Promise<number>;
}

export class MemoryCounter implements Counter {
  private m = new Map<string, number>();
  async incrBy(key: string, n: number) {
    const v = (this.m.get(key) ?? 0) + n;
    this.m.set(key, v);
    return v;
  }
  async get(key: string) {
    return this.m.get(key) ?? 0;
  }
}

export function upstashCounter(): Counter {
  const r = Redis.fromEnv();
  return {
    async incrBy(key, n, ttlSec) {
      const v = await r.incrby(key, n);
      if (v === n) await r.expire(key, ttlSec); // first write of the day sets the expiry
      return v;
    },
    async get(key) {
      return Number((await r.get<number>(key)) ?? 0);
    },
  };
}
```

- [ ] **Step 4: Write `lib/guard/limits.ts`**

```ts
import type { Counter } from './counter';

const TWO_DAYS = 2 * 24 * 3600;

export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Enforces the per-visitor daily check limit and the global daily spend cap,
 * then records the spend. Refused calls are never charged. Two simultaneous
 * calls can overshoot the cap by one call's cost; that is accepted.
 */
export async function checkAndCharge(
  counter: Counter,
  o: { ipHash: string; costPence: number; countsTowardRate: boolean; perVisitor: number; dailyCapPence: number; now: Date },
): Promise<{ ok: true } | { ok: false; reason: 'rate' | 'cap' }> {
  const day = dayKey(o.now);
  const spendKey = `spend:${day}`;
  if ((await counter.get(spendKey)) + o.costPence > o.dailyCapPence) return { ok: false, reason: 'cap' };
  if (o.countsTowardRate) {
    const rateKey = `rl:${day}:${o.ipHash}`;
    if ((await counter.get(rateKey)) >= o.perVisitor) return { ok: false, reason: 'rate' };
    await counter.incrBy(rateKey, 1, TWO_DAYS);
  }
  await counter.incrBy(spendKey, o.costPence, TWO_DAYS);
  return { ok: true };
}
```

- [ ] **Step 5: Write `lib/guard/ip.ts`, `lib/guard/turnstile.ts` and `lib/guard/session.ts`**

```ts
// lib/guard/ip.ts
import { createHash } from 'node:crypto';

export function clientIp(h: Headers): string {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

/** Salted so the rate-limit keys never hold a raw IP address. */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}
```

```ts
// lib/guard/turnstile.ts
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Returns true when Cloudflare confirms the token. With no secret outside production, it is open for local dev. */
export async function verifyTurnstile(
  token: unknown,
  ip: string,
  o: { secret?: string; fetchImpl?: typeof fetch; production?: boolean } = {},
): Promise<boolean> {
  const secret = o.secret ?? process.env.TURNSTILE_SECRET_KEY ?? '';
  const production = o.production ?? process.env.NODE_ENV === 'production';
  if (!secret) return !production;
  if (typeof token !== 'string' || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await (o.fetchImpl ?? fetch)(VERIFY_URL, { method: 'POST', body });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}
```

```ts
// lib/guard/session.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// Turnstile tokens are single-use, so a visitor proves they are human once and
// gets a signed cookie that the demo routes accept for 24 hours.
export const SESSION_COOKIE = 'rp_session';
const DAY = 24 * 3600_000;

const mac = (secret: string, exp: string) => createHmac('sha256', secret).update(exp).digest('hex');

export function signSession(secret: string, nowMs: number, ttlMs = DAY): string {
  const exp = String(nowMs + ttlMs);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(value: string | undefined, secret: string, nowMs: number): boolean {
  if (!value || !secret) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  const want = Buffer.from(mac(secret, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
```

- [ ] **Step 6: Run the tests.** `npm test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/guard tests/guard.test.ts
git commit -m "Add rate limit, spend cap, Turnstile and session guards"
```

---

### Task 5: Database schema and repository

**Files:**
- Create: `db/schema.sql`, `lib/boards.ts`, `lib/db.ts`, `scripts/migrate.mjs`, `tests/helpers/pglite.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces:
  - `type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>`
  - `neonQuery(url?: string): Query`
  - `type Role = 'parent' | 'student'`
  - `type Board = 'AQA' | 'Edexcel' | 'OCR' | 'Not sure'`
  - `BOARDS: Board[]`

    These three live in `lib/boards.ts` (safe to import in client components) and are re-exported from `lib/db.ts`.
  - `addToWaitlist(q, w: { email: string; role: Role; board: Board | null; token: string }): Promise<{ created: boolean; confirmed: boolean; token: string }>`
  - `confirmWaitlist(q, token: string): Promise<boolean>`
  - `upsertCompletedOrder(q, o: { txnId: string; email: string; board: Board | null; amountPence: number; currency: string }): Promise<void>`
  - `markRefunded(q, txnId: string): Promise<void>`
  - `getOrder(q, txnId: string): Promise<{ txnId: string; email: string; board: Board | null; status: 'completed' | 'refunded' } | null>`
  - `countActiveOrders(q): Promise<number>`
  - `setOrderBoard(q, txnId: string, board: Board): Promise<boolean>`
  - `bumpStat(q, day: string, field: 'checks' | 'errors_caught' | 'teach_taps'): Promise<void>`
  - `unsubscribeWaitlist(q, token: string): Promise<boolean>`
  - Test helper `freshDb(): Promise<Query>`

- [ ] **Step 1: Write `db/schema.sql`**

```sql
-- No child data in any table. Emails are the parent's (or a student joining the waitlist).
CREATE TABLE IF NOT EXISTS waitlist (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('parent', 'student')),
  board TEXT NULL,
  token TEXT NOT NULL UNIQUE,
  confirmed_at TIMESTAMPTZ NULL,
  unsubscribed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  paddle_txn_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  board TEXT NULL,
  amount_pence INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  status TEXT NOT NULL CHECK (status IN ('completed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_stats (
  day DATE PRIMARY KEY,
  checks INTEGER NOT NULL DEFAULT 0,
  errors_caught INTEGER NOT NULL DEFAULT 0,
  teach_taps INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Write the test helper and the failing test**

`tests/helpers/pglite.ts`:
```ts
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { Query } from '@/lib/db';

export async function freshDb(): Promise<Query> {
  const db = new PGlite();
  await db.exec(readFileSync('db/schema.sql', 'utf8'));
  return async (text, params = []) => (await db.query(text, params as unknown[])).rows as Record<string, unknown>[];
}
```

`tests/db.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/pglite';
import {
  addToWaitlist, confirmWaitlist, upsertCompletedOrder, markRefunded, getOrder,
  countActiveOrders, setOrderBoard, bumpStat, unsubscribeWaitlist,
} from '@/lib/db';

test('waitlist: new, duplicate (case-insensitive), confirm', async () => {
  const q = await freshDb();
  const a = await addToWaitlist(q, { email: 'Parent@Example.com', role: 'parent', board: 'AQA', token: 't1' });
  assert.deepEqual(a, { created: true, confirmed: false, token: 't1' });
  const b = await addToWaitlist(q, { email: 'parent@example.com ', role: 'parent', board: null, token: 't2' });
  assert.deepEqual(b, { created: false, confirmed: false, token: 't1' });
  assert.equal(await confirmWaitlist(q, 't1'), true);
  assert.equal(await confirmWaitlist(q, 'nope'), false);
  const c = await addToWaitlist(q, { email: 'parent@example.com', role: 'parent', board: null, token: 't3' });
  assert.equal(c.confirmed, true);
});

test('orders: completed, repeated event, refund returns the pass', async () => {
  const q = await freshDb();
  const o = { txnId: 'txn_1', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' };
  await upsertCompletedOrder(q, o);
  await upsertCompletedOrder(q, o);
  assert.equal(await countActiveOrders(q), 1);
  await markRefunded(q, 'txn_1');
  assert.equal(await countActiveOrders(q), 0);
  assert.equal((await getOrder(q, 'txn_1'))?.status, 'refunded');
});

test('a refund that arrives first wins over a later completed event', async () => {
  const q = await freshDb();
  await markRefunded(q, 'txn_2');
  await upsertCompletedOrder(q, { txnId: 'txn_2', email: 'p@x.com', board: 'OCR', amountPence: 4900, currency: 'GBP' });
  const o = await getOrder(q, 'txn_2');
  assert.equal(o?.status, 'refunded');
  assert.equal(o?.email, 'p@x.com');
  assert.equal(await countActiveOrders(q), 0);
});

test('board can be set once, only on an existing order', async () => {
  const q = await freshDb();
  await upsertCompletedOrder(q, { txnId: 'txn_3', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  assert.equal(await setOrderBoard(q, 'txn_3', 'Edexcel'), true);
  assert.equal(await setOrderBoard(q, 'txn_3', 'AQA'), false);
  assert.equal(await setOrderBoard(q, 'txn_missing', 'AQA'), false);
  assert.equal((await getOrder(q, 'txn_3'))?.board, 'Edexcel');
});

test('unsubscribe by token', async () => {
  const q = await freshDb();
  await addToWaitlist(q, { email: 'u@x.com', role: 'parent', board: null, token: 'tu' });
  assert.equal(await unsubscribeWaitlist(q, 'tu'), true);
  assert.equal(await unsubscribeWaitlist(q, 'nope'), false);
  const [r] = await q('SELECT unsubscribed_at IS NOT NULL AS u FROM waitlist');
  assert.equal(r.u, true);
});

test('stats bump per day', async () => {
  const q = await freshDb();
  await bumpStat(q, '2026-11-02', 'checks');
  await bumpStat(q, '2026-11-02', 'checks');
  await bumpStat(q, '2026-11-02', 'teach_taps');
  const rows = await q('SELECT checks, teach_taps, errors_caught FROM demo_stats');
  assert.deepEqual(rows[0], { checks: 2, teach_taps: 1, errors_caught: 0 });
});
```

- [ ] **Step 3: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/lib/db'".

- [ ] **Step 4: Write `lib/boards.ts` and `lib/db.ts`**

```ts
// lib/boards.ts: no server imports, so client components can use it.
export type Role = 'parent' | 'student';
export type Board = 'AQA' | 'Edexcel' | 'OCR' | 'Not sure';
export const BOARDS: Board[] = ['AQA', 'Edexcel', 'OCR', 'Not sure'];
```

```ts
// lib/db.ts
import { neon } from '@neondatabase/serverless';
import type { Board, Role } from './boards';
export { BOARDS, type Board, type Role } from './boards';

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

let cached: Query | null = null;
/** Production query function. The Neon driver's .query(text, params) returns rows. */
export function neonQuery(url = process.env.DATABASE_URL): Query {
  if (cached) return cached;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = neon(url);
  cached = async (text, params = []) => (await sql.query(text, params)) as Record<string, unknown>[];
  return cached;
}

const norm = (email: string) => email.trim().toLowerCase();

export async function addToWaitlist(q: Query, w: { email: string; role: Role; board: Board | null; token: string }) {
  const email = norm(w.email);
  const inserted = await q(
    `INSERT INTO waitlist (email, role, board, token) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING RETURNING token`,
    [email, w.role, w.board, w.token],
  );
  if (inserted.length) return { created: true, confirmed: false, token: w.token };
  const [row] = await q(`SELECT token, confirmed_at FROM waitlist WHERE email = $1`, [email]);
  return { created: false, confirmed: row.confirmed_at !== null, token: String(row.token) };
}

export async function confirmWaitlist(q: Query, token: string) {
  const rows = await q(`UPDATE waitlist SET confirmed_at = COALESCE(confirmed_at, now()) WHERE token = $1 RETURNING id`, [token]);
  return rows.length > 0;
}

export async function upsertCompletedOrder(
  q: Query,
  o: { txnId: string; email: string; board: Board | null; amountPence: number; currency: string },
) {
  // A refund that landed first keeps the row refunded; the details still fill in.
  await q(
    `INSERT INTO orders (paddle_txn_id, email, board, amount_pence, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'completed')
     ON CONFLICT (paddle_txn_id) DO UPDATE SET
       email = EXCLUDED.email,
       board = COALESCE(orders.board, EXCLUDED.board),
       amount_pence = EXCLUDED.amount_pence,
       currency = EXCLUDED.currency,
       updated_at = now()`,
    [o.txnId, norm(o.email), o.board, o.amountPence, o.currency],
  );
}

export async function markRefunded(q: Query, txnId: string) {
  await q(
    `INSERT INTO orders (paddle_txn_id, status) VALUES ($1, 'refunded')
     ON CONFLICT (paddle_txn_id) DO UPDATE SET status = 'refunded', updated_at = now()`,
    [txnId],
  );
}

export async function getOrder(q: Query, txnId: string) {
  const [r] = await q(`SELECT paddle_txn_id, email, board, status FROM orders WHERE paddle_txn_id = $1`, [txnId]);
  if (!r) return null;
  return {
    txnId: String(r.paddle_txn_id),
    email: String(r.email),
    board: (r.board as Board | null) ?? null,
    status: r.status as 'completed' | 'refunded',
  };
}

export async function countActiveOrders(q: Query) {
  const [r] = await q(`SELECT count(*)::int AS n FROM orders WHERE status = 'completed'`);
  return Number(r.n);
}

export async function setOrderBoard(q: Query, txnId: string, board: Board) {
  const rows = await q(`UPDATE orders SET board = $2, updated_at = now() WHERE paddle_txn_id = $1 AND board IS NULL RETURNING id`, [txnId, board]);
  return rows.length > 0;
}

export async function unsubscribeWaitlist(q: Query, token: string) {
  const rows = await q(`UPDATE waitlist SET unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE token = $1 RETURNING id`, [token]);
  return rows.length > 0;
}

export async function bumpStat(q: Query, day: string, field: 'checks' | 'errors_caught' | 'teach_taps') {
  // field is a closed union, so it is safe to interpolate as a column name.
  await q(
    `INSERT INTO demo_stats (day, ${field}) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET ${field} = demo_stats.${field} + 1`,
    [day],
  );
}
```

- [ ] **Step 5: Write `scripts/migrate.mjs`**

```js
// Applies db/schema.sql to DATABASE_URL. Idempotent (CREATE TABLE IF NOT EXISTS).
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = neon(url);
const statements = readFileSync('db/schema.sql', 'utf8')
  .split(/;\s*\n/)
  .map((s) => s.replace(/^--.*$/gm, '').trim())
  .filter(Boolean);
for (const s of statements) await sql.query(s);
console.log(`applied ${statements.length} statements`);
```

- [ ] **Step 6: Run the tests.** `npm test`. Expected: PASS. If `sql.query` does not exist in the installed Neon driver version, check its README for the parameterised-query call and adapt `neonQuery` and `migrate.mjs` only.

- [ ] **Step 7: Commit**

```bash
git add db lib/boards.ts lib/db.ts scripts/migrate.mjs tests/helpers tests/db.test.ts
git commit -m "Add Postgres schema and repository for waitlist, orders, stats"
```

---

### Task 6: Session, mark and speak routes

**Files:**
- Create: `lib/http.ts`, `lib/mark/anthropic.ts`, `lib/mark/handler.ts`, `lib/speak/handler.ts`, `app/api/session/route.ts`, `app/api/mark/route.ts`, `app/api/speak/route.ts`
- Test: `tests/mark-handler.test.ts`

**Interfaces:**
- Consumes: `checkAndCharge`, `Counter`, `dayKey` (Task 4); `getDemoQuestion`, `buildInstruction`, `SYSTEM`, `validAnnotation`, `LessonSchema`, `ReplyPlain` (Task 3); `bumpStat`, `Query` (Task 5); `config()` (Task 2).
- Produces:
  - `interface HandlerResult { status: number; json: unknown; headers?: Record<string, string> }`
  - `toResponse(r: HandlerResult): Response`
  - `interface RequestCtx { ipHash: string; sessionOk: boolean }`
  - `readCtx(req: Request): RequestCtx`
  - `type ModelCall = (a: { system: string; instruction: string; base64: string; lesson: boolean }) => Promise<{ kind: 'ok'; parsed: unknown; model: string; tokens: string } | { kind: 'fail'; reason: 'refusal' | 'max_tokens' | 'invalid' | 'api' }>`
  - `callAnthropic: ModelCall`
  - `interface MarkDeps { model: ModelCall; counter: Counter; stat: (field: 'checks' | 'errors_caught' | 'teach_taps') => Promise<void>; now: () => Date }`
  - `handleMark(body: unknown, ctx: RequestCtx, deps: MarkDeps): Promise<HandlerResult>`
  - `guardSpeak(body: unknown, ctx: RequestCtx, deps: { counter: Counter; now: () => Date }): Promise<{ ok: true; text: string } | { ok: false; result: HandlerResult }>`
  - The 429 JSON shape is `{ error: string; reason: 'rate' | 'cap' }`, and `TryIt` (Task 10) switches to the scripted demo when it sees one.

- [ ] **Step 1: Write the failing test** in `tests/mark-handler.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCounter } from '@/lib/guard/counter';
import { handleMark, type MarkDeps } from '@/lib/mark/handler';
import { guardSpeak } from '@/lib/speak/handler';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const ctx = { ipHash: 'h', sessionOk: true };
const body = (extra: object = {}) => ({ dataUrl: PNG, space: { width: 900, height: 620 }, questionId: 'q-algebra', prior: [], transcript: [], ...extra });

function deps(parsed: unknown, stats: string[] = []): MarkDeps {
  return {
    model: async () => ({ kind: 'ok', parsed, model: 'claude-sonnet-5', tokens: '10/10' }),
    counter: new MemoryCounter(),
    stat: async (f) => void stats.push(f),
    now: () => new Date('2026-11-02T12:00:00Z'),
  };
}
const wrong = { worthResponding: true, correct: false, speech: 'What is 3 × −2?', annotations: [{ kind: 'strike', x1: 1, y1: 1, x2: 20, y2: 1 }] };

test('no session → 403', async () => {
  const r = await handleMark(body(), { ...ctx, sessionOk: false }, deps(wrong));
  assert.equal(r.status, 403);
});

test('unknown question → 400', async () => {
  const r = await handleMark(body({ questionId: 'q-x' }), ctx, deps(wrong));
  assert.equal(r.status, 400);
});

test('non-PNG → 400', async () => {
  const r = await handleMark(body({ dataUrl: 'data:image/jpeg;base64,xx' }), ctx, deps(wrong));
  assert.equal(r.status, 400);
});

test('a wrong answer is marked and counted', async () => {
  const stats: string[] = [];
  const r = await handleMark(body(), ctx, deps(wrong, stats));
  assert.equal(r.status, 200);
  assert.equal((r.json as { annotations: unknown[] }).annotations.length, 1);
  assert.deepEqual(stats, ['checks', 'errors_caught']);
});

test('a doodle gets no speech and no marks', async () => {
  const r = await handleMark(body(), ctx, deps({ ...wrong, worthResponding: false }));
  assert.deepEqual((r.json as { annotations: unknown[]; speech: string }).annotations, []);
  assert.equal((r.json as { speech: string }).speech, '');
});

test('the 11th check is 429 with reason rate', async () => {
  const d = deps(wrong);
  for (let i = 0; i < 10; i++) assert.equal((await handleMark(body(), ctx, d)).status, 200);
  const r = await handleMark(body(), ctx, d);
  assert.equal(r.status, 429);
  assert.equal((r.json as { reason: string }).reason, 'rate');
});

test('a lesson request returns steps and counts a teach tap', async () => {
  const stats: string[] = [];
  const lesson = { steps: [{ say: 'Expand the bracket first.', write: [{ kind: 'write', x: 500, y: 200, text: '3x − 6', size: 'normal' }] }] };
  const r = await handleMark(body({ question: 'Teach me this step' }), ctx, deps(lesson, stats));
  assert.equal((r.json as { steps: unknown[] }).steps.length, 1);
  assert.deepEqual(stats, ['teach_taps']);
});

test('a model failure is 502 and never leaks details', async () => {
  const d = deps(wrong);
  d.model = async () => ({ kind: 'fail', reason: 'refusal' });
  const r = await handleMark(body(), ctx, d);
  assert.equal(r.status, 502);
  assert.doesNotMatch(JSON.stringify(r.json), /refusal|stack|Error:/);
});

test('speak: needs session, trims text, respects the cap', async () => {
  const counter = new MemoryCounter();
  const now = () => new Date('2026-11-02T12:00:00Z');
  const denied = await guardSpeak({ text: 'hi' }, { ...ctx, sessionOk: false }, { counter, now });
  assert.equal(denied.ok, false);
  const ok = await guardSpeak({ text: '  hello  ' }, ctx, { counter, now });
  assert.deepEqual(ok, { ok: true, text: 'hello' });
  const empty = await guardSpeak({ text: '' }, ctx, { counter, now });
  assert.equal(empty.ok, false);
});
```

- [ ] **Step 2: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/lib/mark/handler'".

- [ ] **Step 3: Write `lib/http.ts`**

```ts
import { clientIp, hashIp } from '@/lib/guard/ip';
import { SESSION_COOKIE, verifySession } from '@/lib/guard/session';

export interface HandlerResult {
  status: number;
  json: unknown;
  headers?: Record<string, string>;
}

export function toResponse(r: HandlerResult): Response {
  return Response.json(r.json, { status: r.status, headers: r.headers });
}

export interface RequestCtx {
  ipHash: string;
  sessionOk: boolean;
}

function cookie(req: Request, name: string) {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1];
}

export function readCtx(req: Request): RequestCtx {
  const devOpen = process.env.DEMO_DEV_OPEN === '1' && process.env.NODE_ENV !== 'production';
  return {
    ipHash: hashIp(clientIp(req.headers), process.env.IP_SALT ?? 'dev-salt'),
    sessionOk: devOpen || verifySession(cookie(req, SESSION_COOKIE), process.env.SESSION_SECRET ?? '', Date.now()),
  };
}
```

- [ ] **Step 4: Write `lib/mark/anthropic.ts`.** This is the POC call, reduced to Sonnet 5 behaviour.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LessonSchema, ReplyPlain } from './schema';
import type { ModelCall } from './handler';

const MODEL = process.env.TUTOR_MODEL ?? 'claude-sonnet-5';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const callAnthropic: ModelCall = async ({ system, instruction, base64, lesson }) => {
  try {
    const format = lesson ? zodOutputFormat(LessonSchema) : zodOutputFormat(ReplyPlain);
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      system,
      output_config: { effort: lesson ? 'medium' : 'low', format },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            { type: 'text', text: instruction },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal') return { kind: 'fail', reason: 'refusal' };
    if (response.stop_reason === 'max_tokens') return { kind: 'fail', reason: 'max_tokens' };
    if (!response.parsed_output) return { kind: 'fail', reason: 'invalid' };
    return {
      kind: 'ok',
      parsed: response.parsed_output,
      model: response.model,
      tokens: `${response.usage.input_tokens}/${response.usage.output_tokens}`,
    };
  } catch (err) {
    console.error('mark: model call failed', err instanceof Error ? err.message : err);
    return { kind: 'fail', reason: 'api' };
  }
};
```

- [ ] **Step 5: Write `lib/mark/handler.ts`**

```ts
import type { Annotation, PageLayout, TranscriptLine, TutorReply } from '@/lib/types';
import type { Counter } from '@/lib/guard/counter';
import { checkAndCharge } from '@/lib/guard/limits';
import type { HandlerResult, RequestCtx } from '@/lib/http';
import { config } from '@/lib/config';
import { getDemoQuestion } from '@/content/demo-questions';
import { buildInstruction, SYSTEM } from './prompt';
import { validAnnotation } from './schema';

export type ModelCall = (a: { system: string; instruction: string; base64: string; lesson: boolean }) => Promise<
  { kind: 'ok'; parsed: unknown; model: string; tokens: string } | { kind: 'fail'; reason: 'refusal' | 'max_tokens' | 'invalid' | 'api' }
>;

export interface MarkDeps {
  model: ModelCall;
  counter: Counter;
  stat: (field: 'checks' | 'errors_caught' | 'teach_taps') => Promise<void>;
  now: () => Date;
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max).trim();
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fail = (status: number, error: string, extra: object = {}): HandlerResult => ({ status, json: { error, ...extra } });

export async function handleMark(raw: unknown, ctx: RequestCtx, deps: MarkDeps): Promise<HandlerResult> {
  if (!ctx.sessionOk) return fail(403, 'Please reload the page and try again.');
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const demo = getDemoQuestion(body.questionId);
  if (!demo) return fail(400, 'Unknown question.');
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl ?? ''));
  if (!m) return fail(400, 'dataUrl must be a PNG data URL.');

  const space = body.space as { width?: unknown; height?: unknown } | undefined;
  const width = num(space?.width) ? space!.width : 900;
  const height = num(space?.height) ? space!.height : 620;
  const question = clean(body.question, 300);
  const lesson = Boolean(question);
  const layout = body.layout && typeof body.layout === 'object' ? (body.layout as PageLayout) : undefined;
  const prior = (Array.isArray(body.prior) ? body.prior : []).filter(validAnnotation) as Annotation[];
  const transcript: TranscriptLine[] = (Array.isArray(body.transcript) ? body.transcript : [])
    .slice(-8)
    .map((l: { who?: unknown; text?: unknown }) => ({ who: l?.who === 'tutor' ? ('tutor' as const) : ('student' as const), text: clean(l?.text, 300) }))
    .filter((l: TranscriptLine) => l.text);

  const c = config();
  const gate = await checkAndCharge(deps.counter, {
    ipHash: ctx.ipHash,
    costPence: lesson ? c.costs.lessonPence : c.costs.checkPence,
    countsTowardRate: !lesson,
    perVisitor: c.perVisitor,
    dailyCapPence: c.dailyCapPence,
    now: deps.now(),
  });
  if (!gate.ok) return fail(429, 'The live demo is busy.', { reason: gate.reason });

  const res = await deps.model({
    system: SYSTEM,
    instruction: buildInstruction({ question: question || undefined, width, height, layout, prior, transcript, demo }),
    base64: m[1],
    lesson,
  });
  if (res.kind === 'fail') return fail(502, 'The tutor could not answer that time.');
  const headers = { 'x-tutor-model': res.model, 'x-tutor-tokens': res.tokens };

  if (lesson) {
    const parsed = res.parsed as { steps?: { say?: string; write?: unknown[] }[] };
    const steps = (parsed.steps ?? [])
      .slice(0, 8)
      .map((st) => ({ say: String(st.say ?? '').trim(), write: (st.write ?? []).filter(validAnnotation).slice(0, 10) }))
      .filter((st) => st.say || st.write.length);
    await deps.stat('teach_taps').catch(() => {});
    const reply: TutorReply = { worthResponding: true, correct: true, speech: '', annotations: [], steps };
    return { status: 200, json: reply, headers };
  }

  const p = res.parsed as { worthResponding?: boolean; correct?: boolean; speech?: string; annotations?: unknown[] };
  const reply: TutorReply = {
    worthResponding: p.worthResponding === true,
    correct: p.correct === true,
    speech: String(p.speech ?? '').trim(),
    annotations: (p.annotations ?? []).filter(validAnnotation).slice(0, 4),
  };
  if (!reply.worthResponding) {
    reply.speech = '';
    reply.annotations = [];
  }
  await deps.stat('checks').catch(() => {});
  if (reply.worthResponding && !reply.correct && reply.annotations.length) await deps.stat('errors_caught').catch(() => {});
  return { status: 200, json: reply, headers };
}
```

- [ ] **Step 6: Write `lib/speak/handler.ts`**

```ts
import type { Counter } from '@/lib/guard/counter';
import { checkAndCharge } from '@/lib/guard/limits';
import type { HandlerResult, RequestCtx } from '@/lib/http';
import { config } from '@/lib/config';

const MAX_CHARS = 600;

export async function guardSpeak(
  raw: unknown,
  ctx: RequestCtx,
  deps: { counter: Counter; now: () => Date },
): Promise<{ ok: true; text: string } | { ok: false; result: HandlerResult }> {
  if (!ctx.sessionOk) return { ok: false, result: { status: 403, json: { error: 'Please reload the page.' } } };
  const text = String((raw as { text?: unknown } | null)?.text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, MAX_CHARS)
    .trim();
  if (!text) return { ok: false, result: { status: 400, json: { error: 'Nothing to say.' } } };
  const c = config();
  const gate = await checkAndCharge(deps.counter, {
    ipHash: ctx.ipHash, costPence: c.costs.speakPence, countsTowardRate: false,
    perVisitor: c.perVisitor, dailyCapPence: c.dailyCapPence, now: deps.now(),
  });
  if (!gate.ok) return { ok: false, result: { status: 429, json: { error: 'Voice is busy.', reason: gate.reason } } };
  return { ok: true, text };
}
```

- [ ] **Step 7: Run the tests.** `npm test`. Expected: PASS.

- [ ] **Step 8: Write the three routes.** Read `node_modules/next/dist/docs/` on route handlers and cookies first.

`app/api/session/route.ts`:
```ts
import { clientIp } from '@/lib/guard/ip';
import { verifyTurnstile } from '@/lib/guard/turnstile';
import { SESSION_COOKIE, signSession } from '@/lib/guard/session';

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: unknown };
  if (!(await verifyTurnstile(token, clientIp(req.headers)))) {
    return Response.json({ error: 'Please retry.' }, { status: 403 });
  }
  const value = signSession(process.env.SESSION_SECRET ?? '', Date.now());
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': `${SESSION_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=86400${secure}` } },
  );
}
```

`app/api/mark/route.ts`:
```ts
import { callAnthropic } from '@/lib/mark/anthropic';
import { handleMark } from '@/lib/mark/handler';
import { upstashCounter, MemoryCounter } from '@/lib/guard/counter';
import { dayKey } from '@/lib/guard/limits';
import { bumpStat, neonQuery } from '@/lib/db';
import { readCtx, toResponse } from '@/lib/http';

export const runtime = 'nodejs';
// Local dev without Upstash uses an in-process counter.
const counter = process.env.UPSTASH_REDIS_REST_URL ? upstashCounter() : new MemoryCounter();

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const result = await handleMark(body, readCtx(req), {
    model: callAnthropic,
    counter,
    stat: async (f) => {
      if (process.env.DATABASE_URL) await bumpStat(neonQuery(), dayKey(new Date()), f);
    },
    now: () => new Date(),
  });
  return toResponse(result);
}
```

`app/api/speak/route.ts`:
```ts
import { guardSpeak } from '@/lib/speak/handler';
import { upstashCounter, MemoryCounter } from '@/lib/guard/counter';
import { readCtx, toResponse } from '@/lib/http';

export const runtime = 'nodejs';
const counter = process.env.UPSTASH_REDIS_REST_URL ? upstashCounter() : new MemoryCounter();

export async function GET() {
  return Response.json({ available: Boolean(process.env.OPENAI_API_KEY), provider: process.env.OPENAI_API_KEY ? 'openai' : null });
}

export async function POST(req: Request) {
  const g = await guardSpeak(await req.json().catch(() => null), readCtx(req), { counter, now: () => new Date() });
  if (!g.ok) return toResponse(g.result);
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: 'No voice service configured.' }, { status: 503 });
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.TTS_MODEL ?? 'gpt-4o-mini-tts',
      voice: process.env.TTS_VOICE ?? 'sage',
      input: g.text,
      instructions: 'You are a patient British maths tutor talking to a student while writing on a page. Warm, unhurried, clear.',
      response_format: 'mp3',
      stream_format: 'audio',
    }),
  }).catch(() => null);
  if (!r?.ok) return Response.json({ error: 'Voice unavailable.' }, { status: 502 });
  return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 9: Remove the POC password header from `lib/speech.ts`.** Delete the `tutorKey()` function and the `'x-tutor-key': tutorKey()` header entry in `fetchAudio`. The session cookie now does that job, and it is sent automatically because the requests are same-origin.

- [ ] **Step 10: Smoke test.** Run `npm run build`; it must succeed. Then run `DEMO_DEV_OPEN=1 npm run dev` with `ANTHROPIC_API_KEY` in `.env.local`, and:

```bash
curl -s -X POST localhost:3000/api/mark -H 'content-type: application/json' -d '{"questionId":"q-x","dataUrl":"x"}'
```

Expected: `{"error":"Unknown question."}`. Stop the server with `pkill -9 -f "next-server"`.

- [ ] **Step 11: Commit**

```bash
git add lib/http.ts lib/mark lib/speak lib/speech.ts app/api tests/mark-handler.test.ts
git commit -m "Add guarded mark, speak and session routes"
```

---

### Task 7: Waitlist with double opt-in

**Files:**
- Create: `lib/email.ts`, `lib/waitlist/handler.ts`, `app/api/waitlist/route.ts`, `app/api/waitlist/confirm/route.ts`, `app/api/waitlist/unsubscribe/route.ts`
- Test: `tests/waitlist.test.ts`

**Interfaces:**
- Consumes: `addToWaitlist`, `confirmWaitlist`, `Query`, `BOARDS`, `Board` (Task 5); `verifyTurnstile` (Task 4); `HandlerResult` (Task 6).
- Produces:
  - `type SendEmail = (to: string, subject: string, html: string) => Promise<void>`
  - `resendSender(): SendEmail`
  - `waitlistConfirmEmail(confirmUrl: string): { subject: string; html: string }`
  - `purchaseEmail(siteUrl: string): { subject: string; html: string }` (used by Task 8)
  - `buildUpdateEmail(bodyHtml: string, unsubscribeUrl: string): { subject: string; html: string }`, the template for the manual monthly update. Every marketing email ends with the unsubscribe link.
  - `handleJoin(body: unknown, ip: string, deps: { q: Query; send: SendEmail; verify: (token: unknown, ip: string) => Promise<boolean>; siteUrl: string; newToken: () => string }): Promise<HandlerResult>`
  - `handleConfirm(token: string | null, deps: { q: Query; siteUrl: string }): Promise<string>`, which returns the redirect URL.
  - The waitlist form posts `{ email, role, board, token }`.

- [ ] **Step 1: Write the failing test** in `tests/waitlist.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/pglite';
import { handleJoin, handleConfirm } from '@/lib/waitlist/handler';

async function setup() {
  const q = await freshDb();
  const sent: { to: string; html: string }[] = [];
  let n = 0;
  const deps = {
    q,
    send: async (to: string, _s: string, html: string) => void sent.push({ to, html }),
    verify: async (t: unknown) => t === 'ok',
    siteUrl: 'https://redpenmaths.com',
    newToken: () => `tok${++n}`,
  };
  return { q, sent, deps };
}

test('invalid email → 400, bad turnstile → 403', async () => {
  const { deps } = await setup();
  assert.equal((await handleJoin({ email: 'nope', role: 'parent', token: 'ok' }, '1.1.1.1', deps)).status, 400);
  assert.equal((await handleJoin({ email: 'a@b.co', role: 'parent', token: 'bad' }, '1.1.1.1', deps)).status, 403);
});

test('join sends one confirm email with a working link', async () => {
  const { deps, sent } = await setup();
  const r = await handleJoin({ email: 'Mum@Example.com', role: 'parent', board: 'AQA', token: 'ok' }, '1.1.1.1', deps);
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'mum@example.com');
  assert.match(sent[0].html, /https:\/\/redpenmaths\.com\/api\/waitlist\/confirm\?token=tok1/);
  assert.equal(await handleConfirm('tok1', deps), 'https://redpenmaths.com/?waitlist=confirmed#waitlist');
  assert.equal(await handleConfirm('bogus', deps), 'https://redpenmaths.com/?waitlist=invalid#waitlist');
});

test('re-joining unconfirmed resends; re-joining confirmed sends nothing; both look the same to the visitor', async () => {
  const { deps, sent } = await setup();
  await handleJoin({ email: 'a@b.co', role: 'student', token: 'ok' }, 'ip', deps);
  const again = await handleJoin({ email: 'A@B.co', role: 'student', token: 'ok' }, 'ip', deps);
  assert.equal(sent.length, 2);
  assert.match(sent[1].html, /token=tok1/);
  await handleConfirm('tok1', deps);
  const third = await handleJoin({ email: 'a@b.co', role: 'student', token: 'ok' }, 'ip', deps);
  assert.equal(sent.length, 2);
  assert.deepEqual(again.json, third.json);
});

test('the monthly update template always carries the unsubscribe link', async () => {
  const { buildUpdateEmail } = await import('@/lib/email');
  const m = buildUpdateEmail('<p>News</p>', 'https://redpenmaths.com/api/waitlist/unsubscribe?token=abc');
  assert.match(m.html, /Unsubscribe/);
  assert.match(m.html, /token=abc/);
});

test('unknown role and board are normalised', async () => {
  const { deps, q } = await setup();
  await handleJoin({ email: 'c@d.co', role: 'admin', board: 'Hacked', token: 'ok' }, 'ip', deps);
  const [row] = await q('SELECT role, board FROM waitlist');
  assert.deepEqual(row, { role: 'parent', board: null });
});
```

- [ ] **Step 2: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/lib/waitlist/handler'".

- [ ] **Step 3: Write `lib/email.ts`**

```ts
import { Resend } from 'resend';

export type SendEmail = (to: string, subject: string, html: string) => Promise<void>;

export function resendSender(): SendEmail {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? 'RedPen Maths <hello@redpenmaths.com>';
  return async (to, subject, html) => {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(`email failed: ${error.message}`);
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function waitlistConfirmEmail(confirmUrl: string) {
  return {
    subject: 'Confirm your place on the RedPen Maths waitlist',
    html: `<p>Hi,</p>
<p>Thanks for your interest in RedPen Maths. Please confirm your email so we can tell you when it opens and how the build is going:</p>
<p><a href="${esc(confirmUrl)}">Confirm my email</a></p>
<p>If you didn't ask for this, ignore this email and you won't hear from us again.</p>
<p>RedPen Maths, by DefyScale</p>`,
  };
}

export function purchaseEmail(siteUrl: string) {
  return {
    subject: "You're in: your RedPen Maths early-bird pass",
    html: `<p>Thank you for backing RedPen Maths. Paddle has sent your receipt separately.</p>
<p>What happens next: one short email a month on how the build is going, then a login invite when RedPen Maths opens in January 2027.</p>
<p>Changed your mind? You can have a full refund any time before launch: just reply to this email. After launch there is a 14-day money-back guarantee.</p>
<p><a href="${esc(siteUrl)}/refunds">Refund policy</a> · RedPen Maths, by DefyScale</p>`,
  };
}

/** The monthly update, sent by hand. The body is written each month; this adds the footer. */
export function buildUpdateEmail(bodyHtml: string, unsubscribeUrl: string) {
  return {
    subject: 'RedPen Maths: this month’s build update',
    html: `${bodyHtml}
<hr><p style="font-size:12px;color:#5b6675">You're getting this because you joined the RedPen Maths waitlist or bought an early-bird pass. <a href="${esc(unsubscribeUrl)}">Unsubscribe</a>.</p>`,
  };
}
```

- [ ] **Step 4: Write `lib/waitlist/handler.ts`**

```ts
import { addToWaitlist, confirmWaitlist, BOARDS, type Board, type Query, type Role } from '@/lib/db';
import { waitlistConfirmEmail, type SendEmail } from '@/lib/email';
import type { HandlerResult } from '@/lib/http';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OK: HandlerResult = { status: 200, json: { ok: true, message: 'Check your inbox to confirm.' } };

export async function handleJoin(
  raw: unknown,
  ip: string,
  deps: { q: Query; send: SendEmail; verify: (token: unknown, ip: string) => Promise<boolean>; siteUrl: string; newToken: () => string },
): Promise<HandlerResult> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { status: 400, json: { error: 'Please enter a valid email address.' } };
  if (!(await deps.verify(b.token, ip))) return { status: 403, json: { error: 'Please retry.' } };
  const role: Role = b.role === 'student' ? 'student' : 'parent';
  const board: Board | null = BOARDS.includes(b.board as Board) ? (b.board as Board) : null;

  const r = await addToWaitlist(deps.q, { email, role, board, token: deps.newToken() });
  // Same reply whether new, repeated or already confirmed, so no one can probe who signed up.
  if (!r.confirmed) {
    const url = `${deps.siteUrl}/api/waitlist/confirm?token=${encodeURIComponent(r.token)}`;
    const m = waitlistConfirmEmail(url);
    await deps.send(email, m.subject, m.html);
  }
  return OK;
}

export async function handleConfirm(token: string | null, deps: { q: Query; siteUrl: string }): Promise<string> {
  const ok = token ? await confirmWaitlist(deps.q, token) : false;
  return `${deps.siteUrl}/?waitlist=${ok ? 'confirmed' : 'invalid'}#waitlist`;
}
```

- [ ] **Step 5: Run the tests.** `npm test`. Expected: PASS.

- [ ] **Step 6: Write the routes**

`app/api/waitlist/route.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { handleJoin } from '@/lib/waitlist/handler';
import { neonQuery } from '@/lib/db';
import { resendSender } from '@/lib/email';
import { verifyTurnstile } from '@/lib/guard/turnstile';
import { clientIp } from '@/lib/guard/ip';
import { toResponse } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const result = await handleJoin(await req.json().catch(() => null), clientIp(req.headers), {
      q: neonQuery(),
      send: resendSender(),
      verify: (t, ip) => verifyTurnstile(t, ip),
      siteUrl: process.env.SITE_URL ?? 'http://localhost:3000',
      newToken: () => randomBytes(24).toString('hex'),
    });
    return toResponse(result);
  } catch (e) {
    console.error('waitlist join failed', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
```

`app/api/waitlist/confirm/route.ts`:
```ts
import { handleConfirm } from '@/lib/waitlist/handler';
import { neonQuery } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  const to = await handleConfirm(token, { q: neonQuery(), siteUrl: process.env.SITE_URL ?? 'http://localhost:3000' });
  return Response.redirect(to, 303);
}
```

`app/api/waitlist/unsubscribe/route.ts`:
```ts
import { unsubscribeWaitlist, neonQuery } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  const ok = token ? await unsubscribeWaitlist(neonQuery(), token) : false;
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>RedPen Maths</title><body style="font-family:sans-serif;padding:24px"><p>${ok ? "You're unsubscribed. You won't get any more updates." : 'That link is not valid.'}</p><p><a href="/">RedPen Maths</a></p>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
```

How the monthly update is sent: export the confirmed, not-unsubscribed waitlist (`SELECT email, token FROM waitlist WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`) plus buyers' emails, and send each person `buildUpdateEmail(body, SITE_URL + '/api/waitlist/unsubscribe?token=' + token)` with a small one-off script at the time. Buyers who are not on the waitlist get transactional updates only. Writing that script is out of scope here.

- [ ] **Step 7: Run the tests and build.** `npm test && npm run build`. Expected: PASS and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add lib/email.ts lib/waitlist app/api/waitlist tests/waitlist.test.ts
git commit -m "Add double opt-in waitlist"
```

---

### Task 8: Paddle payments, webhook, passes-left and order status

Only start this task if `docs/decisions/paddle.md` says `VERDICT: PADDLE OK`. Where that document recorded a different JSON path from the ones used below, use the recorded path.

**Files:**
- Create: `lib/payments.ts`, `lib/orders/handler.ts`, `app/api/paddle/webhook/route.ts`, `app/api/passes-left/route.ts`, `app/api/order/route.ts`
- Test: `tests/payments.test.ts`

**Interfaces:**
- Consumes: `upsertCompletedOrder`, `markRefunded`, `getOrder`, `countActiveOrders`, `setOrderBoard`, `BOARDS`, `Board`, `Query` (Task 5); `HandlerResult` (Task 6); `config()` (Task 2).
- Produces:
  - `verifyPaddleSignature(rawBody: string, header: string | null, secret: string, nowSec: number, toleranceSec?: number): boolean`
  - `type PaddleEvent = { type: 'completed'; txnId: string; customerId: string; amountPence: number; currency: string; board: Board | null } | { type: 'refunded'; txnId: string } | { type: 'ignored' }`
  - `parsePaddleEvent(json: unknown): PaddleEvent`
  - `fetchCustomerEmail(customerId: string, o?: { apiKey?: string; env?: string; fetchImpl?: typeof fetch }): Promise<string>`
  - `handleWebhook(raw: string, sigHeader: string | null, deps: { q: Query; secret: string; nowSec: () => number; emailFor: (customerId: string) => Promise<string>; sendPurchase: (email: string) => Promise<void> }): Promise<HandlerResult>`. The purchase email goes out once per transaction, on the first `completed` event only.
  - `passesLeft(q: Query, cap: number): Promise<number>`
  - `handleGetOrder(txn: string | null, q: Query): Promise<HandlerResult>`, which returns 200 `{ status: 'completed' | 'refunded', board: Board | null }`, 202 `{ status: 'pending' }` or 400.
  - `handleSetBoard(body: unknown, q: Query): Promise<HandlerResult>`

- [ ] **Step 1: Write the failing test** in `tests/payments.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { freshDb } from './helpers/pglite';
import { verifyPaddleSignature, parsePaddleEvent } from '@/lib/payments';
import { handleWebhook, passesLeft, handleGetOrder, handleSetBoard } from '@/lib/orders/handler';
import { upsertCompletedOrder } from '@/lib/db';

const SECRET = 'pdl_ntfset_test';
const sign = (body: string, ts: number, secret = SECRET) => `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;
const completed = (id: string, board?: string) =>
  JSON.stringify({
    event_type: 'transaction.completed',
    data: { id, customer_id: 'ctm_1', currency_code: 'GBP', custom_data: board ? { board } : null, details: { totals: { grand_total: '4900' } } },
  });
const refund = (txn: string) =>
  JSON.stringify({ event_type: 'adjustment.updated', data: { action: 'refund', status: 'approved', transaction_id: txn } });

test('signature: valid, wrong secret, stale, malformed, missing', () => {
  const b = completed('txn_1');
  assert.equal(verifyPaddleSignature(b, sign(b, 1000), SECRET, 1010), true);
  assert.equal(verifyPaddleSignature(b, sign(b, 1000, 'other'), SECRET, 1010), false);
  assert.equal(verifyPaddleSignature(b, sign(b, 1000), SECRET, 1000 + 301), false);
  assert.equal(verifyPaddleSignature(b, 'garbage', SECRET, 1000), false);
  assert.equal(verifyPaddleSignature(b, null, SECRET, 1000), false);
  assert.equal(verifyPaddleSignature(b + ' ', sign(b, 1000), SECRET, 1000), false);
});

test('event parsing', () => {
  assert.deepEqual(parsePaddleEvent(JSON.parse(completed('txn_1', 'AQA'))), {
    type: 'completed', txnId: 'txn_1', customerId: 'ctm_1', amountPence: 4900, currency: 'GBP', board: 'AQA',
  });
  assert.equal((parsePaddleEvent(JSON.parse(completed('txn_1', 'Bogus'))) as { board: unknown }).board, null);
  assert.deepEqual(parsePaddleEvent(JSON.parse(refund('txn_1'))), { type: 'refunded', txnId: 'txn_1' });
  assert.deepEqual(parsePaddleEvent({ event_type: 'adjustment.updated', data: { action: 'credit', status: 'approved', transaction_id: 't' } }), { type: 'ignored' });
  assert.deepEqual(parsePaddleEvent({ event_type: 'customer.created', data: {} }), { type: 'ignored' });
});

async function hook() {
  const q = await freshDb();
  const mails: string[] = [];
  const deps = { q, secret: SECRET, nowSec: () => 1000, emailFor: async () => 'parent@example.com', sendPurchase: async (e: string) => void mails.push(e) };
  const send = (b: string) => handleWebhook(b, sign(b, 1000), deps);
  return { q, deps, send, mails };
}

test('webhook: the purchase email is sent once, even when Paddle repeats the event', async () => {
  const { send, mails } = await hook();
  await send(completed('txn_m'));
  await send(completed('txn_m'));
  assert.deepEqual(mails, ['parent@example.com']);
});

test('webhook: a failed purchase email does not fail the webhook', async () => {
  const { deps } = await hook();
  const b = completed('txn_f');
  const r = await handleWebhook(b, sign(b, 1000), { ...deps, sendPurchase: async () => { throw new Error('resend down'); } });
  assert.equal(r.status, 200);
});

test('webhook: bad signature 401, completed recorded, repeat harmless, refund returns pass', async () => {
  const { q, deps, send } = await hook();
  assert.equal((await handleWebhook(completed('txn_1'), 'ts=1;h1=00', deps)).status, 401);
  assert.equal((await send(completed('txn_1'))).status, 200);
  assert.equal((await send(completed('txn_1'))).status, 200);
  assert.equal(await passesLeft(q, 200), 199);
  assert.equal((await send(refund('txn_1'))).status, 200);
  assert.equal(await passesLeft(q, 200), 200);
});

test('webhook: unknown events are acknowledged and ignored', async () => {
  const { send } = await hook();
  const b = JSON.stringify({ event_type: 'customer.updated', data: {} });
  assert.equal((await send(b)).status, 200);
});

test('webhook: a database failure returns 500 so Paddle retries', async () => {
  const { deps } = await hook();
  const b = completed('txn_9');
  const broken = { ...deps, q: async () => { throw new Error('db down'); } };
  assert.equal((await handleWebhook(b, sign(b, 1000), broken)).status, 500);
});

test('records orders beyond the cap and clamps passes-left at 0', async () => {
  const q = await freshDb();
  for (let i = 0; i < 3; i++) await upsertCompletedOrder(q, { txnId: `t${i}`, email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  assert.equal(await passesLeft(q, 2), 0);
  const [r] = await q('SELECT count(*)::int AS n FROM orders');
  assert.equal(r.n, 3);
});

test('returns 202 pending for an unknown transaction', async () => {
  const q = await freshDb();
  assert.equal((await handleGetOrder('txn_new', q)).status, 202);
  assert.equal((await handleGetOrder(null, q)).status, 400);
  await upsertCompletedOrder(q, { txnId: 'txn_new', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  const r = await handleGetOrder('txn_new', q);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: 'completed', board: null });
});

test('board can be set after purchase, once', async () => {
  const q = await freshDb();
  await upsertCompletedOrder(q, { txnId: 'txn_b', email: 'p@x.com', board: null, amountPence: 4900, currency: 'GBP' });
  assert.equal((await handleSetBoard({ txnId: 'txn_b', board: 'OCR' }, q)).status, 200);
  assert.equal((await handleSetBoard({ txnId: 'txn_b', board: 'AQA' }, q)).status, 409);
  assert.equal((await handleSetBoard({ txnId: 'txn_b', board: 'Nope' }, q)).status, 400);
});
```

- [ ] **Step 2: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/lib/payments'".

- [ ] **Step 3: Write `lib/payments.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BOARDS, type Board } from '@/lib/db';

// The only file that knows it is Paddle. A switch to Lemon Squeezy replaces this
// file and the webhook route (see docs/decisions/paddle.md).

export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(';').map((p) => p.split('=') as [string, string]));
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!Number.isFinite(ts) || !h1 || Math.abs(nowSec - ts) > toleranceSec) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex'));
  const got = Buffer.from(h1);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type PaddleEvent =
  | { type: 'completed'; txnId: string; customerId: string; amountPence: number; currency: string; board: Board | null }
  | { type: 'refunded'; txnId: string }
  | { type: 'ignored' };

export function parsePaddleEvent(json: unknown): PaddleEvent {
  const e = (json ?? {}) as { event_type?: string; data?: Record<string, any> };
  const d = e.data ?? {};
  if (e.event_type === 'transaction.completed' && typeof d.id === 'string') {
    const board = BOARDS.includes(d.custom_data?.board) ? (d.custom_data.board as Board) : null;
    return {
      type: 'completed',
      txnId: d.id,
      customerId: String(d.customer_id ?? ''),
      amountPence: Number(d.details?.totals?.grand_total ?? 0),
      currency: String(d.currency_code ?? 'GBP'),
      board,
    };
  }
  if ((e.event_type === 'adjustment.created' || e.event_type === 'adjustment.updated') && d.action === 'refund' && d.status === 'approved' && typeof d.transaction_id === 'string') {
    return { type: 'refunded', txnId: d.transaction_id };
  }
  return { type: 'ignored' };
}

export async function fetchCustomerEmail(
  customerId: string,
  o: { apiKey?: string; env?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  if (!customerId) return '';
  const env = o.env ?? process.env.PADDLE_ENV ?? 'sandbox';
  const base = env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  const r = await (o.fetchImpl ?? fetch)(`${base}/customers/${encodeURIComponent(customerId)}`, {
    headers: { Authorization: `Bearer ${o.apiKey ?? process.env.PADDLE_API_KEY}` },
  });
  if (!r.ok) throw new Error(`paddle customer lookup ${r.status}`);
  const j = (await r.json()) as { data?: { email?: string } };
  return j.data?.email ?? '';
}
```

- [ ] **Step 4: Write `lib/orders/handler.ts`**

```ts
import { countActiveOrders, getOrder, markRefunded, setOrderBoard, upsertCompletedOrder, BOARDS, type Board, type Query } from '@/lib/db';
import { parsePaddleEvent, verifyPaddleSignature } from '@/lib/payments';
import type { HandlerResult } from '@/lib/http';

export async function handleWebhook(
  raw: string,
  sigHeader: string | null,
  deps: { q: Query; secret: string; nowSec: () => number; emailFor: (customerId: string) => Promise<string>; sendPurchase: (email: string) => Promise<void> },
): Promise<HandlerResult> {
  if (!verifyPaddleSignature(raw, sigHeader, deps.secret, deps.nowSec())) return { status: 401, json: { error: 'bad signature' } };
  let ev;
  try {
    ev = parsePaddleEvent(JSON.parse(raw));
  } catch {
    return { status: 400, json: { error: 'bad json' } };
  }
  try {
    if (ev.type === 'completed') {
      const before = await getOrder(deps.q, ev.txnId);
      const email = await deps.emailFor(ev.customerId);
      await upsertCompletedOrder(deps.q, { txnId: ev.txnId, email, board: ev.board, amountPence: ev.amountPence, currency: ev.currency });
      // First sighting only: Paddle retries and repeats events.
      if (!before && email) await deps.sendPurchase(email).catch((e) => console.error('purchase email failed', e instanceof Error ? e.message : e));
    } else if (ev.type === 'refunded') {
      await markRefunded(deps.q, ev.txnId);
    }
    return { status: 200, json: { ok: true } };
  } catch (e) {
    console.error('webhook failed', e instanceof Error ? e.message : e);
    return { status: 500, json: { error: 'retry' } }; // Paddle retries non-2xx
  }
}

/** Never negative: a race on the last pass records both orders and shows 0. */
export async function passesLeft(q: Query, cap: number): Promise<number> {
  return Math.max(0, cap - (await countActiveOrders(q)));
}

export async function handleGetOrder(txn: string | null, q: Query): Promise<HandlerResult> {
  if (!txn || !/^[A-Za-z0-9_]{3,80}$/.test(txn)) return { status: 400, json: { error: 'bad id' } };
  const o = await getOrder(q, txn);
  // The buyer can land here before Paddle's webhook does: say pending, not "not found".
  if (!o) return { status: 202, json: { status: 'pending' } };
  return { status: 200, json: { status: o.status, board: o.board } };
}

export async function handleSetBoard(raw: unknown, q: Query): Promise<HandlerResult> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as { txnId?: unknown; board?: unknown };
  if (typeof b.txnId !== 'string' || !BOARDS.includes(b.board as Board)) return { status: 400, json: { error: 'bad request' } };
  const ok = await setOrderBoard(q, b.txnId, b.board as Board);
  return ok ? { status: 200, json: { ok: true } } : { status: 409, json: { error: 'already set or unknown order' } };
}
```

- [ ] **Step 5: Run the tests.** `npm test`. Expected: PASS.

- [ ] **Step 6: Write the routes**

`app/api/paddle/webhook/route.ts`:
```ts
import { handleWebhook } from '@/lib/orders/handler';
import { fetchCustomerEmail } from '@/lib/payments';
import { neonQuery } from '@/lib/db';
import { purchaseEmail, resendSender } from '@/lib/email';
import { toResponse } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const raw = await req.text(); // raw body: the signature covers the exact bytes
  const result = await handleWebhook(raw, req.headers.get('paddle-signature'), {
    q: neonQuery(),
    secret: process.env.PADDLE_WEBHOOK_SECRET ?? '',
    nowSec: () => Math.floor(Date.now() / 1000),
    emailFor: (id) => fetchCustomerEmail(id),
    sendPurchase: async (email) => {
      const m = purchaseEmail(process.env.SITE_URL ?? 'https://redpenmaths.com');
      await resendSender()(email, m.subject, m.html);
    },
  });
  return toResponse(result);
}
```

`app/api/passes-left/route.ts`:
```ts
import { passesLeft } from '@/lib/orders/handler';
import { neonQuery } from '@/lib/db';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cap = config().passCap;
    return Response.json({ left: await passesLeft(neonQuery(), cap), cap }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ left: null }, { status: 503 });
  }
}
```

`app/api/order/route.ts`:
```ts
import { handleGetOrder, handleSetBoard } from '@/lib/orders/handler';
import { neonQuery } from '@/lib/db';
import { toResponse } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return toResponse(await handleGetOrder(new URL(req.url).searchParams.get('txn'), neonQuery()));
}
export async function POST(req: Request) {
  return toResponse(await handleSetBoard(await req.json().catch(() => null), neonQuery()));
}
```

- [ ] **Step 7: Run the tests and build.** `npm test && npm run build`. Expected: PASS and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add lib/payments.ts lib/orders app/api/paddle app/api/passes-left app/api/order tests/payments.test.ts
git commit -m "Add Paddle webhook, pass cap and order status"
```

---

### Task 9: Scripted hero demo

**Files:**
- Modify: `lib/ink.ts` (add an optional ink colour)
- Create: `content/hero-script.ts`, `components/HeroDemo.tsx`, `scripts/make-hero-audio.mjs`, `public/audio/hero.mp3` (generated)
- Test: `tests/hero-script.test.ts`

**Interfaces:**
- Consumes: `drawInk`, `renderInk`, `INK`, `measureWritten`, `emFor`, `Measure` (`lib/ink.ts`); `PAGE_BG`, `PEN` (`lib/page.ts`); `validAnnotation` (Task 3).
- Produces:
  - `renderInk(ctx, annotations, color?: string)`
  - `drawInk(ctx, annotations, onDone?, color?: string)`
  - `HERO_STUDENT: Annotation[]`
  - `HERO_SPEECH: string`
  - `buildHeroMarks(measure: Measure): Annotation[]`
  - `<HeroDemo />`, a self-contained 900×620 page that loops, with a mute button, and which respects `prefers-reduced-motion`.

- [ ] **Step 1: Add an optional colour to `lib/ink.ts`**
  - Change `drawStrokePartial(ctx, pts, width, upTo)` to `drawStrokePartial(ctx, pts, width, upTo, color: string)`, and use `ctx.strokeStyle = color`.
  - Change `drawReveal(ctx, it, fraction)` to `drawReveal(ctx, it, fraction, color: string)`, and use `ctx.fillStyle = color`.
  - Change `drawItem(ctx, it, progress)` to `drawItem(ctx, it, progress, color: string)`, passing `color` through.
  - Change `renderInk(ctx, annotations)` to `renderInk(ctx, annotations, color = INK)`.
  - Change `drawInk(ctx, annotations, onDone?)` to `drawInk(ctx, annotations, onDone?, color = INK)`, and pass `color` to every `drawItem` call.

  Existing callers keep red ink, because the default is `INK`.

- [ ] **Step 2: Write the failing test** in `tests/hero-script.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_STUDENT, HERO_SPEECH, buildHeroMarks } from '@/content/hero-script';
import { validAnnotation } from '@/lib/mark/schema';

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
  assert.ok(fix.kind === 'write' && fix.y < line2.y && fix.text === '−6');
});

test('hero speech asks, and never gives the result away', () => {
  assert.match(HERO_SPEECH, /\?$/);
  assert.doesNotMatch(HERO_SPEECH, /11/);
});
```

- [ ] **Step 3: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/content/hero-script'".

- [ ] **Step 4: Write `content/hero-script.ts`**

```ts
import type { Annotation } from '@/lib/types';
import { emFor, measureWritten, type Measure } from '@/lib/ink';

// The scripted demo at the top of the page. It costs nothing, looks the same
// every time, and is what an ad visitor sees first. The student's lines are
// drawn with the tutor's own single-stroke glyphs in the student's navy pen.

const X = 90;
export const HERO_STUDENT: Annotation[] = [
  { kind: 'write', x: X, y: 170, text: '3(x − 2) = 2x + 5', size: 'big' },
  { kind: 'write', x: X, y: 300, text: '3x − 2 = 2x + 5', size: 'big' },
  { kind: 'write', x: X, y: 430, text: 'x = 7', size: 'big' },
];

export const HERO_SPEECH = 'You expanded the bracket to 3x minus 2. What should 3 times minus 2 be?';

/** Positions the strike on "− 2" of line 2 by measuring the student's own text. */
export function buildHeroMarks(measure: Measure): Annotation[] {
  const em = emFor('big');
  const line2 = HERO_STUDENT[1] as Extract<Annotation, { kind: 'write' }>;
  const x0 = line2.x + measureWritten('3x ', em, measure);
  const x1 = line2.x + measureWritten('3x − 2', em, measure);
  // STRIKE_DY: offset from the write baseline to the middle of the glyphs.
  // Checked visually in Step 7; adjust only this constant.
  const STRIKE_DY = -20;
  const y = line2.y + STRIKE_DY;
  return [
    { kind: 'strike', x1: x0 - 6, y1: y + 4, x2: x1 + 8, y2: y - 4 },
    { kind: 'write', x: x0 + 4, y: line2.y - 62, text: '−6', size: 'big' },
    { kind: 'circle', x: X + 90, y: 412, rx: 110, ry: 44 },
  ];
}
```

- [ ] **Step 5: Run the tests.** `npm test`. Expected: PASS.

- [ ] **Step 6: Write `components/HeroDemo.tsx`.** It uses two stacked canvases, as the POC does: the student's navy work underneath and the red pen on top. `drawInk` clears its own canvas every frame, so each layer needs its own canvas.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { drawInk, renderInk, type Measure } from '@/lib/ink';
import { PAGE_BG, PEN } from '@/lib/page';
import { HERO_STUDENT, buildHeroMarks } from '@/content/hero-script';

const W = 900;
const H = 620;

function setup(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr;
  c.height = H * dpr;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export default function HeroDemo({ note }: { note?: string }) {
  const studentRef = useRef<HTMLCanvasElement>(null);
  const penRef = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(true); // browsers block sound on autoplay; the visitor opts in

  useEffect(() => {
    const student = setup(studentRef.current!);
    const pen = setup(penRef.current!);
    const measure: Measure = (t, f) => ((pen.font = f), pen.measureText(t).width);
    const marks = buildHeroMarks(measure);
    const wipe = (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      renderInk(student, HERO_STUDENT, PEN);
      renderInk(pen, marks);
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const cancels: ((finish?: boolean) => void)[] = [];
    const loop = () => {
      if (!alive) return;
      wipe(student);
      wipe(pen);
      cancels.push(
        drawInk(student, HERO_STUDENT, () => {
          timer = setTimeout(() => {
            if (!alive) return;
            if (audio.current && !audio.current.muted) {
              audio.current.currentTime = 0;
              void audio.current.play().catch(() => {});
            }
            cancels.push(drawInk(pen, marks, () => (timer = setTimeout(loop, 6000))));
          }, 900);
        }, PEN),
      );
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
      cancels.forEach((c) => c(false));
      audio.current?.pause();
    };
  }, []);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    a.muted = !muted;
    setMuted(!muted);
  };

  return (
    <figure className="hero-demo">
      <div className="sheet" role="img" aria-label="A student's working for 3(x − 2) = 2x + 5, marked in red: the −2 is crossed out and −6 written above it.">
        <canvas ref={studentRef} />
        <canvas ref={penRef} className="overlay" />
      </div>
      <audio ref={audio} src="/audio/hero.mp3" preload="none" muted />
      <figcaption>
        <span>{note ?? '“You expanded the bracket to 3x − 2. What should 3 × −2 be?”'}</span>
        <button type="button" onClick={toggle} aria-pressed={!muted}>{muted ? 'Hear it' : 'Mute'}</button>
      </figcaption>
    </figure>
  );
}
```

The `.sheet` styles (paper background, stacked absolute canvases) arrive in Task 10 Step 3. Until then, add `style={{ position: 'relative', aspectRatio: '900 / 620', background: PAGE_BG }}` to the `.sheet` div temporarily for the Step 7 visual check, and delete it in Task 10.

- [ ] **Step 7: Generate the audio and check the hero visually**

`scripts/make-hero-audio.mjs`:
```js
// One-off: renders the hero line to public/audio/hero.mp3 with OpenAI TTS.
import { writeFileSync } from 'node:fs';

const text = 'You expanded the bracket to 3x minus 2. What should 3 times minus 2 be?';
const r = await fetch('https://api.openai.com/v1/audio/speech', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o-mini-tts', voice: 'sage', input: text, response_format: 'mp3',
    instructions: 'A patient British maths tutor, warm and unhurried, gently asking a question.',
  }),
});
if (!r.ok) throw new Error(`TTS ${r.status}: ${await r.text()}`);
writeFileSync('public/audio/hero.mp3', Buffer.from(await r.arrayBuffer()));
console.log('wrote public/audio/hero.mp3');
```

Run `OPENAI_API_KEY=... npm run hero-audio`. Expected: `wrote public/audio/hero.mp3`. Keep the key out of shell history: prefer `set -a; source .env.local; set +a` first.

Put `<HeroDemo />` temporarily into `app/page.tsx`, run `npm run dev` and screenshot it at 1440×900 and 390×844. The red strike must sit across "− 2" on line 2 and "−6" must sit above it. If not, adjust `STRIKE_DY` only, re-run `npm test`, and re-check.

- [ ] **Step 8: Commit**

```bash
git add lib/ink.ts content/hero-script.ts components/HeroDemo.tsx scripts/make-hero-audio.mjs public/audio/hero.mp3 tests/hero-script.test.ts app/page.tsx
git commit -m "Add scripted red-pen hero demo"
```

---

### Task 10: Live "Try it yourself" demo

**Files:**
- Create: `components/useSession.ts`, `components/TryIt.tsx`
- Modify: `app/globals.css` (demo styles)

**Interfaces:**
- Consumes:
  - `POST /api/session { token }` sets the cookie.
  - `POST /api/mark` takes `{ dataUrl, space, questionId, question?, prior, transcript, layout }` and returns `TutorReply`, 429 `{ reason }` or another error.
  - `Page`, `PEN`, `PEN_WIDTH` (`lib/page.ts`); `drawInk` (`lib/ink.ts`); `computeLayout`, `resolveMarks`, `writtenLines` (`lib/layout.ts`); `speak`, `speakAsync`, `prefetchSpeech`, `stopSpeaking`, `setMuted`, `warmVoices` (`lib/speech.ts`); `DEMO_QUESTIONS` (Task 3); `<HeroDemo />` (Task 9).
- Produces:
  - `useSession(): { ready: boolean; failed: boolean }`, which renders nothing and puts an invisible Turnstile widget into `document.body`.
  - `<TryIt />`

- [ ] **Step 1: Write `components/useSession.ts`**

```ts
'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string };
  }
}

/** Proves the visitor is human once (Turnstile) and exchanges that for a 24 h session cookie. */
export function useSession() {
  const [state, setState] = useState({ ready: false, failed: false });
  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const exchange = (token: string) =>
      fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
        .then((r) => setState({ ready: r.ok, failed: !r.ok }))
        .catch(() => setState({ ready: false, failed: true }));
    if (!siteKey) {
      void exchange(''); // local dev: the server allows an empty token without a secret
      return;
    }
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.bottom = '8px';
    el.style.right = '8px';
    document.body.appendChild(el);
    const render = () =>
      window.turnstile?.render(el, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (t: string) => void exchange(t),
        'error-callback': () => setState({ ready: false, failed: true }),
      });
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      s.onerror = () => setState({ ready: false, failed: true });
      document.head.appendChild(s);
    }
    return () => el.remove();
  }, []);
  return state;
}
```

- [ ] **Step 2: Write `components/TryIt.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, LessonStep, TranscriptLine, TutorReply } from '@/lib/types';
import { drawInk, type Measure } from '@/lib/ink';
import { computeLayout, resolveMarks, writtenLines } from '@/lib/layout';
import { Page, PEN, PEN_WIDTH, type StudentStroke } from '@/lib/page';
import { prefetchSpeech, setMuted, speak, speakAsync, stopSpeaking, warmVoices } from '@/lib/speech';
import { DEMO_QUESTIONS, type DemoQuestion } from '@/content/demo-questions';
import HeroDemo from './HeroDemo';
import { useSession } from './useSession';

const W = 900;
const H = 620;
const IDLE_MS = 2500;
type Status = 'ready' | 'watching' | 'thinking' | 'marking' | 'correct' | 'error';

function setupCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export default function TryIt() {
  const session = useSession();
  const pageRef = useRef<Page>(new Page(W, H));
  const page = pageRef.current;
  const inkRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<StudentStroke | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSig = useRef('');
  const busy = useRef(false);
  const cancelInk = useRef<((finish?: boolean) => void) | null>(null);
  const pending = useRef<Annotation[] | null>(null);
  const drawDone = useRef<(() => void) | null>(null);
  const transcript = useRef<TranscriptLine[]>([]);

  const [q, setQ] = useState<DemoQuestion>(DEMO_QUESTIONS[0]);
  const [status, setStatus] = useState<Status>('ready');
  const [message, setMessage] = useState('Write your working on the page, then pause.');
  const [canTeach, setCanTeach] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);

  const measure: Measure = useCallback((t, f) => {
    const ctx = overlayRef.current!.getContext('2d')!;
    ctx.font = f;
    return ctx.measureText(t).width;
  }, []);

  const repaint = useCallback(() => page.render(inkRef.current!.getContext('2d')!), [page]);

  const clearOverlay = useCallback(() => {
    const c = overlayRef.current!;
    const ctx = c.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
  }, []);

  const commit = useCallback(() => {
    const m = pending.current;
    pending.current = null;
    cancelInk.current = null;
    if (m?.length) page.push({ kind: 'tutor', annotations: m });
    repaint();
    clearOverlay();
    lastSig.current = page.signature();
    drawDone.current?.();
    drawDone.current = null;
  }, [page, repaint, clearOverlay]);

  const finish = useCallback(() => cancelInk.current?.(true), []);

  const animate = useCallback(
    (marks: Annotation[]) =>
      new Promise<void>((resolve) => {
        if (!marks.length) return resolve();
        finish();
        pending.current = marks;
        drawDone.current = resolve;
        cancelInk.current = drawInk(overlayRef.current!.getContext('2d')!, marks, commit);
      }),
    [finish, commit],
  );

  const capture = useCallback(() => {
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d')!;
    page.render(ctx);
    ctx.strokeStyle = 'rgba(90,120,200,0.35)';
    ctx.fillStyle = 'rgba(60,90,170,0.7)';
    ctx.font = '11px monospace';
    ctx.lineWidth = 1;
    for (let x = 100; x < W; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 14); ctx.stroke(); ctx.fillText(String(x), x + 2, 12);
    }
    for (let y = 100; y < H; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(14, y); ctx.stroke(); ctx.fillText(String(y), 2, y - 3);
    }
    return out.toDataURL('image/png');
  }, [page]);

  const call = useCallback(
    async (question?: string) => {
      if (busy.current || !session.ready) return;
      busy.current = true;
      setStatus('thinking');
      setMessage(question ? 'Planning the explanation…' : 'Checking your working…');
      const sig = page.signature();
      try {
        const res = await fetch('/api/mark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataUrl: capture(), space: { width: W, height: H }, questionId: q.id,
            question, prior: page.tutorMarks(), transcript: transcript.current, layout: computeLayout(page, measure),
          }),
        });
        if (res.status === 429) {
          const j = (await res.json().catch(() => ({}))) as { reason?: string };
          setFallback(j.reason === 'rate' ? "You've used today's free checks. Here's how it marks:" : "The live demo is busy. Here's how it marks:");
          return;
        }
        if (!res.ok) {
          setStatus('error');
          setMessage('The tutor could not look that time. Pause again to retry.');
          return;
        }
        const reply = (await res.json()) as TutorReply;
        if (reply.steps?.length) {
          await playLesson(reply.steps);
          return;
        }
        const marks = resolveMarks(reply.annotations, writtenLines(page.tutorMarks()), computeLayout(page, measure), W, measure);
        if (!reply.worthResponding || (!reply.speech && !marks.length)) {
          setStatus('watching');
          setMessage('Keep going. I will look when you pause.');
          return;
        }
        if (reply.speech) transcript.current = [...transcript.current, { who: 'tutor' as const, text: reply.speech }].slice(-8);
        setMessage(reply.speech || (reply.correct ? 'That working is right.' : ''));
        setCanTeach(!reply.correct && marks.length > 0);
        if (marks.length) {
          setStatus('marking');
          if (reply.speech) speak(reply.speech);
          await animate(marks);
          setStatus('watching');
        } else setStatus(reply.correct ? 'correct' : 'watching');
      } catch {
        setStatus('error');
        setMessage('Connection problem. Pause again to retry.');
      } finally {
        busy.current = false;
        if (page.signature() !== sig) schedule();
      }
    },
    // playLesson and schedule are stable function declarations below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.ready, page, q, capture, measure, animate],
  );

  async function playLesson(steps: LessonStep[]) {
    setStatus('marking');
    setCanTeach(false);
    const layout = computeLayout(page, measure);
    for (const [i, st] of steps.entries()) {
      setMessage(st.say);
      const write = resolveMarks(st.write, writtenLines(page.tutorMarks()), layout, W, measure);
      if (steps[i + 1]?.say) prefetchSpeech(steps[i + 1].say);
      await Promise.all([speakAsync(st.say), animate(write)]);
      await new Promise((r) => setTimeout(r, 350));
    }
    setStatus('watching');
  }

  function schedule() {
    if (idle.current) clearTimeout(idle.current);
    setStatus((s) => (s === 'thinking' || s === 'marking' ? s : 'watching'));
    idle.current = setTimeout(() => {
      const sig = page.signature();
      // Not ready yet: leave lastSig alone so this work is checked once the session arrives.
      if (!session.ready || sig === lastSig.current || !page.studentWorkSinceLastMark()) return;
      lastSig.current = sig;
      void call();
    }, IDLE_MS);
  }

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = inkRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stopSpeaking();
    finish();
    if (idle.current) clearTimeout(idle.current);
    const p = pos(e);
    live.current = { kind: 'stroke', pts: [p], width: PEN_WIDTH, color: PEN };
    const ctx = inkRef.current!.getContext('2d')!;
    ctx.strokeStyle = PEN; ctx.lineWidth = PEN_WIDTH; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + 0.01, p[1]); ctx.stroke();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = live.current;
    if (!s) return;
    const p = pos(e);
    const prev = s.pts[s.pts.length - 1];
    s.pts.push(p);
    const ctx = inkRef.current!.getContext('2d')!;
    ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
  };
  const onUp = () => {
    const s = live.current;
    if (!s) return;
    live.current = null;
    page.push(s);
    schedule();
  };

  const reset = (next?: DemoQuestion) => {
    finish();
    stopSpeaking();
    if (idle.current) clearTimeout(idle.current);
    page.clear();
    transcript.current = [];
    lastSig.current = '';
    repaint();
    setCanTeach(false);
    setStatus('ready');
    setMessage('Write your working on the page, then pause.');
    if (next) setQ(next);
  };
  const undo = () => {
    finish();
    page.pop();
    repaint();
    lastSig.current = page.signature();
  };

  useEffect(() => {
    setupCanvas(inkRef.current!);
    setupCanvas(overlayRef.current!);
    repaint();
    warmVoices();
    return () => {
      cancelInk.current?.(false);
      stopSpeaking();
    };
  }, [repaint]);

  if (fallback || session.failed) return <HeroDemo note={fallback ?? "The live demo isn't available right now. Here's how it marks:"} />;

  return (
    <div className="tryit">
      <div className="tabs" role="tablist" aria-label="Pick a question">
        {DEMO_QUESTIONS.map((d) => (
          <button key={d.id} role="tab" aria-selected={d.id === q.id} onClick={() => reset(d)}>{d.topic}</button>
        ))}
      </div>
      <p className="question">{q.text}</p>
      <div className={`sheet${status === 'thinking' ? ' thinking' : ''}`}>
        <canvas ref={inkRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label="Your page. Write your working here." />
        <canvas ref={overlayRef} className="overlay" aria-hidden="true" />
      </div>
      <div className="demo-bar">
        <p className="demo-msg" role="status" aria-live="polite" data-status={status}>{session.ready ? message : 'Getting the tutor ready…'}</p>
        <div className="demo-actions">
          {canTeach && <button className="primary" onClick={() => void call('Teach me this step: explain the step you marked, then let me try it again.')}>Teach me this step</button>}
          <button onClick={undo}>Undo</button>
          <button onClick={() => reset()}>Clear</button>
          <button onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-pressed={muted}>{muted ? 'Voice off' : 'Voice on'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the demo styles** to `app/globals.css`

```css
.tryit .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.tryit .tabs button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 8px 14px; font: inherit; cursor: pointer; }
.tryit .tabs button[aria-selected='true'] { background: var(--ink); color: #fff; border-color: var(--ink); }
.tryit .question { font-weight: 600; margin: 6px 0 10px; }
.sheet { position: relative; width: 100%; aspect-ratio: 900 / 620; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.sheet canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
.sheet canvas.overlay { pointer-events: none; }
.sheet.thinking { box-shadow: 0 0 0 3px rgba(242, 153, 74, 0.35); }
.demo-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-top: 10px; }
.demo-msg { margin: 0; flex: 1 1 260px; min-height: 1.4em; }
.demo-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.demo-actions button, .hero-demo figcaption button { border: 1px solid var(--line); background: #fff; border-radius: 10px; padding: 8px 12px; font: inherit; cursor: pointer; }
.demo-actions button.primary { background: var(--red); color: #fff; border-color: var(--red); }
.hero-demo { margin: 0; }
.hero-demo figcaption { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-top: 8px; color: var(--muted); font-style: italic; }
```

`touch-action: none` on the canvases stops a finger stroke from scrolling the page (Review Focus 5).

Also delete the temporary inline `style` on `HeroDemo`'s `.sheet` div from Task 9, because these rules now cover it.

- [ ] **Step 4: Check in the browser.** Put `<TryIt />` temporarily into `app/page.tsx`, then run `npm run build` (it must succeed) and `npm run dev` with `ANTHROPIC_API_KEY` set. In Chrome at 1440×900 and in iPhone emulation:
  1. Write `3x − 2 = 2x + 5` under the algebra question and pause. A red strike and a spoken question should appear.
  2. Press **Teach me this step**. A multi-step lesson should play.
  3. Switch tabs. The page clears and the new question shows.

  Any failure is a bug to fix in this task.

- [ ] **Step 5: Run the tests.** `npm test`. Expected: PASS (nothing in the existing tests changed).

- [ ] **Step 6: Commit**

```bash
git add components/useSession.ts components/TryIt.tsx app/globals.css app/page.tsx
git commit -m "Add live try-it demo with Turnstile session and scripted fallback"
```

---

### Task 11: Landing page, checkout button, waitlist form, thanks and legal pages

**Files:**
- Create: `content/copy.ts`, `components/BuyButton.tsx`, `components/WaitlistForm.tsx`, `components/Faq.tsx`, `components/ParentReport.tsx`, `app/thanks/page.tsx`, `app/refunds/page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`
- Modify: `app/page.tsx` (full landing page), `app/globals.css` (section styles)
- Test: `tests/copy.test.ts`

**Interfaces:**
- Consumes:
  - `GET /api/passes-left` returns `{ left: number | null; cap: number }`.
  - `POST /api/waitlist` takes `{ email, role, board, token }`.
  - `GET /api/order?txn=` returns 200, 202 or 400. `POST /api/order` takes `{ txnId, board }`.
  - `useSession` is not needed here. The waitlist gets its own Turnstile token from a second invisible widget, rendered the same way as in `useSession`.
- Produces:
  - `COPY` (all visible marketing text)
  - `<BuyButton />`, which opens Paddle checkout and redirects to `/thanks?txn=<id>` on `checkout.completed`
  - `<WaitlistForm />`

- [ ] **Step 1: Write the failing copy test** in `tests/copy.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { COPY } from '@/content/copy';
import { DEMO_QUESTIONS } from '@/content/demo-questions';
import { HERO_SPEECH } from '@/content/hero-script';

const BANNED = /\bsolv(e|es|ed|ing|er)\b|\banswers?\b|homework done/i;

test('landing copy, demo questions and hero speech avoid banned words', () => {
  const all = JSON.stringify(COPY) + JSON.stringify(DEMO_QUESTIONS) + HERO_SPEECH;
  const hit = BANNED.exec(all);
  assert.equal(hit, null, `banned word: ${hit?.[0]}`);
});

test('page and component source avoids banned words in visible text', () => {
  const files = [
    ...readdirSync('app', { recursive: true }).map((f) => `app/${f}`),
    ...readdirSync('components').map((f) => `components/${f}`),
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

test('prices match the spec', () => {
  assert.equal(COPY.pricing.price, '£49');
  assert.equal(COPY.pricing.fullPrice, '£79');
});
```

- [ ] **Step 2: Run the tests.** `npm test`. Expected: FAIL with "Cannot find module '@/content/copy'".

- [ ] **Step 3: Write `content/copy.ts`**

```ts
// Every word of marketing copy lives here so tests/copy.test.ts can police it.
// Rules: never "solve", "answers" or "homework done"; no accuracy numbers until
// measured; nothing that isn't true on the day it is published.

export const COPY = {
  brand: 'RedPen Maths',
  hero: {
    title: "Marks your child's maths working like an examiner, then teaches the fix.",
    sub: 'For GCSE maths: your child writes their working, RedPen shows exactly which line lost the mark and explains the step out loud, the way a good teacher would.',
    buy: 'Get the early-bird pass',
    try: 'Try it yourself',
  },
  tryIt: {
    title: 'Try it: write your working and pause',
    sub: 'Pick a question, write your steps with a finger or mouse, and stop for a moment. Nothing you write is saved.',
  },
  how: {
    title: 'How it works',
    steps: [
      { t: 'Practise a real GCSE-style question', d: 'Questions across the full GCSE maths specification, Foundation and Higher.' },
      { t: 'See exactly which line lost the mark', d: 'The red pen marks the first step that went wrong, not just the final line.' },
      { t: 'Fix it with a spoken re-teach', d: 'It explains that step out loud with diagrams, then gives a similar question to try.' },
    ],
  },
  report: {
    title: 'A weekly report for you',
    sub: 'See where marks are being lost, by topic, without having to check the work yourself.',
    label: 'Preview: the report is being built now.',
  },
  trust: {
    title: 'Built properly',
    points: [
      'Covers the full GCSE maths specification for AQA, Edexcel and OCR.',
      'Built with a GCSE maths examiner. We will publish how often RedPen agrees with the examiner before launch.',
      'Your child’s work is never sold or used for advertising.',
    ],
  },
  pricing: {
    title: 'Early-bird Season Pass 2027',
    price: '£49',
    fullPrice: '£79',
    period: 'January to June 2027: the run-up to the summer GCSE exams',
    cap: 'Limited to the first 200 families.',
    refund: 'Full refund any time before launch, and a 14-day money-back guarantee after.',
    parentOnly: "I'm the parent or guardian and I'm 18 or over",
    soldOut: 'Early-bird passes have gone. Join the waitlist for launch pricing.',
  },
  faq: [
    { q: 'Is this cheating?', a: 'No. RedPen only works on practice questions, marks the working your child has already written, and never writes the final result for them. It is built for learning, not for coursework or homework hand-ins.' },
    { q: 'Which exam boards and tiers?', a: 'GCSE maths for AQA, Edexcel and OCR, at Foundation and Higher tier. The topics are shared across boards, and questions are tagged by tier.' },
    { q: 'When does it open?', a: 'January 2027. Early-bird families get access first and a short email each month on how the build is going.' },
    { q: 'Can I get a refund?', a: 'Yes. Email us any time before launch for a full refund. After launch there is a 14-day money-back guarantee.' },
    { q: "What happens to my child's data?", a: 'On this page, nothing a student writes is stored. When the product opens, work is kept only to produce your reports, never sold, and you can delete it at any time.' },
  ],
  waitlist: {
    title: 'Not ready yet? Join the waitlist',
    sub: 'One short email a month on how the build is going, plus launch news. Unsubscribe any time.',
    parent: "I'm a parent",
    student: "I'm a student",
    studentShare: 'Send this to your parent',
    button: 'Join the waitlist',
    confirmed: "You're on the list. Thank you!",
    invalid: 'That confirmation link has expired. Please join again.',
  },
  footer: 'RedPen Maths is built by DefyScale.',
} as const;
```

- [ ] **Step 4: Write `components/BuyButton.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { COPY } from '@/content/copy';
import { BOARDS } from '@/lib/boards';

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (e: string) => void };
      Initialize: (o: { token: string; eventCallback?: (e: { name: string; data?: { transaction_id?: string } }) => void }) => void;
      Checkout: { open: (o: Record<string, unknown>) => void };
    };
  }
}

let paddleReady: Promise<void> | null = null;
function loadPaddle() {
  paddleReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = () => {
      if (process.env.NEXT_PUBLIC_PADDLE_ENV !== 'production') window.Paddle!.Environment.set('sandbox');
      window.Paddle!.Initialize({
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? '',
        eventCallback: (e) => {
          if (e.name === 'checkout.completed' && e.data?.transaction_id) window.location.href = `/thanks?txn=${encodeURIComponent(e.data.transaction_id)}`;
        },
      });
      resolve();
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return paddleReady;
}

export default function BuyButton() {
  const [left, setLeft] = useState<number | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [board, setBoard] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/passes-left').then((r) => r.json()).then((j: { left: number | null }) => setLeft(j.left)).catch(() => {});
  }, []);

  const buy = async () => {
    setErr('');
    // Re-check on click: the page may have been open while the last passes sold.
    const j = (await fetch('/api/passes-left').then((r) => r.json()).catch(() => ({ left: null }))) as { left: number | null };
    setLeft(j.left);
    if (j.left === 0) return;
    try {
      await loadPaddle();
      window.Paddle!.Checkout.open({
        items: [{ priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID, quantity: 1 }],
        customData: board ? { board } : {},
        settings: { displayMode: 'overlay', locale: 'en' },
      });
    } catch {
      setErr('Checkout could not open. Please try again in a moment.');
    }
  };

  if (left === 0) {
    return (
      <div className="buy sold-out">
        <p>{COPY.pricing.soldOut}</p>
        <a className="btn" href="#waitlist">{COPY.waitlist.button}</a>
      </div>
    );
  }

  return (
    <div className="buy">
      <label className="board">
        Exam board (optional)
        <select value={board} onChange={(e) => setBoard(e.target.value)}>
          <option value="">Choose…</option>
          {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        {COPY.pricing.parentOnly}
      </label>
      <button className="btn primary" disabled={!agreed} onClick={() => void buy()}>
        {COPY.hero.buy}: {COPY.pricing.price}
      </button>
      {left !== null && left > 0 && <p className="left">{left} of 200 early-bird passes left</p>}
      {err && <p role="alert">{err}</p>}
    </div>
  );
}
```

Client components import `BOARDS` from `@/lib/boards`, never `@/lib/db`, which would pull the Neon driver into the browser bundle.

- [ ] **Step 5: Write `components/WaitlistForm.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/content/copy';
import { BOARDS } from '@/lib/boards';

export default function WaitlistForm() {
  const [role, setRole] = useState<'parent' | 'student'>('parent');
  const [email, setEmail] = useState('');
  const [board, setBoard] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const token = useRef('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('waitlist');
    if (p === 'confirmed') setMsg(COPY.waitlist.confirmed);
    if (p === 'invalid') setMsg(COPY.waitlist.invalid);
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey || !box.current) return;
    const render = () => window.turnstile?.render(box.current!, { sitekey: siteKey, appearance: 'interaction-only', callback: (t: string) => (token.current = t) });
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    const r = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role, board: board || null, token: token.current }),
    }).catch(() => null);
    const j = (await r?.json().catch(() => ({}))) as { message?: string; error?: string };
    setMsg(r?.ok ? (j.message ?? 'Check your inbox to confirm.') : (j.error ?? 'Something went wrong. Please try again.'));
    setSending(false);
  };

  const share = async () => {
    const url = window.location.origin;
    const text = 'Can we get this for my GCSE maths? It marks your working and explains the step you got wrong.';
    if (navigator.share) await navigator.share({ title: COPY.brand, text, url }).catch(() => {});
    else {
      await navigator.clipboard.writeText(`${text} ${url}`).catch(() => {});
      setMsg('Link copied. Send it to your parent.');
    }
  };

  return (
    <form className="waitlist" onSubmit={submit}>
      <div className="roles" role="radiogroup" aria-label="Who are you?">
        <label><input type="radio" checked={role === 'parent'} onChange={() => setRole('parent')} /> {COPY.waitlist.parent}</label>
        <label><input type="radio" checked={role === 'student'} onChange={() => setRole('student')} /> {COPY.waitlist.student}</label>
      </div>
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address" autoComplete="email" />
      <select value={board} onChange={(e) => setBoard(e.target.value)} aria-label="Exam board (optional)">
        <option value="">Exam board (optional)</option>
        {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <button className="btn primary" disabled={sending}>{COPY.waitlist.button}</button>
      {role === 'student' && <button type="button" className="btn" onClick={() => void share()}>{COPY.waitlist.studentShare}</button>}
      <div ref={box} />
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
```

- [ ] **Step 6: Write `components/Faq.tsx` and `components/ParentReport.tsx`**

```tsx
// components/Faq.tsx
import { COPY } from '@/content/copy';

export default function Faq() {
  return (
    <div className="faq">
      {COPY.faq.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
```

```tsx
// components/ParentReport.tsx: a static, clearly-labelled mock
import { COPY } from '@/content/copy';

const ROWS = [
  { topic: 'Algebra: expanding brackets', lost: 6, trend: 'improving' },
  { topic: 'Fractions', lost: 4, trend: 'steady' },
  { topic: 'Pythagoras', lost: 1, trend: 'improving' },
];

export default function ParentReport() {
  return (
    <figure className="report" aria-label="Example weekly report">
      <p className="report-label">{COPY.report.label}</p>
      <table>
        <thead><tr><th>Topic</th><th>Marks lost this week</th><th>Trend</th></tr></thead>
        <tbody>{ROWS.map((r) => <tr key={r.topic}><td>{r.topic}</td><td>{r.lost}</td><td>{r.trend}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
```

- [ ] **Step 7: Write `app/page.tsx`**

```tsx
import HeroDemo from '@/components/HeroDemo';
import TryIt from '@/components/TryIt';
import BuyButton from '@/components/BuyButton';
import WaitlistForm from '@/components/WaitlistForm';
import Faq from '@/components/Faq';
import ParentReport from '@/components/ParentReport';
import { COPY } from '@/content/copy';

export default function Home() {
  return (
    <main>
      <header className="wrap top"><strong className="logo">{COPY.brand}</strong><a href="#pricing" className="btn small">{COPY.pricing.price} early-bird</a></header>

      <section className="wrap hero">
        <div>
          <h1>{COPY.hero.title}</h1>
          <p className="lead">{COPY.hero.sub}</p>
          <div className="cta"><a className="btn primary" href="#pricing">{COPY.hero.buy}</a><a className="btn" href="#try">{COPY.hero.try}</a></div>
        </div>
        <HeroDemo />
      </section>

      <section id="try" className="wrap band">
        <h2>{COPY.tryIt.title}</h2>
        <p>{COPY.tryIt.sub}</p>
        <TryIt />
        <p className="after-demo">Your child gets this on every GCSE maths topic. <a href="#pricing">{COPY.hero.buy}</a></p>
      </section>

      <section className="wrap band">
        <h2>{COPY.how.title}</h2>
        <ol className="steps">{COPY.how.steps.map((s) => <li key={s.t}><strong>{s.t}</strong><span>{s.d}</span></li>)}</ol>
      </section>

      <section className="wrap band two">
        <div><h2>{COPY.report.title}</h2><p>{COPY.report.sub}</p></div>
        <ParentReport />
      </section>

      <section className="wrap band">
        <h2>{COPY.trust.title}</h2>
        <ul className="trust">{COPY.trust.points.map((p) => <li key={p}>{p}</li>)}</ul>
      </section>

      <section id="pricing" className="wrap band pricing">
        <h2>{COPY.pricing.title}</h2>
        <p className="price"><span className="now">{COPY.pricing.price}</span> <s>{COPY.pricing.fullPrice}</s></p>
        <p>{COPY.pricing.period}. {COPY.pricing.cap}</p>
        <p className="refund">{COPY.pricing.refund}</p>
        <BuyButton />
      </section>

      <section className="wrap band"><h2>Questions parents ask</h2><Faq /></section>

      <section id="waitlist" className="wrap band">
        <h2>{COPY.waitlist.title}</h2>
        <p>{COPY.waitlist.sub}</p>
        <WaitlistForm />
      </section>

      <footer className="wrap foot">
        <p>{COPY.footer}</p>
        <nav><a href="/refunds">Refunds</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></nav>
      </footer>
    </main>
  );
}
```

- [ ] **Step 8: Write `app/thanks/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { BOARDS } from '@/lib/boards';

type State = 'confirming' | 'completed' | 'refunded' | 'slow' | 'bad';

export default function Thanks() {
  const [state, setState] = useState<State>('confirming');
  const [txn, setTxn] = useState('');
  const [board, setBoard] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('txn') ?? '';
    setTxn(t);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const r = await fetch(`/api/order?txn=${encodeURIComponent(t)}`).catch(() => null);
      if (r?.status === 400) return setState('bad');
      if (r?.status === 200) {
        const j = (await r.json()) as { status: 'completed' | 'refunded'; board: string | null };
        setBoard(j.board);
        return setState(j.status);
      }
      // 202 pending: Paddle's webhook has not landed yet.
      if (++tries >= 20) return setState('slow');
      timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => clearTimeout(timer);
  }, []);

  const saveBoard = async (b: string) => {
    const r = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txnId: txn, board: b }) });
    if (r.ok) { setBoard(b); setSaved(true); }
  };

  return (
    <main className="wrap thanks">
      {state === 'confirming' && <><h1>Confirming your payment…</h1><p>This usually takes a few seconds.</p></>}
      {state === 'completed' && (
        <>
          <h1>You're in. Thank you!</h1>
          <p>Your Early-bird Season Pass 2027 is confirmed. Paddle has emailed your receipt.</p>
          <p>What happens next: a short email each month on how the build is going, then a login invite when RedPen Maths opens in January 2027. You can get a full refund any time before launch; just reply to any of our emails.</p>
          {!board && (
            <div className="board-ask">
              <p>Which exam board is your child on? (optional)</p>
              <div className="cta">{BOARDS.map((b) => <button key={b} className="btn" onClick={() => void saveBoard(b)}>{b}</button>)}</div>
            </div>
          )}
          {saved && <p role="status">Thanks, noted.</p>}
        </>
      )}
      {state === 'refunded' && <><h1>This order was refunded</h1><p>If that's a surprise, reply to your Paddle receipt and we'll sort it out.</p></>}
      {state === 'slow' && <><h1>Payment received</h1><p>Our confirmation is taking longer than usual. Your Paddle receipt is your proof of purchase, and we'll email you shortly.</p></>}
      {state === 'bad' && <><h1>We couldn't find that order</h1><p>Please check the link in your receipt email.</p></>}
      <p><a href="/">Back to RedPen Maths</a></p>
    </main>
  );
}
```

- [ ] **Step 9: Write the legal pages.** Each is a server component rendering `<main className="wrap legal">` with the text below. Mehroz must review them before launch; they are not legal advice.

`app/refunds/page.tsx`, heading "Refunds":
- Before launch (January 2027): a full refund of your Early-bird Season Pass at any time, for any reason. Reply to your receipt email or write to hello@redpenmaths.com.
- After launch: a 14-day money-back guarantee from the day you first get access.
- Refunds go back to the original payment method through Paddle, our payment provider and merchant of record, usually within 5–10 working days.
- This is in addition to your statutory rights.

`app/privacy/page.tsx`, heading "Privacy":
- Who we are: RedPen Maths is run by DefyScale (contact: hello@redpenmaths.com). We are the data controller for this site.
- What we collect: your email address and, if you choose, your role (parent or student) and exam board, when you join the waitlist; and, when you buy, your email and exam board. Payment details go to Paddle, which is the merchant of record and processes them under its own privacy policy. We never see your card details.
- The live demo: what you write on the demo page is sent to our AI provider (Anthropic) to be marked, then discarded. We do not store it. Spoken feedback is generated by OpenAI from the tutor's text only. We keep only anonymous daily counts, such as how many checks ran.
- Security and abuse prevention: we use Cloudflare Turnstile to block bots, and we keep a one-way scrambled version of your IP address for 48 hours to limit demo use.
- Why (lawful basis): your consent for waitlist emails; contract for purchases; legitimate interests for abuse prevention.
- Retention: waitlist data until you unsubscribe or ask us to delete it; order records as long as tax law requires.
- Your rights: access, correction, deletion, objection, and complaint to the ICO (ico.org.uk). Email us to exercise them.
- Cookies: one strictly necessary session cookie for the demo. No advertising or tracking cookies. Analytics are cookie-free.

`app/terms/page.tsx`, heading "Terms of the Early-bird Season Pass":
- What you are buying: access to RedPen Maths for one student from launch (planned for January 2027) until 30 June 2027.
- Price: £49 including any VAT. Paddle.com is the merchant of record and the seller of this order.
- If launch is delayed: we will email you, and you can take a full refund at any time before launch.
- Eligibility: purchases are for parents or guardians aged 18 or over.
- Use: RedPen Maths is for practice and learning. It is not for completing assessed coursework.
- Refunds: see /refunds.
- Contact: hello@redpenmaths.com.

- [ ] **Step 10: Add the section styles** to `app/globals.css`

```css
.top { display: flex; justify-content: space-between; align-items: center; padding-top: 16px; }
.logo { font-size: 1.15rem; }
.btn { display: inline-block; border: 1px solid var(--ink); border-radius: 10px; padding: 12px 18px; font: inherit; font-weight: 600; text-decoration: none; background: #fff; color: var(--ink); cursor: pointer; }
.btn.primary { background: var(--red); border-color: var(--red); color: #fff; }
.btn.small { padding: 8px 12px; font-size: 0.9rem; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hero { display: grid; gap: 24px; padding-top: 32px; padding-bottom: 32px; align-items: center; }
.hero h1 { font-size: clamp(1.8rem, 5vw, 2.8rem); line-height: 1.15; margin: 0 0 12px; }
.lead { font-size: 1.1rem; color: var(--muted); }
.cta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
.band { padding-top: 40px; padding-bottom: 40px; border-top: 1px solid var(--line); }
.band h2 { font-size: clamp(1.4rem, 3.5vw, 2rem); margin: 0 0 12px; }
.steps { display: grid; gap: 16px; padding: 0; list-style: none; counter-reset: s; }
.steps li { display: grid; gap: 4px; padding: 16px; background: #fff; border-radius: var(--radius); border: 1px solid var(--line); }
.two { display: grid; gap: 24px; }
.report table { width: 100%; border-collapse: collapse; background: #fff; border-radius: var(--radius); overflow: hidden; }
.report th, .report td { text-align: left; padding: 10px; border-bottom: 1px solid var(--line); font-size: 0.95rem; }
.report-label { color: var(--muted); font-size: 0.85rem; margin: 0 0 6px; }
.trust { padding-left: 20px; display: grid; gap: 8px; }
.pricing .price .now { font-size: 2.6rem; font-weight: 800; }
.pricing .price s { color: var(--muted); font-size: 1.3rem; }
.refund { font-weight: 600; }
.buy { display: grid; gap: 12px; max-width: 420px; }
.buy .board, .buy .agree { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.buy select, .waitlist input, .waitlist select { font: inherit; padding: 10px; border: 1px solid var(--line); border-radius: 10px; min-width: 0; }
.left { color: var(--muted); margin: 0; }
.faq details { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
.faq summary { font-weight: 600; cursor: pointer; }
.waitlist { display: grid; gap: 10px; max-width: 420px; }
.roles { display: flex; gap: 16px; flex-wrap: wrap; }
.after-demo { margin-top: 16px; }
.foot { padding-top: 24px; padding-bottom: 40px; color: var(--muted); border-top: 1px solid var(--line); }
.thanks, .legal { padding-top: 40px; padding-bottom: 60px; max-width: 720px; }
@media (min-width: 860px) {
  .hero, .two { grid-template-columns: 1fr 1fr; }
  .steps { grid-template-columns: repeat(3, 1fr); }
}
```

- [ ] **Step 11: Run the tests and build.** `npm test && npm run build`. Expected: PASS, including `copy.test.ts`, and the build succeeds.

- [ ] **Step 12: Check the whole page.** With `npm run dev` and the Paddle sandbox env vars set, open `/` at 390×844 and 1440×900. Confirm:
  - there is no horizontal scroll;
  - the hero animates;
  - Try-it marks work;
  - the buy button stays disabled until the checkbox is ticked, then opens the Paddle sandbox overlay;
  - sandbox test card 4242 4242 4242 4242 (Paddle's published test card) completes the purchase and redirects to `/thanks?txn=…`.

  Locally the webhook cannot reach localhost, so `/thanks` will reach the "slow" state. That is expected, and Task 14 verifies the full flow on the deployed site.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "Build landing page, checkout, waitlist, thanks and legal pages"
```

---

### Task 12: Marking fixtures for the demo questions

**Files:**
- Create: `fixtures/make_demo.py`, `fixtures/run-demo.js`

**Interfaces:**
- Consumes: `POST /api/mark` running locally with `DEMO_DEV_OPEN=1`.
- Produces: a pass/fail marking-quality gate. Every case must get the right verdict on all 3 runs, and at least 80% of error cases must place the mark correctly.

- [ ] **Step 1: Write `fixtures/make_demo.py`.** Copy `W`, `H`, `BG`, `INK`, `font()`, `page()`, `ruler()` and `save()` from `/Users/mz/screen-tutor-poc/fixtures/make.py` verbatim, plus any handwriting-wobble helper it uses to draw text (reuse that helper so the fixtures look handwritten). Then add the cases:

```python
# Cases: (name, lines, target_line_index, target_substring) - target is the first wrong value.
CASES = [
    ("alg-correct",   ["3(x - 2) = 2x + 5", "3x - 6 = 2x + 5", "x = 11"], None, None),
    ("alg-sign",      ["3(x - 2) = 2x + 5", "3x - 2 = 2x + 5", "x = 7"], 1, "- 2"),
    ("alg-arith",     ["3(x - 2) = 2x + 5", "3x - 6 = 2x + 5", "x = 1"], 2, "1"),
    ("num-correct",   ["2/3 + 3/4", "= 8/12 + 9/12", "= 17/12 = 1 5/12"], None, None),
    ("num-denoms",    ["2/3 + 3/4", "= 5/7"], 1, "5/7"),
    ("geo-correct",   ["6^2 + 8^2 = 36 + 64", "= 100", "sqrt 100 = 10 cm"], None, None),
    ("geo-nosquare",  ["6 + 8 = 14", "longest side = 14 cm"], 0, "6 + 8"),
    ("blank",         [], None, None),
]
QUESTION = {"alg": "q-algebra", "num": "q-number", "geo": "q-geometry", "blank": "q-algebra"}

for name, lines, ti, sub in CASES:
    img, d = page()
    f = font(46)
    y = 150
    target = None
    for i, line in enumerate(lines):
        d.text((90, y), line, fill=INK, font=f)
        if i == ti:
            start = d.textlength(line[: line.index(sub)], font=f)
            width = d.textlength(sub, font=f)
            target = (90 + start, y, 90 + start + width, y + 50)
        y += 110
    save(img, d, name, target)

import json
json.dump({"targets": TARGETS, "question": {n: QUESTION[n.split("-")[0]] for n, *_ in CASES}}, open("fixtures/demo-targets.json", "w"), indent=2)
print("wrote fixtures/demo-targets.json")
```

Also add a `scribble` case drawn with random lines, as the POC's `doodle-scribble` does (copy that drawing code), with no target and question `q-algebra`.

- [ ] **Step 2: Write `fixtures/run-demo.js`.** Adapt `/Users/mz/screen-tutor-poc/fixtures/run.js`:
  - `URL` defaults to `http://localhost:3000/api/mark`.
  - Each request body adds `questionId: meta.question[name]`.
  - `CASES` becomes: `alg-sign`, `alg-arith`, `num-denoms` and `geo-nosquare` expect `incorrect`; `alg-correct`, `num-correct`, `geo-correct` and `blank` expect `quiet`; `scribble` expects `silent`.
  - Targets come from `fixtures/demo-targets.json` `.targets`.
  - Keep the POC's `verdict()` and placement scoring functions verbatim.
  - At the end, exit with code 1 unless every case's verdict passed on every run *and* placement is at least 80% across error cases. Print one summary line: `verdict X/Y, placement A/B`.

- [ ] **Step 3: Run it**

```bash
npm run fixtures
DEMO_DEV_OPEN=1 npm run dev &   # in another terminal, with ANTHROPIC_API_KEY in .env.local
npm run test:marking
```

Expected: exit code 0 and the summary line. If a case fails, treat it as a prompt bug. Change `ANSWER_KEY_RULES` in `lib/mark/prompt.ts` (never the fixture), re-run, and record what you changed and why in the commit message. Stop the server with `pkill -9 -f "next-server"`.

- [ ] **Step 4: Commit**

```bash
git add fixtures/make_demo.py fixtures/run-demo.js fixtures/demo-targets.json
git commit -m "Add marking fixtures for the three demo questions"
```

---

### Task 13: End-to-end browser test

**Files:**
- Create: `scripts/e2e.mjs`

**Interfaces:**
- Consumes: a running site (`BASE_URL`, default `http://localhost:3000`), the Paddle sandbox, and every route above.
- Produces: `npm run test:e2e`, which exits non-zero on any failure and saves screenshots to `scripts/e2e-out/`.

- [ ] **Step 1: Write `scripts/e2e.mjs`**

```js
// End-to-end checks at phone and laptop sizes. Needs the site running (BASE_URL)
// with DEMO_DEV_OPEN=1 locally, or a deployed preview with Turnstile test keys.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = 'scripts/e2e-out';
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// Draws a polyline on the canvas in page units (900x620), as mouse or touch.
async function draw(page, pts, pointerType = 'mouse') {
  await page.evaluate(({ pts, pointerType }) => {
    const c = document.querySelector('.sheet canvas');
    const r = c.getBoundingClientRect();
    const at = ([x, y]) => ({ clientX: r.left + (x / 900) * r.width, clientY: r.top + (y / 620) * r.height });
    const ev = (type, p) => c.dispatchEvent(new PointerEvent(type, { ...at(p), pointerId: 7, pointerType, isPrimary: true, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', pts[0]);
    for (const p of pts.slice(1)) ev('pointermove', p);
    ev('pointerup', pts[pts.length - 1]);
  }, { pts, pointerType });
}

// Handwriting "3x-2=2x+5" roughly as strokes is fiddly; a digit-shaped wrong line
// ("1 + 1 = 7") is enough to trigger marking against the algebra key.
const ONE = [[120, 200], [120, 280]];
const PLUS_V = [[170, 215], [170, 265]];
const PLUS_H = [[145, 240], [195, 240]];
const ONE_B = [[230, 200], [230, 280]];
const EQ1 = [[270, 225], [320, 225]];
const EQ2 = [[270, 255], [320, 255]];
const SEVEN = [[350, 200], [400, 200], [365, 280]];

for (const vp of [{ name: 'phone', width: 390, height: 844, touch: true }, { name: 'laptop', width: 1440, height: 900, touch: false }]) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`${vp.name}: no horizontal scroll`, !overflow);

  await page.waitForTimeout(2500);
  const heroInk = await page.evaluate(() => {
    const c = document.querySelector('.hero-demo canvas'); // the student layer
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 120 && d[i + 1] < 120) dark++;
    return dark;
  });
  check(`${vp.name}: hero animation draws`, heroInk > 50, `${heroInk} ink samples`);

  await page.locator('#try').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('.demo-msg')?.textContent?.includes('Getting the tutor ready'), null, { timeout: 15000 });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const type = vp.touch ? 'touch' : 'mouse';
  for (const s of [ONE, PLUS_V, PLUS_H, ONE_B, EQ1, EQ2, SEVEN]) await draw(page, s, type);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const touchAction = await page.evaluate(() => getComputedStyle(document.querySelector('.sheet canvas')).touchAction);
  check(`${vp.name}: ${type} drawing marks and does not scroll`, scrollAfter === scrollBefore && touchAction === 'none', `touch-action=${touchAction}`);

  await page.waitForFunction(() => ['marking', 'watching', 'correct', 'error'].includes(document.querySelector('.demo-msg')?.dataset.status) && !document.querySelector('.demo-msg')?.textContent?.includes('Checking'), null, { timeout: 30000 });
  await page.screenshot({ path: `${OUT}/${vp.name}-marked.png` });
  const status = await page.locator('.demo-msg').getAttribute('data-status');
  check(`${vp.name}: wrong work gets marked`, status === 'marking' || status === 'watching', `status=${status}`);

  await browser.close();
}

// Rate limit: 10 checks then the scripted fallback (laptop, fresh context).
{
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const statuses = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 11; i++) {
      const r = await fetch('/api/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: 'q-algebra', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', space: { width: 900, height: 620 }, prior: [], transcript: [] }) });
      out.push(r.status);
    }
    return out;
  });
  check('11th check is rate-limited', statuses[10] === 429, statuses.join(','));
  await browser.close();
}

// Waitlist: join shows the confirm message.
{
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/#waitlist`, { waitUntil: 'networkidle' });
  // Resend's test inbox: accepted and discarded, so no bounces hurt the sending domain.
  await page.fill('.waitlist input[type=email]', 'delivered@resend.dev');
  await page.click('.waitlist button.primary');
  await page.waitForSelector('.waitlist [role=status]', { timeout: 10000 });
  const msg = await page.textContent('.waitlist [role=status]');
  check('waitlist join confirms', /inbox/i.test(msg ?? ''), msg ?? '');
  const bad = await (await page.request.get(`${BASE}/api/waitlist/confirm?token=nope`, { maxRedirects: 0 })).headers().location;
  check('bad confirm token redirects to invalid', /waitlist=invalid/.test(bad ?? ''), bad ?? '');
  await browser.close();
}

// Thanks page: an unknown transaction shows "Confirming", never "not found", while pending.
{
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/thanks?txn=txn_e2e_pending`);
  const h = await page.textContent('h1');
  check('thanks page waits for the webhook', /Confirming/.test(h ?? ''), h ?? '');
  await browser.close();
}

if (process.env.E2E_PADDLE === '1') {
  // Paddle sandbox purchase: only against a deployed preview whose webhook Paddle can reach.
  const browser = await chromium.launch({ headless: false });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/#pricing`, { waitUntil: 'networkidle' });
  await page.check('.buy .agree input');
  await page.click('.buy button.primary');
  console.log('Complete the Paddle sandbox checkout in the opened window with card 4242 4242 4242 4242...');
  await page.waitForURL(/\/thanks\?txn=/, { timeout: 180000 });
  await page.waitForSelector('h1:has-text("You\'re in")', { timeout: 60000 });
  check('paddle sandbox purchase reaches confirmed thanks page', true);
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nall e2e checks passed');
```

- [ ] **Step 2: Run it locally**

```bash
npx playwright install chromium
DEMO_DEV_OPEN=1 npm run dev   # separate terminal; needs ANTHROPIC_API_KEY, DATABASE_URL (a Neon dev branch), RESEND_API_KEY
npm run test:e2e
```

Expected: `all e2e checks passed`. The rate-limit check needs a fresh counter, so restart the dev server between runs (the local counter is in memory). Look at `scripts/e2e-out/*-marked.png` yourself and confirm the red ink is on the drawn working.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e.mjs
git commit -m "Add end-to-end browser checks"
```

---

### Task 14: Deploy and launch

This task mixes Mehroz's account actions (marked **[Mehroz]**) with deploy steps. Do not buy, sign up or submit anything on his behalf. Ask him and wait.

Paddle keys are optional until launch: the site runs waitlist-only while `NEXT_PUBLIC_PAYMENTS_ENABLED` is unset. When the Paddle keys are added, set `NEXT_PUBLIC_PAYMENTS_ENABLED=1` and redeploy (it is a build-time variable).

**Files:**
- Modify: `.env.example` (final cost values), `README.md` (create: how to run, test, deploy)

- [ ] **Step 1: [Mehroz] Accounts and domain.**
  1. Buy `redpenmaths.com` (and `redpenmaths.co.uk` if wanted) on domain.pk.
  2. Hosting is Railway project Expop1 (Mario Stewart's workspace), auto-deploying branch `feat/presale-site`, with Railway Postgres and Railway Redis services. Create a Resend account, and add `redpenmaths.com` as a Resend sending domain.
  3. Create a Cloudflare Turnstile site for `redpenmaths.com` and `localhost`.
  4. Create the Paddle live account and start seller verification.

- [ ] **Step 2: Set env vars on Railway.** In project Expop1, service `web`, set every variable from `.env.example` (`DATABASE_URL` and `REDIS_URL` as references to the Railway Postgres and Redis services). Migrations run automatically as the `preDeployCommand` in `railway.json` (`node scripts/migrate.mjs`):
  - `SESSION_SECRET` and `IP_SALT`: 32 random bytes each, from `openssl rand -hex 32`.
  - `SITE_URL`: `https://redpenmaths.com`.
  - `DEMO_DEV_OPEN`: leave unset.

  **Preview must not share state with Production.** Use a separate Railway environment (with its own Postgres and Redis) for previews. Otherwise sandbox orders count against the real 200 passes and e2e runs spend the production demo cap.

  `PASS_CAP` must equal the "first 200 families" number in `content/copy.ts` (`COPY.pricing.cap`); change both together or neither.

  Paddle vars start with sandbox values. For the **Preview** environment only, use Cloudflare's published always-pass Turnstile test keys, so headless end-to-end runs get a session. Copy the current values from Cloudflare's Turnstile "testing" docs rather than from memory. Production uses the real keys.

- [ ] **Step 3: Migrate and deploy a preview.**
  1. Run `vercel env pull .env.production.local`.
  2. Run `DATABASE_URL=... npm run migrate` against BOTH the production database and the preview branch. Expected: `applied 3 statements` each time.
  3. Run `vercel deploy`.
  4. In the Paddle sandbox, point the notification destination at `<preview-url>/api/paddle/webhook`.

- [ ] **Step 4: Verify the preview end to end.**
  1. Run `BASE_URL=<preview-url> E2E_PADDLE=1 E2E_SKIP_RATE=1 npm run test:e2e`, completing the sandbox checkout by hand. Every check must pass, and the thanks page must reach "You're in".
  2. Refund that sandbox transaction in the Paddle dashboard, then confirm `GET /api/passes-left` returns to 200.
  3. Join the waitlist with a real inbox, click the confirmation email, and land on `?waitlist=confirmed`.

- [ ] **Step 5: Tune the costs from real usage.** Run 20 live-demo checks and 5 lessons on the preview. Read the `x-tutor-tokens` response headers from the browser's network panel. Use Anthropic's current published price for `claude-sonnet-5` (check the pricing page; never estimate from memory) and OpenAI's current `gpt-4o-mini-tts` price to compute the pence per check, per lesson and per spoken line. Round each up, set `COST_CHECK_PENCE`, `COST_LESSON_PENCE` and `COST_SPEAK_PENCE` on Vercel and in `.env.example`, and redeploy.

- [ ] **Step 6: Production.**
  1. **[Mehroz]** Point DNS at Vercel.
  2. Add the domain with `vercel domains add redpenmaths.com`.
  3. Run `vercel deploy --prod`.
  4. Run `BASE_URL=https://redpenmaths.com E2E_SKIP_RATE=1 npm run test:e2e` without `E2E_PADDLE`. The rate-limit section must never run against a deployed URL: behind Vercel the spoofed `x-forwarded-for` is ignored, so it would spend a real visitor allowance and the daily cap. It runs last in the script and only locally. Production uses real Turnstile keys, which may challenge a headless browser. If the only failures are the demo checks and the page shows the scripted fallback, re-check the live demo by hand on a real phone and a laptop instead. Every other check must pass.

- [ ] **Step 7: [Mehroz] Paddle review.** Submit the live site for Paddle's website review. Once approved:
  0. Run `DELETE FROM orders` against the **production** database before switching Paddle to live. Sandbox orders must not count against the 200 passes. Confirm `GET /api/passes-left` returns the full cap afterwards.
  1. Swap `NEXT_PUBLIC_PADDLE_ENV`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_PRICE_ID`, `PADDLE_ENV`, `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET` to their live values.
  2. Point the live notification destination at `https://redpenmaths.com/api/paddle/webhook`.
  3. Redeploy.
  4. Mehroz makes one real £49 purchase and refunds it, to prove the live loop.

- [ ] **Launch checklist (before Step 7's live switch):**
  - `hello@redpenmaths.com` is a monitored inbox (it is the refund and contact address on the privacy, terms and refunds pages, and the sender of every email).
  - `PASS_CAP` on Production equals the "first 200 families" copy.
  - Preview and Production use separate Railway environments, each with its own Postgres and Redis.
  - Production `orders` table has been emptied of sandbox orders.
  - Every e2e run against a deployed URL used `E2E_SKIP_RATE=1`.
  - The server starts: production refuses to boot if any of `IP_SALT`, `SESSION_SECRET`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_API_KEY`, `DATABASE_URL`, `REDIS_URL`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY` is missing (`lib/env.ts`).
  - `PRICE_IN_PER_MTOK_GBP` / `PRICE_OUT_PER_MTOK_GBP` set from Anthropic's current published pricing for `TUTOR_MODEL`.

- [ ] **Step 8: Write the README and commit.** `README.md` covers: what this is (link to the spec); `npm run dev` with `.env.local`; `npm test`; `npm run test:marking`; `npm run test:e2e`; `npm run migrate`; deploy with `vercel deploy --prod`; the env var table from `.env.example`; and how to stop a local server (`pkill -9 -f "next-server"`).

```bash
git add README.md .env.example
git commit -m "Document running, testing and deploying the pre-sale site"
```
