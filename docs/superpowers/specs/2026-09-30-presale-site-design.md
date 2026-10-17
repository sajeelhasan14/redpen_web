# RedPen Maths — pre-sale site design

Date: 2026-09-30 · Status: awaiting review · Owner: Mehroz (DefyScale)

## Context

RedPen Maths productises the Screen Tutor POC (`~/screen-tutor-poc`): an AI tutor
that marks a student's own handwritten maths working in animated red ink and
re-teaches the step with diagrams and voice. The research behind the choice is in
`~/reports/Student AI tool opportunity 2026.md`.

The overall product is split into four sub-projects, each with its own spec:

1. **Pre-sale site** (this spec): landing page, live demo, early-bird checkout, waitlist.
2. Question bank pipeline: full-GCSE-spec original questions with answers, mark
   schemes and worked solutions; AI-drafted, CAS-checked, examiner-approved.
3. Product: parent + student accounts, practice flow, answer-key marking v2,
   re-teach + retry, weekly parent reports.
4. Growth: student creator programme, per-question-type SEO pages, tutor pilot.

### Decisions already made

| Decision | Choice |
|---|---|
| Market | UK GCSE maths, exam-year and resit students; parent pays |
| Name / domain | RedPen Maths, `redpenmaths.com` (confirmed available on domain.pk, Rs. 3,500/yr; not yet bought) |
| Content (later) | Own question bank first, "mark my own question" later; full GCSE spec |
| Accuracy (later) | Paid freelance GCSE maths examiner validates bank and marking |
| Timeline | Pre-sales in November 2026 (target site live ~mid-October) |
| Price | £49 early-bird Season Pass 2027 (Jan–Jun), capped at 200 families; full price £79 |
| Payments | Paddle (merchant of record, handles UK/EU VAT); Lemon Squeezy fallback |

## Goal and success criteria

Validate that UK parents will pay for RedPen Maths before the product exists,
without over-promising.

- Site live on `redpenmaths.com` with waitlist working on day one.
- Paddle checkout live once Paddle approves the site.
- Every claim on the site is true on the day it is published.
- Target signal (not a build requirement): 100 waitlist sign-ups and first paid
  passes within 4 weeks of the creator push.

## Audience

Primary: parents of Year 10–11 and GCSE-resit students in the UK. Secondary:
students arriving from TikTok, who cannot pay and get a "send this to your
parent" share link.

## Pages

| Route | Purpose |
|---|---|
| `/` | Single landing page (sections below) |
| `/thanks` | Post-purchase confirmation and what happens next |
| `/refunds` | Refund policy in plain English |
| `/privacy` | UK GDPR privacy notice (controller: DefyScale) |
| `/terms` | Terms of sale for the pre-sale pass |

### Landing page sections, in order

1. **Hero**: headline "Marks your child's maths working like an examiner, then
   teaches the fix." Scripted red-pen animation (see Demo, layer 1). Buy button and
   "Try it yourself" link.
2. **Try it**: live demo (layer 2).
3. **How it works**: three steps: practise a GCSE question → see exactly which
   line lost the mark → fix it with a spoken re-teach.
4. **Parent report preview**: static mock of a weekly report (marks lost by topic).
   Labelled as a preview.
5. **Trust**: "Covers the full GCSE maths spec for AQA, Edexcel and OCR." "Built
   with a GCSE maths examiner; accuracy results published before launch."
6. **Pricing**: Early-bird Season Pass 2027, £49 (full price £79), Jan–Jun 2027,
   capped at 200 families; refund promise stated beside the button.
7. **FAQ**: Is this cheating? Which boards and tiers? When does it open? Can I
   get a refund? What happens to my child's data?
8. **Waitlist**: for parents not ready to buy.

### Copy rules

- Never use "solve", "answers", "homework done" or similar. All three ad platforms
  ban promoting academic cheating.
- No accuracy figures until the examiner validation has produced them.
- No testimonials, logos or user counts that are not real.
- The scarcity counter shows only real remaining passes.

## Demo

### Layer 1: scripted hero (no AI cost)

A fixed page plays on load and loops. It shows handwritten working for
`3(x − 2) = 2x + 5` with a sign error (`3x − 2 = 2x + 5`). Pre-authored annotations
drive the POC ink engine: strike the wrong term, write the correction, then ask the
question aloud: "You expanded the bracket to 3x − 2. What should 3 × −2 be?" The
audio is pre-generated once and served as a static file. Respects
`prefers-reduced-motion` (shows the final marked state) and has a mute control.

### Layer 2: live "Try it yourself"

- The POC canvas is embedded with **3 fixed questions**: one algebra, one number,
  one geometry. Each has a stored answer and short mark scheme in
  `content/demo-questions.ts`, which is sent to the model as the answer key.
- The student writes working (finger or mouse) and pauses. The POC idle detection
  triggers `/api/mark`, adapted from the POC `/api/tutor` route with the answer key
  added to the prompt. The model is Sonnet 5, as measured in the POC.
- Red-ink marking as in the POC. Correct work gets a quiet green tick.
- A **"Teach me this step"** button requests a short lesson (POC lesson mode)
  scoped to the marked step.
- Voice: `/api/speak` (OpenAI TTS) under the spend cap, with the browser
  speech-synthesis fallback from the POC.

### Cost and abuse controls

- Cloudflare Turnstile (invisible) token is required for `/api/mark`, `/api/speak`
  and `/api/waitlist`.
- Per-visitor limit: 10 marking checks per 24 h, keyed on IP hash, in Upstash Redis.
- Global daily spend cap, default £10 (`DEMO_DAILY_CAP_GBP`). Each call adds its
  estimated cost to a daily Redis counter. Past the cap the live demo is replaced by
  the scripted demo with "The live demo is busy. Here's how it marks."
- When a limit is hit the API returns `429` with a reason, and the client swaps to
  the scripted demo. It never shows a raw error.

### Demo privacy

The canvas image is sent to the model and discarded; nothing a student writes is
stored or logged. There are no accounts. Only anonymous counters are kept
(`demo_checks`, `errors_caught`, `teach_taps`, by day). This keeps the pre-sale
site outside COPPA and UK Children's Code data obligations.

## Checkout (Paddle)

- One Paddle product: **Early-bird Season Pass 2027**, one-off £49 (VAT handled
  by Paddle as merchant of record).
- The Paddle.js overlay opens from the buy buttons. Custom data: exam board
  (AQA / Edexcel / OCR / Not sure, optional) and an "I am the parent or guardian
  and 18+" confirmation. The buy button stays disabled until the box is ticked.
- `POST /api/paddle/webhook` verifies the Paddle signature, handles
  `transaction.completed` and refund/adjustment events, and upserts an `orders`
  row keyed on Paddle transaction id, so repeated events are harmless.
- Cap: `GET /api/passes-left` returns `200 − completed, non-refunded orders`. At
  0 the buy button becomes "Join the waitlist" (server-side check before opening
  checkout too).
- `/thanks` reads the order by Paddle transaction id to confirm, and asks the
  optional exam-board question if it was skipped.

**Open risk:** Paddle reviews the site before live payments and may restrict
selling a product that is not yet available. Before building checkout, check
Paddle's acceptable-use / pre-order rules. If pre-sales are not allowed, use
Lemon Squeezy with the same interface: the checkout code sits behind a small
`lib/payments.ts` adapter so only that file and the webhook change.

## Waitlist

- Form fields: email (required), "I'm a parent / student", exam board (optional).
- Double opt-in: `POST /api/waitlist` stores an unconfirmed row and sends a
  confirmation email through Resend. `GET /api/waitlist/confirm?token=` confirms it.
- Students see a "Send this to your parent" share (Web Share API with
  copy-link fallback). No marketing to anyone who hasn't confirmed.

## Emails (Resend)

1. Waitlist confirmation.
2. Purchase receipt addendum. Paddle sends the legal receipt; ours covers what
   happens next and the refund promise.
3. Monthly build update, sent manually from a template, to confirmed waitlist +
   buyers.
4. Launch invite (built in sub-project 3; the template is out of scope here).

Every marketing email has an unsubscribe link.

## Refunds

- Full refund on request any time before launch.
- 14-day money-back guarantee after launch.
- Requests go to a support email and are processed in the Paddle dashboard. The
  webhook marks the order refunded, which returns the pass to the cap count.

## Data model (Neon Postgres)

```
waitlist(id, email unique, role 'parent'|'student', board null,
         confirmed_at null, token, created_at, unsubscribed_at null)
orders(id, paddle_txn_id unique, email, board null, amount_pence,
       currency, status 'completed'|'refunded', created_at, updated_at)
demo_stats(day date, checks int, errors_caught int, teach_taps int)  -- pk day
```

No child data in any table.

## Stack

- New repo `~/redpen-maths`; the POC is left untouched (it is Mehroz's final-year
  project).
- Next.js 16 (App Router) + TypeScript on Vercel.
- Copied from the POC and trimmed: `lib/glyphs.ts`, `lib/ink.ts`,
  `lib/layout.ts`, `lib/page.ts`, `lib/speech.ts`, `lib/types.ts`, the tutor route
  (becomes `/api/mark`), the speak route, and the canvas parts of `Tutor.tsx`.
- Neon Postgres, Upstash Redis, Resend, Cloudflare Turnstile, Paddle, Vercel
  Analytics (cookie-free, so no consent banner is needed).
- Env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`,
  `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RESEND_API_KEY`,
  `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `PADDLE_API_KEY`,
  `PADDLE_WEBHOOK_SECRET`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `PADDLE_PRICE_ID`,
  `DEMO_DAILY_CAP_GBP`, `PASS_CAP` (default 200).

## Error handling

- Model or TTS failure: the client falls back to the scripted demo or browser
  speech. The visitor never sees a stack trace or raw error.
- Waitlist: duplicate email returns success (no account enumeration); invalid
  email gets an inline message.
- Webhook: invalid signature → 401; unknown event → 200 and ignored;
  DB failure → 500 so Paddle retries.
- Turnstile failure → 403 with a "please retry" message.

## Testing

- Unit (Node test runner): spend-cap accounting, rate limiter, pass-cap
  calculation, webhook signature verification and repeated events, waitlist token
  confirm.
- Marking fixtures: the POC fixture runner adapted to the 3 demo questions
  (correct / sign error / arithmetic error / blank / doodle), 3 runs each, scored on
  verdict and placement.
- Playwright end-to-end at 390×844 and 1440×900: hero animation draws; writing a
  wrong answer in the demo gets marked; the 11th check falls back to the scripted
  demo; waitlist sign-up then confirm link; Paddle sandbox checkout → `/thanks`;
  sold-out state swaps the buy button to the waitlist.

## Launch checklist

1. Mehroz buys `redpenmaths.com` (and ideally `.co.uk`) and points DNS at Vercel.
2. Mehroz creates the Paddle account; seller verification.
3. Provision Neon, Upstash, Resend (verified sending domain), Turnstile; set env
   vars on Vercel.
4. Deploy; waitlist live.
5. Submit the site for Paddle review; on approval switch `PADDLE_PRICE_ID` to live.
6. Run the end-to-end suite against production with the Paddle sandbox, then live.

## Out of scope

Accounts, the question bank, the practice product, parent reports, creator
tooling, SEO pages, cookie-based ad tracking (a Meta pixel would need a consent
banner; revisit in sub-project 4).
