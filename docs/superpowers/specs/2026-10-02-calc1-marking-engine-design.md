# RedPen Maths — Calculus I marking engine design

Date: 2026-10-02 · Status: approved 2026-10-02; amended the same day while writing the plan and again after the code review · Owner: Mehroz (DefyScale)

## Context

RedPen Maths is now aimed at US first-year Calculus I students, reached through an
opt-in email list built from a free marked practice exam. The research behind this
is in `~/reports/US calculus student market.md`. The earlier UK GCSE direction
(`2026-09-30-presale-site-design.md`) is superseded as the target market; its site
stays live until the funnel spec replaces it.

The product is split into six pieces, each with its own spec:

1. **Marking engine for Calc I** (this spec).
2. Question bank and practice-exam generator.
3. Exam flow and accounts: sign-up, sitting an exam, results, one free exam, paywall.
4. Funnel: site repositioned to US Calc I, exam-timed email sequences.
5. Payments: $49 semester pass, $14.99 monthly.
6. Later: voice re-teach, Calculus II, tutor tools.

### Decisions already made

| Decision | Choice |
|---|---|
| Buyer and channel | US Calc I students; opt-in list, no cold email to students |
| First deadline | December 2026 finals (roughly 5–18 December) |
| Hand-in | Both: on-screen canvas and photo of paper |
| Launch rule | Each hand-in path is tested separately and goes live only when it passes the bar |
| Marking approach | Read, then compute: models read and align, a CAS decides |

## Goal and success criteria

Given one question with its rubric and a student's handwritten working, return a
per-point result a US calculus grader would agree with.

A hand-in path (canvas or photo) may go live when, on its own evaluation set:

- **False-red rate ≤ 2%.** Lines the engine marks wrong that the human grader
  judges correct, divided by all lines the grader judges correct.
- **Score agreement ≥ 85%.** Share of solutions where the engine's score is within
  one point of the grader's. For this metric an unchecked point counts as not
  earned, so the engine cannot pass by declining to mark.

Two more numbers are reported but do not gate launch: the false-credit rate
(points awarded that the grader withheld) and coverage (share of points the engine
settled rather than left unchecked).

Target, not a requirement: one problem marked in under 30 seconds at the 95th
percentile.

## Scope

In scope: reading handwriting into typed maths, aligning lines to rubric points,
CAS checking, scoring, the rubric and result formats, a seed set of questions, and
the evaluation harness.

Topics: limits and continuity including L'Hôpital's rule; derivative rules
(product, quotient, chain, implicit); related rates and optimisation, marked on
the equations; the Mean Value Theorem; Riemann sums; the Fundamental Theorem of
Calculus; substitution.

Out of scope: graph and sketch marking, epsilon-delta proofs, Calculus II,
splitting a photographed page into problems (piece 3), storing results (piece 3),
drawing ink on a photo, voice, strict and lenient profile switches.

The existing live tutor in `lib/mark/` is not changed by this spec.

## Architecture

Two parts:

- **Engine library** in `lib/engine/` (TypeScript), called by the app and by the
  evaluation script. Stateless.
- **Checker service** in `services/checker/` (Python, SymPy, FastAPI), deployed as
  a second service in the Railway project with private networking only and a
  shared-secret header. No public URL.

The engine exposes two calls so the read-back can sit between them:

```ts
readProblem(images: EngineImage[], question: Question): Promise<ReadOutcome>   // a transcript, or a retake reason
unparsedLines(question: Question, transcript: Transcript): Promise<number[]>   // maths lines to retype in the read-back
markProblem(question: Question, profile: Profile, transcript: Transcript): Promise<MarkResult>
scoreExam(results: MarkResult[], profile: Profile): ExamScore
```

One call marks one problem. The caller supplies the image or images (one to four)
for that problem only. `markProblem` throws a retryable `EngineError` when the
matcher or the checker cannot be reached.

### Pipeline

1. **Reader (model).** Image to ordered lines. Each line has LaTeX, a bounding box
   in image coordinates, and a confidence of `high` or `low`. An image that is too
   blurred or rotated to read is rejected with a retake reason before any further
   model call.
2. **Read-back (caller).** The student confirms or corrects the transcript.
   Required on the photo path; shown and skippable on canvas. A `low` line the
   student has not confirmed can never be marked wrong; it becomes `unchecked`.
3. **Matcher (model).** For each line: which rubric point it attempts, if any, and
   how it follows from the line before: `rewrite`, `differentiate`, `integrate`,
   `take_limit`, `substitute`, `evaluate` or `unknown`. The matcher never says
   whether a line is correct.
4. **Checker (SymPy).** Runs the rubric's checks and the line-to-line transition
   checks, including follow-through. Details below.
5. **Judge (model).** Only for rubric points of kind `judge`, such as a stated
   reason. It must return the number of the line it relies on and a quote from it.
   No quote, no point.
6. **Scorer (plain code).** Turns check outcomes into points.

The reader, matcher and judge go through the existing provider switch
(`lib/mark/provider.ts`), starting on the currently configured OpenAI model. The
model for each role is chosen by evaluation results, not fixed here.

### Checker rules

- **Parsing.** Student LaTeX is parsed by a grammar-based parser into SymPy
  objects. Nothing a student wrote reaches `eval`, `sympify` or `parse_expr`.
  Rubric expressions are authored by us and are trusted.
- **Proving a line right.** Symbolic: the difference simplifies to zero.
  Fallback: the two sides agree at eight random points in the domain.
- **Proving a line wrong.** Requires a positive disproof: the two sides differ at
  two or more valid sample points. Failure to simplify is not proof.
- **Neither.** The outcome is `unchecked`.
- **Transitions.** `rewrite` is checked by equivalence; `differentiate`,
  `integrate` and `take_limit` by performing the operation on the previous line
  and comparing; `substitute` and `evaluate` by substituting and comparing.
  `unknown` is `unchecked`.
- **Antiderivatives.** Checked by differentiating the student's line, so any
  correct form passes. A missing +C is a penalty flag, not a wrong line.
- **Mislabelled steps.** The matcher's label for a step is a model's guess. Before
  a step is called wrong, every other kind of step is tried; any that is proven
  right wins.
- **A number after an expression** is never proof of an error: students drop the
  limit or substitution they are carrying out. It is `unchecked` unless proven right.
- **Limits and integrals.** A line may match with or without its limit or integral
  sign, since students drop and restore it from line to line.
- **A line must claim to follow.** A step can be proven wrong only when the line
  is about the same thing as the line above: an unlabelled or "= ..." line, the
  same label, or the matching label for a derivative or integral (y then y').
  A new equation, or a line about something else, may state a new fact and is
  never proof of an error.
- **Equations.** A student's equation matches the expected one when it is a
  constant multiple of it or when its solutions satisfy it, so solved and
  rearranged forms count. It is wrong only when its solutions fail the expected
  equation and it has the same unknowns; with fewer unknowns a given value may
  have been put in early, which is `unchecked`.
- **Not proof of an error:** a decimal within 0.5% of the exact value, a constant
  of integration added a line late, and a difference that exists only for
  negative values of the variables.
- **Later lines.** A point is looked for on the matched line and the lines after
  it; the first line proven right wins.
- **Notation.** `y'` is read as the derivative the question declares, words
  around the maths are dropped, `1/2 x^2` is read as a coefficient, and
  `\Delta x` is one symbol. A line with words in it can earn a point but is not
  a step in the chain.
- **Huge numbers.** A line with a number over 15 digits or an exponent over 200 is
  refused at parsing, so it cannot stall the service.
- **Timeout.** Five seconds per check and 45 seconds per request, enforced by the
  service. A timeout is `unchecked`.

### Follow-through

When a point is not earned because of a wrong value, the checker recomputes the
expected values of later points from the student's own value and checks the later
lines against those. Points earned this way are recorded as
`earned_follow_through`.

Follow-through is refused for the rest of the problem when the carried value makes
the problem materially easier. First rule: the student's value has less than half
the operation count (SymPy `count_ops`) of the correct value, or is a constant
where the correct value is not. This threshold is tuned on the evaluation set.

### Scoring

- **Banking.** A point once earned stays earned whatever follows.
- **Eligibility.** A point with `requires` is only available if those points are
  earned, directly or by follow-through.
- **Any valid method.** If no rubric path matches but every transition from the
  question to a final line equal to the answer is proven right, the CAS points
  are all earned. This needs at least three lines of maths: an answer alone, or
  the question restated and then an answer, is not a method.
- **Red needs proof.** A line's status is `wrong` only with a positive disproof.
  A line that earned any point, or whose step from the line above is proven
  right, is never red.
  A point with no attempting line is `not_earned` with reason "not attempted" and
  no red mark.
- **Unchecked.** An unchecked point is removed from both the earned score and the
  total shown to the student, and listed as "couldn't check".
- **Penalties.** `markProblem` returns penalty flags. `scoreExam` applies
  exam-scope penalties once, such as one point for a missing +C.

## Data formats

```ts
interface Question {
  id: string;
  topic: Topic;
  prompt: string;            // text with LaTeX
  variable: string;          // the variable of differentiation or integration
  variables: string[];       // every symbol the rubric uses
  given?: string;            // SymPy syntax for the expression the question starts from
  answer: string;            // SymPy-readable
  points: RubricPoint[];
}

interface RubricPoint {
  id: string;                // 'P1'
  label: string;             // 'Applies the chain rule to the outer function'
  value: number;
  kind: 'cas' | 'judge';
  check?: {                  // kind 'cas'
    type: 'equivalent' | 'equation' | 'antiderivative' | 'exact_value';
    expected: string;        // may reference earlier points as {P1}
    requireConstant?: boolean; // antiderivative only: a missing +C raises the penalty flag
  };
  criterion?: string;        // kind 'judge': what must be stated
  requires: string[];
  followThrough: boolean;
}

interface Profile {          // December ships one: 'ap-default'
  id: string;
  followThrough: boolean;
  plusC: { penalty: number; scope: 'exam' };
  exactForm: boolean;
}

interface Transcript {
  lines: { n: number; image: number; latex: string; box: Box; confidence: 'high' | 'low'; confirmed: boolean }[];
}

interface MarkResult {
  questionId: string;
  points: {
    id: string;
    status: 'earned' | 'earned_follow_through' | 'not_earned' | 'unchecked';
    line?: number;
    verifiedBy: 'cas' | 'judge';
    reason: string;
  }[];
  lines: { n: number; image: number; status: 'ok' | 'wrong' | 'unchecked'; box: Box }[];
  earned: number;
  total: number;             // excludes unchecked points
  unchecked: number;         // value of the points left out of both
  penaltyFlags: string[];
  trace: unknown;            // transcript, alignment and raw check outcomes
}

interface ExamScore {
  earned: number;            // after exam-scope penalties
  total: number;
  unchecked: number;         // points left out of both
  penalties: { id: string; value: number }[];
}

type Box = { x0: number; y0: number; x1: number; y1: number };  // fractions (0 to 1) of the image's width and height
type Topic = 'limits' | 'derivatives' | 'related_rates' | 'optimisation' | 'mvt' | 'riemann' | 'ftc' | 'substitution';
```

In `expected`, `{P1}` means the correct value of P1 in normal checking and the
student's value of P1 in follow-through. This is the contract piece 2 must
produce. The last point of a rubric is the answer point.

A seed set of about 30 hand-written questions with rubrics, spread across the
topics above, ships with the engine for fixtures and the launch test.

## Error handling

| Failure | Behaviour |
|---|---|
| Image unreadable (blur, rotation, no maths) | `readProblem` returns a retake reason; nothing is charged |
| Line will not parse | Line is flagged for the student to retype in the read-back; if still unparseable, `unchecked` |
| Checker timeout or service down | Affected points `unchecked`; if the service is down for the whole problem, `markProblem` fails with a retryable error |
| Model refusal, bad output or API error | One retry, then a retryable error; the caller must not count the attempt against the free exam |
| Matcher assigns a line to a point that does not exist | Assignment dropped; line treated as unassigned |

Spend limits reuse the existing `lib/guard` counters.

## Testing

- **Scorer unit tests:** banking, eligibility chains, follow-through, the
  materially-easier refusal, any-valid-method, unchecked removal, +C once per exam.
- **Checker tests (Python):** each check type and transition type, proof and
  disproof, timeouts, and that hostile input cannot execute code.
- **Typed-transcript set:** transcripts typed by hand with known scores, run
  through `markProblem` only. This measures the compute path with no reading error.
- **Reader set:** deferred. No handwritten images with known transcripts exist
  yet; a misread shows up in the launch evaluation as a false red or an unchecked
  line. Build a separate reader set only if the launch numbers point at reading.
- **Launch evaluation:** about 300 handwritten solutions to the seed questions,
  half on canvas and half as phone photos of paper, covering correct work, the
  documented common errors and alternative methods. A US calculus teaching
  assistant marks every solution against the rubric without seeing the engine's
  output. `scripts/eval-engine` runs the engine over the set and prints the four
  numbers per path. False red needs a second pass, because the grader and the
  reader split a page into lines differently: the script lists each line the
  engine marked wrong and the grader says whether that handwritten line really is
  wrong.

The existing `npm test` suite keeps passing.

## Assumptions to confirm

- The 300 solutions are written by two or three hired writers, since no real
  student scripts are available. This is a cost on top of the grader's 12–15 hours.
- The grader's marks are treated as ground truth. A second grader on a 10% sample
  would show how much two humans disagree, which sets the ceiling for the 85% bar.
