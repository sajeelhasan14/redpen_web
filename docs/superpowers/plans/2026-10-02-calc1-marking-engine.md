# Calculus I Marking Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A marking engine that reads a student's handwritten Calculus I working, checks every step with a computer algebra system, and returns per-point results that meet the launch bar against a human grader.

**Architecture:** Models only read handwriting and line the lines up with the rubric; a private Python SymPy service decides what is right, wrong or unknowable; plain TypeScript turns those outcomes into points. The engine is a stateless library in `lib/engine/` with three calls (`readProblem`, `markProblem`, `scoreExam`), plus an evaluation script that prints the launch numbers.

**Tech Stack:** TypeScript (Next.js repo, `node:test` via `tsx`, zod 4), Python 3.9+ with SymPy 1.14, antlr4-python3-runtime 4.11.1, FastAPI, uvicorn, pytest. OpenAI Responses API and Anthropic SDK through the existing provider switch.

**Spec:** `docs/superpowers/specs/2026-10-02-calc1-marking-engine-design.md`

**Executed 2026-10-02 (Tasks 1 to 16).** The code blocks below are the plan as written. A parser fix in Task 16 and the fix pass after the whole-branch review changed `services/checker/checker/*.py`, `lib/engine/scorer.ts`, `lib/engine/mark.ts`, `lib/engine/types.ts`, `lib/engine/checker-client.ts`, `content/calc1/questions.json` and `fixtures/engine/typed.json`. The repo and the amended spec are the source of truth, not these blocks.

**Provenance of the code below:** every file in this plan was prototyped in a scratch folder and run before the plan was written: 83 Python tests, 196 TypeScript tests (the repo's existing suite included) and a clean `tsc --noEmit`, with all 32 seed model solutions scoring full marks through the real checker. Nothing from the prototype is in the repo. Type the files in as written; if a test disagrees with the plan, stop and report it instead of adjusting the test.

## Global Constraints

- **Launch bar:** false-red rate ≤ 2% and score agreement ≥ 85% within one point, per hand-in path. An unchecked point counts as not earned for the agreement metric.
- **Red needs proof:** a line is `wrong` only with a positive disproof (two or more sample points that differ). Failure to simplify, a timeout, an unreadable line or a low-confidence unconfirmed line is `unchecked`, never `wrong`.
- **No student text as code:** nothing a student wrote reaches `eval`, `sympify` or `parse_expr`. Only rubric strings (our own content) go through `sympify`.
- **Check timeout:** 5 seconds per check, enforced inside the checker; 45 seconds at most per request.
- **Checker is private:** no public URL; every `/check` call carries `x-checker-secret`; the service refuses all calls when `CHECKER_SECRET` is unset.
- **Python 3.9-compatible source:** the local interpreter is 3.9.6. Use `Optional[...]` and `List[...]`, never `X | None` or `match`.
- **Pinned versions:** `sympy==1.14.0`, `antlr4-python3-runtime==4.11.1` (SymPy's LaTeX parser needs exactly 4.11), `fastapi==0.128.8`, `uvicorn==0.39.0`.
- **Do not change `lib/mark/`:** the live tutor is out of scope. The engine imports from it but never edits it.
- **Branch:** work on `feat/calc1-engine`, created from the current `feat/presale-site` HEAD. Never push to `feat/presale-site`: it auto-deploys the live site.
- **Commits:** author is Mehroz <mehroz.muneer@gmail.com> (already the repo's git identity). No `Co-Authored-By` line and no AI credit in any commit message.
- **API keys:** use the keys already in `.env.local`. Never paste a key into a file, a command or a commit.
- **No engine API route in this plan:** piece 3 adds the routes and must charge each call through `lib/guard` (`checkAndCharge`), using the token usage the engine returns in `trace.usage`.

## Review Focus

Inputs the spec does not name but a student will produce. Each has a test in the task that owns the code.

1. **Multi-digit exponent or limit written without braces** (`x^10`, `\int_0^12`): read as the whole number, not as `x^1` times `0`. Test in Task 2.
2. **Answer only, no working:** the final point is credited, earlier points are "not attempted", nothing is red. Typed case `der-power-eval-answer-only` in Task 10.
3. **An astronomically large number in a line** (`9^{9^{9}}`): the line is refused in milliseconds and the rest of the problem is still marked. Tests in Tasks 2 and 6.
4. **Undefined arithmetic in a line** (`\frac{1}{0}`): unchecked, never red, no crash. Test in Task 3.
5. **A constant of integration under another name** (`+ c`, `+ K`, `+ C_1`): counts as the constant; no missing-+C flag. Test in Task 5.

## File Structure

| Path | Responsibility |
|---|---|
| `lib/engine/types.ts` | Every shared shape: question, rubric, transcript, alignment, checker request and reply, results |
| `lib/engine/rubric.ts` | zod schema for a question and the rubric rules the schema cannot express |
| `lib/engine/profiles.ts` | The one marking profile, `AP_DEFAULT` |
| `lib/engine/checker-client.ts` | Builds the checker request; calls the service; any failure is `down` |
| `lib/engine/scorer.ts` | Check outcomes to points: banking, eligibility, follow-through, any-valid-method, line statuses, `scoreExam` |
| `lib/engine/model.ts` | One structured model call for any schema and several images; provider switch; one retry; `EngineError` |
| `lib/engine/reader.ts` | Image to transcript, or a retake reason |
| `lib/engine/matcher.ts` | Which line attempts which point, and how each line follows the one above |
| `lib/engine/judge.ts` | Points a CAS cannot test: a stated reason, with a quote |
| `lib/engine/mark.ts` | `markProblem`: matcher and judge, then checker, then scorer; `unparsedLines` for the read-back |
| `lib/engine/index.ts` | The public surface |
| `lib/engine/eval.ts` | The four launch numbers per hand-in path |
| `content/calc1/questions.json`, `questions.ts` | 32 seed questions with rubrics and model solutions, validated on load |
| `fixtures/engine/typed.json` | 13 typed transcripts with known scores |
| `scripts/eval-engine.ts` | Runs the typed set or a handwritten manifest and prints the numbers |
| `eval/README.md` | Data format and instructions for the solution writers and the grader |
| `services/checker/checker/parse.py` | Student LaTeX to SymPy, safely |
| `services/checker/checker/equiv.py` | Prove equal, prove different, or neither |
| `services/checker/checker/transitions.py` | Does a line follow from the line above |
| `services/checker/checker/rubric.py` | Rubric point checks and follow-through |
| `services/checker/checker/runner.py` | One problem's checks in a child process, with time limits |
| `services/checker/checker/app.py` | FastAPI: `/health`, `/check`, shared-secret gate |
| `tests/engine-*.test.ts`, `services/checker/tests/test_*.py` | Tests, one file per module |

---

### Task 1: Types, rubric validation and the marking profile

**Files:**
- Create: `lib/engine/types.ts`, `lib/engine/rubric.ts`, `lib/engine/profiles.ts`
- Test: `tests/engine-rubric.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type in `types.ts` (used by all later TypeScript tasks); `QuestionSchema`, `TOPICS`, `CHECK_TYPES`, `rubricProblems(q: Question): string[]`, `parseQuestion(raw: unknown): Question`; `AP_DEFAULT: Profile`.

- [ ] **Step 1: Create the branch**

```bash
cd ~/redpen-maths && git checkout -b feat/calc1-engine
```

- [ ] **Step 2: Write the types (no test of their own; every later test compiles against them)**

Create `lib/engine/types.ts`:

```ts
// Shared shapes for the Calc I marking engine. See
// docs/superpowers/specs/2026-10-02-calc1-marking-engine-design.md.

export type Topic = 'limits' | 'derivatives' | 'related_rates' | 'optimisation' | 'mvt' | 'riemann' | 'ftc' | 'substitution';
export type CheckType = 'equivalent' | 'equation' | 'antiderivative' | 'exact_value';
export type TransitionKind = 'rewrite' | 'differentiate' | 'integrate' | 'take_limit' | 'substitute' | 'evaluate' | 'unknown';
export type Outcome = 'right' | 'wrong' | 'unchecked';
/** Fractions (0 to 1) of the image's width and height. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export interface RubricPoint {
  id: string;
  label: string;
  value: number;
  kind: 'cas' | 'judge';
  /** kind 'cas'. `expected` is SymPy syntax and may reference earlier points as {P1}. */
  check?: { type: CheckType; expected: string; /** antiderivative only: a missing +C raises the penalty flag. */ requireConstant?: boolean };
  /** kind 'judge': what the student must state. */
  criterion?: string;
  requires: string[];
  followThrough: boolean;
}

export interface Question {
  id: string;
  topic: Topic;
  prompt: string;
  /** The variable of differentiation or integration. */
  variable: string;
  /** Every symbol the rubric uses, including `variable` and unknowns such as dV_dt. */
  variables: string[];
  /** SymPy syntax for the expression the question starts from, when there is one. */
  given?: string;
  answer: string;
  points: RubricPoint[];
}

export interface Profile {
  id: string;
  followThrough: boolean;
  plusC: { penalty: number; scope: 'exam' };
  exactForm: boolean;
}

export interface TranscriptLine {
  n: number;
  /** Index of the image the line was read from. */
  image: number;
  latex: string;
  box: Box;
  confidence: 'high' | 'low';
  confirmed: boolean;
}
export interface Transcript {
  lines: TranscriptLine[];
}

export interface Alignment {
  lines: { n: number; transition: TransitionKind; substitution: { variable: string; latex: string } | null }[];
  points: { id: string; line: number | null }[];
}

export interface CheckRequest {
  variable: string;
  variables: string[];
  given: string | null;
  lines: { n: number; latex: string }[];
  transitions: { to: number; kind: TransitionKind; substitution: { variable: string; latex: string } | null }[];
  points: { id: string; type: CheckType; expected: string; followThrough: boolean; requireConstant: boolean; line: number | null }[];
  finalPoint: string | null;
}

export interface CheckResponse {
  lines: { n: number; parsed: boolean }[];
  transitions: { to: number; outcome: Outcome }[];
  points: { id: string; outcome: Outcome; ftOutcome: Outcome | null; ftRefused: boolean; note: 'missing_constant' | 'inexact' | null }[];
  final: Outcome;
}

export interface Judgement {
  id: string;
  met: boolean;
  line: number | null;
  quote: string;
}

export type PointStatus = 'earned' | 'earned_follow_through' | 'not_earned' | 'unchecked';
export interface PointResult {
  id: string;
  status: PointStatus;
  line?: number;
  verifiedBy: 'cas' | 'judge';
  reason: string;
}
export interface LineResult {
  n: number;
  image: number;
  status: 'ok' | 'wrong' | 'unchecked';
  box: Box;
}

export interface MarkResult {
  questionId: string;
  points: PointResult[];
  lines: LineResult[];
  earned: number;
  /** Excludes unchecked points. */
  total: number;
  /** Value of the points left out of both `earned` and `total`. */
  unchecked: number;
  penaltyFlags: string[];
  trace: unknown;
}

export interface ExamScore {
  earned: number;
  total: number;
  unchecked: number;
  penalties: { id: string; value: number }[];
}
```

- [ ] **Step 3: Write the failing test**

Create `tests/engine-rubric.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion, rubricProblems } from '@/lib/engine/rubric';
import type { Question } from '@/lib/engine/types';

const good: Question = {
  id: 'q-test',
  topic: 'derivatives',
  prompt: 'Find f\'(2).',
  variable: 'x',
  variables: ['x'],
  answer: '16',
  points: [
    { id: 'P1', label: 'Differentiates', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'diff(x**3, x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Evaluates', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '({P1}).subs(x, 2)' }, requires: ['P1'], followThrough: true },
    { id: 'P3', label: 'Reason', value: 1, kind: 'judge', criterion: 'Says why', requires: [], followThrough: false },
  ],
};
const withPoint = (k: number, over: object): Question => ({ ...good, points: good.points.map((p, i) => (i === k ? ({ ...p, ...over } as Question['points'][number]) : p)) });

test('a sound rubric has no problems and parses', () => {
  assert.deepEqual(rubricProblems(good), []);
  assert.equal(parseQuestion(good).id, 'q-test');
});

test('parseQuestion drops unknown keys', () => {
  assert.equal('model' in parseQuestion({ ...good, model: [] }), false);
});

test('each rubric fault is named', () => {
  const cases: [Question, RegExp][] = [
    [{ ...good, variable: 't' }, /variable t is not in variables/],
    [{ ...good, points: [good.points[0], { ...good.points[1], id: 'P1' }] }, /P1: duplicate id/],
    [withPoint(0, { check: undefined }), /P1: a cas point needs check/],
    [withPoint(2, { criterion: undefined }), /P3: a judge point needs criterion/],
    [withPoint(2, { followThrough: true }), /P3: a judge point cannot follow through/],
    [withPoint(0, { requires: ['P2'] }), /P1: requires P2, which is not an earlier point/],
    [withPoint(0, { check: { type: 'equivalent', expected: '{P2} + 1' } }), /P1: expected references P2/],
    [withPoint(0, { followThrough: true }), /P1: followThrough needs an earlier point/],
    [withPoint(0, { check: { type: 'equivalent', expected: 'x', requireConstant: true } }), /P1: requireConstant is for antiderivative/],
  ];
  for (const [q, re] of cases) assert.match(rubricProblems(q).join('\n'), re);
});

test('parseQuestion throws on a schema fault and on a rubric fault', () => {
  assert.throws(() => parseQuestion({ ...good, id: 'Bad Id' }), /Invalid question/);
  assert.throws(() => parseQuestion({ ...good, points: [] }), /Invalid question/);
  assert.throws(() => parseQuestion({ ...good, variable: 't' }), /Invalid rubric for q-test/);
  assert.throws(() => parseQuestion(null), /Invalid question/);
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `node --import tsx --test tests/engine-rubric.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/rubric`.

- [ ] **Step 5: Write the implementation**

Create `lib/engine/rubric.ts`:

```ts
import { z } from 'zod';
import type { Question } from './types';

export const TOPICS = ['limits', 'derivatives', 'related_rates', 'optimisation', 'mvt', 'riemann', 'ftc', 'substitution'] as const;
export const CHECK_TYPES = ['equivalent', 'equation', 'antiderivative', 'exact_value'] as const;

const PointSchema = z.object({
  id: z.string().regex(/^P\d+$/),
  label: z.string().min(1).max(120),
  value: z.number().int().min(1).max(10),
  kind: z.enum(['cas', 'judge']),
  check: z
    .object({ type: z.enum(CHECK_TYPES), expected: z.string().min(1).max(300), requireConstant: z.boolean().optional() })
    .optional(),
  criterion: z.string().min(1).max(300).optional(),
  requires: z.array(z.string()),
  followThrough: z.boolean(),
});

export const QuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  topic: z.enum(TOPICS),
  prompt: z.string().min(1).max(600),
  variable: z.string().regex(/^[A-Za-z]$/),
  variables: z.array(z.string().regex(/^[A-Za-z][A-Za-z_]*$/)).min(1).max(12),
  given: z.string().min(1).max(300).optional(),
  answer: z.string().min(1).max(300),
  points: z.array(PointSchema).min(1).max(20),
});

const REF = /\{(P\d+)\}/g;

/** Rubric faults the schema cannot express. Empty when the rubric is sound. */
export function rubricProblems(q: Question): string[] {
  const out: string[] = [];
  if (!q.variables.includes(q.variable)) out.push(`variable ${q.variable} is not in variables`);
  const seen = new Map<string, 'cas' | 'judge'>();
  for (const p of q.points) {
    if (seen.has(p.id)) out.push(`${p.id}: duplicate id`);
    if (p.kind === 'cas' && (!p.check || p.criterion !== undefined)) out.push(`${p.id}: a cas point needs check and no criterion`);
    if (p.kind === 'judge' && (!p.criterion || p.check !== undefined)) out.push(`${p.id}: a judge point needs criterion and no check`);
    if (p.kind === 'judge' && p.followThrough) out.push(`${p.id}: a judge point cannot follow through`);
    for (const r of p.requires) if (!seen.has(r)) out.push(`${p.id}: requires ${r}, which is not an earlier point`);
    const refs = p.check ? [...p.check.expected.matchAll(REF)].map((m) => m[1]) : [];
    for (const r of refs) if (seen.get(r) !== 'cas') out.push(`${p.id}: expected references ${r}, which is not an earlier cas point`);
    if (p.followThrough && refs.length === 0) out.push(`${p.id}: followThrough needs an earlier point in expected`);
    if (p.check?.requireConstant && p.check.type !== 'antiderivative') out.push(`${p.id}: requireConstant is for antiderivative checks only`);
    seen.set(p.id, p.kind);
  }
  return out;
}

/** A validated question, or an Error naming every fault. Unknown keys are dropped. */
export function parseQuestion(raw: unknown): Question {
  const r = QuestionSchema.safeParse(raw);
  if (!r.success) throw new Error(`Invalid question: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const q = r.data as Question;
  const problems = rubricProblems(q);
  if (problems.length) throw new Error(`Invalid rubric for ${q.id}: ${problems.join('; ')}`);
  return q;
}
```

Create `lib/engine/profiles.ts`:

```ts
import type { Profile } from './types';

/** The one profile December ships: AP-style marking. */
export const AP_DEFAULT: Profile = {
  id: 'ap-default',
  followThrough: true,
  plusC: { penalty: 1, scope: 'exam' },
  exactForm: true,
};
```

- [ ] **Step 6: Run the test**

Run: `node --import tsx --test tests/engine-rubric.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/types.ts lib/engine/rubric.ts lib/engine/profiles.ts tests/engine-rubric.test.ts
git commit -m "Add marking engine types, rubric validation and the AP profile"
```

---

### Task 2: Checker service: parsing student LaTeX safely

**Files:**
- Create: `services/checker/requirements.txt`, `services/checker/requirements-dev.txt`, `services/checker/checker/__init__.py` (empty), `services/checker/tests/__init__.py` (empty), `services/checker/checker/parse.py`
- Modify: `.gitignore`, `package.json` (scripts)
- Test: `services/checker/tests/test_parse.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `parse_line(latex: str, variables: Iterable[str] = ()) -> ParsedLine`; `ParsedLine.sides: List[Optional[sympy.Basic]]`, `.value` (last side), `.label` (first side when there are two or more, else `None`); `ParseError`; `split_sides(latex: str) -> List[str]`.

What the parser gets wrong on its own, each found by running it and each pinned by a test below: it reads `\int_0^2 3x^2` as an upper limit of 23; it reads `x(20 - x)` as a function call; it binds the power in `x(12 - 2x)^2` to the whole product; it collapses `\int ... = 8` to `False`; it accepts trailing garbage unless `strict=True`; it reads `e` and `pi` as plain symbols; and `\frac{dV}{dt}` of a bare symbol evaluates to 0.

- [ ] **Step 1: Set up the Python environment**

Create `services/checker/requirements.txt`:

```text
sympy==1.14.0
antlr4-python3-runtime==4.11.1
fastapi==0.128.8
uvicorn==0.39.0
```

Create `services/checker/requirements-dev.txt`:

```text
-r requirements.txt
pytest==8.4.2
httpx==0.28.1
```

Create the two empty package files and the virtual environment:

```bash
mkdir -p services/checker/checker services/checker/tests
touch services/checker/checker/__init__.py services/checker/tests/__init__.py
python3 -m venv services/checker/.venv
services/checker/.venv/bin/pip install -q --upgrade pip
services/checker/.venv/bin/pip install -q -r services/checker/requirements-dev.txt
```

Append to `.gitignore`:

```
services/checker/.venv
__pycache__
.pytest_cache
eval/*
!eval/README.md
```

In `package.json`, add these four entries to `"scripts"` (after `"hero-audio"`):

```json
    "checker:dev": "cd services/checker && CHECKER_SECRET=dev .venv/bin/python -m uvicorn checker.app:app --port 8000 --workers 2",
    "checker:test": "cd services/checker && .venv/bin/python -m pytest -q",
    "eval:typed": "node --env-file-if-exists=.env.local --import tsx scripts/eval-engine.ts --typed",
    "eval:engine": "node --env-file-if-exists=.env.local --import tsx scripts/eval-engine.ts --manifest eval/manifest.json"
```

- [ ] **Step 2: Write the failing test**

Create `services/checker/tests/test_parse.py`:

```python
import pytest
import sympy as sp

from checker.parse import ParseError, parse_line, split_sides

x = sp.Symbol("x")


def test_expression_has_one_side():
    line = parse_line(r"3x^2 + 2x")
    assert len(line.sides) == 1
    assert sp.simplify(line.value - (3 * x**2 + 2 * x)) == 0


def test_label_and_value():
    line = parse_line(r"f'(x) = 6x + 2")
    assert len(line.sides) == 2
    assert sp.simplify(line.value - (6 * x + 2)) == 0


def test_chain_takes_last_side_as_value():
    line = parse_line(r"y = 2 \cdot 3x = 6x")
    assert len(line.sides) == 3
    assert sp.simplify(line.value - 6 * x) == 0


def test_leading_equals_continues_previous_line():
    line = parse_line(r"= 6x + 2")
    assert line.sides[0] is None
    assert sp.simplify(line.value - (6 * x + 2)) == 0


def test_e_pi_and_ln_are_the_constants_and_natural_log():
    assert parse_line(r"e^{2x}").value == sp.exp(2 * x)
    assert parse_line(r"2\pi").value == 2 * sp.pi
    assert sp.simplify(parse_line(r"\ln x").value - sp.log(x)) == 0


def test_definite_integral_equation_is_not_collapsed_to_false():
    line = parse_line(r"\int_0^2 3x^2 \, dx = 8")
    assert len(line.sides) == 2
    assert line.sides[0].doit() == 8


def test_equals_inside_braces_is_not_a_split():
    assert split_sides(r"\sum_{i=1}^{n} i = \frac{n(n+1)}{2}") == [r"\sum_{i=1}^{n} i", r"\frac{n(n+1)}{2}"]


def test_derivative_of_bare_symbol_becomes_one_unknown():
    line = parse_line(r"\frac{dV}{dt} = 4\pi r^2 \frac{dr}{dt}")
    assert line.sides[0] == sp.Symbol("dV_dt")
    assert sp.Symbol("dr_dt") in line.value.free_symbols


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "   ",
        r"x = 2, y = 3",
        r"x + ",
        r"2x)",
        r"x = 2 \text{ so}",
        r"__import__('os').system('echo PWNED')",
        r"\begin{matrix} 1 \end{matrix}",
        r"x \ge 0",
        r"dV/dt = 3",
        "x" * 401,
        r"x = ",
    ],
)
def test_rejects(bad):
    with pytest.raises(ParseError):
        parse_line(bad)


def test_bare_limits_are_not_glued_to_the_integrand():
    line = parse_line(r"\int_0^2 3x^2 \, dx")
    assert line.value.doit() == 8
    assert parse_line(r"\int_1^3 2x \, dx").value.doit() == 8
    assert sp.simplify(parse_line(r"x^2 3").value - 3 * x**2) == 0


def test_variable_times_bracket_is_a_product_not_a_function_call():
    line = parse_line(r"A = x(20 - x)", ["x"])
    assert sp.simplify(line.value - x * (20 - x)) == 0
    line = parse_line(r"2x(x-1) - (x^2+1)", ["x"])
    assert sp.simplify(line.value - (x**2 - 2 * x - 1)) == 0


def test_function_label_is_left_alone():
    line = parse_line(r"f(x) = x(x - 1)", ["x"])
    assert line.sides[0].func.__name__ == "f"


def test_power_after_variable_times_bracket_binds_to_the_bracket():
    line = parse_line(r"V = x(12 - 2x)^2", ["x"])
    assert sp.simplify(line.value - x * (12 - 2 * x) ** 2) == 0


def test_multi_digit_exponent_without_braces_is_read_whole():
    assert sp.simplify(parse_line(r"x^10").value - x**10) == 0
    assert parse_line(r"\int_0^12 1 \, dx").value.doit() == 12


@pytest.mark.parametrize("huge", [r"9^{9^{9}}", r"9^{9^{9^{9}}}", r"2^{100000}", r"x^{1000}", "1" * 16, r"e^{9^{9}}"])
def test_refuses_numbers_that_would_stall_the_checker(huge):
    with pytest.raises(ParseError):
        parse_line(huge)


def test_ordinary_powers_are_fine():
    assert parse_line(r"2^{10}").value.doit() == 1024
    assert parse_line(r"x^{-2}").value == x**-2
    assert parse_line(r"e^{-x^{2}}").value == sp.exp(-x**2)
    assert sp.simplify(parse_line(r"x^{\frac{1}{2}}").value - sp.sqrt(x)) == 0
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm run checker:test -- tests/test_parse.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'checker.parse'`.

- [ ] **Step 4: Write the implementation**

Create `services/checker/checker/parse.py`:

```python
"""Student LaTeX to SymPy. Nothing here evaluates student text as code."""
import re
import warnings
from dataclasses import dataclass
from typing import Iterable, List, Optional

import sympy as sp
from sympy.core.function import AppliedUndef
from sympy.parsing.latex import parse_latex

MAX_LEN = 400

ALLOWED_COMMANDS = {
    "frac", "sqrt", "sin", "cos", "tan", "sec", "csc", "cot",
    "arcsin", "arccos", "arctan", "ln", "log", "exp",
    "pi", "theta", "infty", "int", "lim", "to", "cdot", "times",
    "left", "right", "sum", "Delta",
}

_SPACING = re.compile(r"\\[,;:! ]|\\quad|\\qquad")
_COMMAND = re.compile(r"\\([A-Za-z]+)")
_ALLOWED_CHARS = re.compile(r"^[A-Za-z0-9\\{}^_+\-*/=().|'\[\] ]*$")
_INLINE_DIFFERENTIAL = re.compile(r"^d[A-Za-z]$")
# The parser reads "\\int_0^2 3x^2" as an upper limit of 23, and "x^10" as x^1 times 0.
# Bracing every bare subscript and superscript (one letter, or a run of digits)
# removes both ambiguities.
_BARE_SCRIPT = re.compile(r"([_^])\s*(\d+|[A-Za-z])")
MAX_DIGITS = 15
MAX_EXPONENT = 200


class ParseError(ValueError):
    pass


@dataclass
class ParsedLine:
    """One written line. `sides` are the parts between top-level '=' signs.

    A line that starts with '=' continues the line above, so its first side is None.
    """

    sides: List[Optional[sp.Basic]]

    @property
    def value(self) -> sp.Basic:
        return self.sides[-1]

    @property
    def label(self) -> Optional[sp.Basic]:
        return self.sides[0] if len(self.sides) > 1 else None


def split_sides(latex: str) -> List[str]:
    """Split at '=' signs that are not inside braces (so \\sum_{i=1}^{n} survives)."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(latex):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif ch == "=" and depth == 0:
            parts.append(latex[start:i])
            start = i + 1
    parts.append(latex[start:])
    return [p.strip() for p in parts]


def _normalise(expr: sp.Basic, variables: Iterable[str]) -> sp.Basic:
    # The parser reads x(20 - x) as a function x applied to 20 - x. When x is one
    # of the question's variables it is a product.
    names = set(variables)
    product = lambda e: isinstance(e, AppliedUndef) and e.func.__name__ in names and len(e.args) == 1
    # x(12 - 2x)^2 arrives as (x applied to 12 - 2x) squared: the power belongs to the bracket only.
    expr = expr.replace(
        lambda e: isinstance(e, sp.Pow) and product(e.base),
        lambda e: sp.Symbol(e.base.func.__name__) * e.base.args[0] ** e.exp,
    )
    expr = expr.replace(product, lambda e: sp.Symbol(e.func.__name__) * e.args[0])
    # The parser reads e and pi as plain symbols and \ln x as log(x, E).
    expr = expr.subs({sp.Symbol("e"): sp.E, sp.Symbol("pi"): sp.pi})
    expr = expr.replace(
        lambda e: isinstance(e, sp.log) and len(e.args) == 2,
        lambda e: sp.log(e.args[0]) / sp.log(e.args[1]),
    )
    # dV/dt for a bare symbol V would evaluate to 0. Treat it as one unknown, dV_dt.
    expr = expr.replace(
        lambda e: isinstance(e, sp.Derivative) and isinstance(e.expr, sp.Symbol) and len(e.variables) == 1,
        lambda e: sp.Symbol("d%s_d%s" % (e.expr.name, e.variables[0].name)),
    )
    for s in expr.free_symbols:
        if _INLINE_DIFFERENTIAL.match(s.name):
            raise ParseError("write derivatives as \\frac{dy}{dx}")
    return expr


def _refuse_huge(expr: sp.Basic) -> None:
    """9^{9^{9}} would take minutes and gigabytes to evaluate. No exam answer needs it."""
    # Innermost first, so a tower is refused at its lowest oversized level
    # before anything above it is ever evaluated.
    for node in sp.postorder_traversal(expr):
        if isinstance(node, sp.Integer) and len(str(abs(int(node)))) > MAX_DIGITS:
            raise ParseError("number too large")
        if isinstance(node, sp.Pow) and node.exp.is_number:
            if not node.exp.is_real or abs(float(node.exp)) > MAX_EXPONENT:
                raise ParseError("exponent too large")


def _parse_side(src: str, variables: Iterable[str]) -> sp.Basic:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            expr = parse_latex(src, strict=True, backend="antlr")
        except Exception as err:  # the parser raises several unrelated types
            raise ParseError(str(err)[:120])
    if not isinstance(expr, sp.Expr):
        raise ParseError("not an expression")
    _refuse_huge(expr)
    return _normalise(expr, variables)


def parse_line(latex: str, variables: Iterable[str] = ()) -> ParsedLine:
    if not isinstance(latex, str) or not latex.strip():
        raise ParseError("empty")
    if len(latex) > MAX_LEN:
        raise ParseError("too long")
    src = _BARE_SCRIPT.sub(r"\1{\2}", _SPACING.sub(" ", latex))
    if not _ALLOWED_CHARS.match(src):
        raise ParseError("unsupported character")
    for cmd in _COMMAND.findall(src):
        if cmd not in ALLOWED_COMMANDS:
            raise ParseError("unsupported command \\%s" % cmd)
    parts = split_sides(src)
    sides: List[Optional[sp.Basic]] = []
    for i, part in enumerate(parts):
        if part == "":
            if i == 0 and len(parts) > 1:
                sides.append(None)
                continue
            raise ParseError("empty side")
        sides.append(_parse_side(part, variables))
    return ParsedLine(sides)
```

- [ ] **Step 5: Run the test**

Run: `npm run checker:test -- tests/test_parse.py`
Expected: 32 passed.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json services/checker/requirements.txt services/checker/requirements-dev.txt services/checker/checker/__init__.py services/checker/tests/__init__.py services/checker/checker/parse.py services/checker/tests/test_parse.py
git commit -m "Add the checker service's LaTeX parser"
```

---

### Task 3: Checker service: proving equal, proving different, or neither

**Files:**
- Create: `services/checker/checker/equiv.py`
- Test: `services/checker/tests/test_equiv.py`

**Interfaces:**
- Consumes: `parse_line` (in one test only).
- Produces: `RIGHT`, `WRONG`, `UNCHECKED` (the strings `"right"`, `"wrong"`, `"unchecked"`); `evaluate(expr)`; `prove_equal(a, b, seed=0) -> str`; `forms(expr) -> List[Basic]`; `prove_any(a, b) -> str`; `prove_equation(l1, r1, l2, r2, seed=0) -> str`.

- [ ] **Step 1: Write the failing test**

Create `services/checker/tests/test_equiv.py`:

```python
import sympy as sp

from checker.equiv import RIGHT, UNCHECKED, WRONG, prove_equal, prove_equation

x, y = sp.symbols("x y")


def test_equal_by_simplification():
    assert prove_equal((x + 1) ** 2, x**2 + 2 * x + 1) == RIGHT


def test_equal_trig_identity():
    assert prove_equal(sp.sin(2 * x), 2 * sp.sin(x) * sp.cos(x)) == RIGHT


def test_different_is_disproved():
    assert prove_equal(6 * x + 2, 6 * x + 3) == WRONG


def test_sign_error_is_disproved():
    assert prove_equal(2 * x * sp.cos(x**2), -2 * x * sp.cos(x**2)) == WRONG


def test_constants_compare_numerically():
    assert prove_equal(sp.Integer(8), sp.Integral(3 * x**2, (x, 0, 2))) == RIGHT
    assert prove_equal(sp.Integer(7), sp.Integral(3 * x**2, (x, 0, 2))) == WRONG


def test_undefined_function_is_unchecked():
    f = sp.Function("f")
    assert prove_equal(f(x), 6 * x) == UNCHECKED


def test_no_valid_sample_points_is_unchecked():
    # sqrt(-1 - x^2) is never real, so nothing can be sampled.
    assert prove_equal(sp.sqrt(-1 - x**2), sp.sqrt(-1 - x**2) + sp.sqrt(-2 - x**2)) == UNCHECKED


def test_log_domain_still_finds_points():
    assert prove_equal(sp.log(x**2), 2 * sp.log(x)) in (RIGHT, UNCHECKED)
    assert prove_equal(sp.log(x) + 1, sp.log(x) + 2) == WRONG


def test_equation_same_up_to_constant_multiple():
    assert prove_equation(2 * x + 4, sp.Integer(0), x + 2, sp.Integer(0)) == RIGHT
    assert prove_equation(x**2 + y**2, sp.Integer(25), y**2, 25 - x**2) == RIGHT


def test_equation_different():
    assert prove_equation(2 * x + 4, sp.Integer(0), x + 3, sp.Integer(0)) == WRONG


def test_division_by_zero_is_unchecked_never_wrong():
    from checker.parse import parse_line
    bad = parse_line(r"\frac{1}{0}").value
    assert prove_equal(bad, x) == UNCHECKED
    assert prove_equal(bad, sp.Integer(3)) == UNCHECKED
    assert prove_equal(parse_line(r"\frac{0}{0}").value, sp.Integer(1)) == UNCHECKED
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run checker:test -- tests/test_equiv.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'checker.equiv'`.

- [ ] **Step 3: Write the implementation**

Create `services/checker/checker/equiv.py`:

```python
"""Prove two expressions equal, prove them different, or admit neither."""
import random
from typing import Dict, List, Optional

import sympy as sp
from sympy.core.function import AppliedUndef

RIGHT, WRONG, UNCHECKED = "right", "wrong", "unchecked"
NEEDED = 8
ATTEMPTS = 60
TOL = 1e-8


def evaluate(expr: sp.Basic) -> sp.Basic:
    """Carry out any unevaluated derivative, integral or limit."""
    return expr.doit()


def _number(expr: sp.Basic, point: Dict[sp.Symbol, sp.Rational]) -> Optional[float]:
    try:
        v = sp.N(expr.subs(point), 30)
    except Exception:
        return None
    if not v.is_number or not v.is_finite or not v.is_real:
        return None
    return float(v)


def _points(symbols: List[sp.Symbol], seed: int):
    rng = random.Random(seed)
    for _ in range(ATTEMPTS):
        yield {s: sp.Rational(rng.randint(-40, 40), 8) for s in symbols}


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= TOL * max(1.0, abs(a), abs(b))


def prove_equal(a: sp.Basic, b: sp.Basic, seed: int = 0) -> str:
    a, b = evaluate(a), evaluate(b)
    if a.atoms(AppliedUndef) or b.atoms(AppliedUndef):
        return UNCHECKED
    try:
        if sp.simplify(a - b) == 0:
            return RIGHT
    except Exception:
        pass
    symbols = sorted(a.free_symbols | b.free_symbols, key=lambda s: s.name)
    if not symbols:
        va, vb = _number(a, {}), _number(b, {})
        if va is None or vb is None:
            return UNCHECKED
        return RIGHT if _close(va, vb) else WRONG
    agree = differ = 0
    for point in _points(symbols, seed):
        va, vb = _number(a, point), _number(b, point)
        if va is None or vb is None:
            continue
        if _close(va, vb):
            agree += 1
        else:
            differ += 1
        if agree + differ >= NEEDED:
            break
    if differ >= 2:
        return WRONG
    if differ == 0 and agree >= NEEDED:
        return RIGHT
    return UNCHECKED


def forms(expr: sp.Basic) -> List[sp.Basic]:
    """An unevaluated limit or integral, and the expression inside it. Students
    drop and restore the operator from line to line; either reading may match."""
    if isinstance(expr, sp.Limit):
        return [expr, expr.args[0]]
    if isinstance(expr, sp.Integral):
        return [expr, expr.function]
    return [expr]


def prove_any(a: sp.Basic, b: sp.Basic) -> str:
    """Right if any reading of a equals any reading of b; wrong only if every pairing is disproved."""
    results = [prove_equal(x, y) for x in forms(a) for y in forms(b)]
    if RIGHT in results:
        return RIGHT
    return WRONG if all(r == WRONG for r in results) else UNCHECKED


def prove_equation(l1: sp.Basic, r1: sp.Basic, l2: sp.Basic, r2: sp.Basic, seed: int = 0) -> str:
    """Two equations are the same when one is a non-zero constant multiple of the other."""
    f, g = evaluate(l1 - r1), evaluate(l2 - r2)
    if f.atoms(AppliedUndef) or g.atoms(AppliedUndef):
        return UNCHECKED
    symbols = sorted(f.free_symbols | g.free_symbols, key=lambda s: s.name)
    if not symbols:
        return UNCHECKED
    ratios: List[float] = []
    differ = 0
    for point in _points(symbols, seed):
        vf, vg = _number(f, point), _number(g, point)
        if vf is None or vg is None:
            continue
        if abs(vf) < TOL and abs(vg) < TOL:
            continue
        if abs(vf) < TOL or abs(vg) < TOL:
            differ += 1
        else:
            ratios.append(vf / vg)
        if len(ratios) + differ >= NEEDED:
            break
    differ += sum(1 for r in ratios[1:] if not _close(r, ratios[0]))
    if differ >= 2:
        return WRONG
    if differ == 0 and len(ratios) >= NEEDED:
        return RIGHT
    return UNCHECKED
```

- [ ] **Step 4: Run the test**

Run: `npm run checker:test -- tests/test_equiv.py`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add services/checker/checker/equiv.py services/checker/tests/test_equiv.py
git commit -m "Add equivalence proof and disproof to the checker"
```

---

### Task 4: Checker service: does a line follow from the line above

**Files:**
- Create: `services/checker/checker/transitions.py`
- Test: `services/checker/tests/test_transitions.py`

**Interfaces:**
- Consumes: `ParsedLine`, `parse_line`; `RIGHT`, `WRONG`, `UNCHECKED`, `prove_any`, `prove_equal`, `prove_equation`.
- Produces: `KINDS` (the seven transition names); `check_transition(kind: str, prev: ParsedLine, cur: ParsedLine, variable: Symbol, substitution: Optional[dict] = None) -> str`, where `substitution` maps a SymPy symbol to a value.

Two rules here protect the false-red bar. The matcher's label is a model's guess, so before a step is called wrong every other reading is tried. And a bare number after an expression is never proof of an error, because students drop the limit or substitution they are performing.

- [ ] **Step 1: Write the failing test**

Create `services/checker/tests/test_transitions.py`:

```python
import sympy as sp

from checker.equiv import RIGHT, UNCHECKED, WRONG
from checker.parse import parse_line
from checker.transitions import check_transition

x = sp.Symbol("x")


def t(kind, prev, cur, sub=None):
    return check_transition(kind, parse_line(prev), parse_line(cur), x, sub)


def test_rewrite_same_label():
    assert t("rewrite", r"y = (x+1)^2", r"y = x^2 + 2x + 1") == RIGHT
    assert t("rewrite", r"y = (x+1)^2", r"y = x^2 + 2x + 2") == WRONG


def test_rewrite_continuation_line():
    assert t("rewrite", r"f'(x) = 2 \cdot 3x", r"= 6x") == RIGHT


def test_rewrite_solving_an_equation():
    assert t("rewrite", r"2x + 4 = 0", r"x = -2") == RIGHT
    assert t("rewrite", r"2x + 4 = 0", r"x = 2") == WRONG
    assert t("rewrite", r"x^2 = 4", r"x = 2") == RIGHT


def test_rewrite_equation_to_equation():
    assert t("rewrite", r"3x - 6 = 2x + 5", r"3x - 2x = 5 + 6") == RIGHT
    assert t("rewrite", r"3x - 6 = 2x + 5", r"3x - 2x = 5 - 6") == WRONG


def test_differentiate():
    assert t("differentiate", r"x^2 \sin x", r"2x \sin x + x^2 \cos x") == RIGHT
    assert t("differentiate", r"f(x) = \sin(x^2)", r"f'(x) = \cos(x^2)") == WRONG


def test_differentiate_implicit_is_left_to_the_rubric():
    assert t("differentiate", r"x^2 + y^2 = 25", r"2x + 2y \frac{dy}{dx} = 0") == UNCHECKED


def test_integrate_indefinite_any_constant():
    assert t("integrate", r"\int 2x \, dx", r"x^2 + C") == RIGHT
    assert t("integrate", r"\int 2x \, dx", r"x^2") == RIGHT
    assert t("integrate", r"\int 2x \, dx", r"2x^2 + C") == WRONG


def test_integrate_definite():
    assert t("integrate", r"\int_0^2 3x^2 \, dx", r"8") == RIGHT
    assert t("integrate", r"\int_0^2 3x^2 \, dx", r"6") == WRONG
    assert t("integrate", r"\int_0^2 3x^2 \, dx", r"x^3") == RIGHT


def test_number_after_expression_is_never_proof_of_an_error():
    assert t("rewrite", r"x + 2", r"4") == UNCHECKED
    assert t("rewrite", r"\lim_{x \to 2} (x + 2)", r"4") == RIGHT
    assert t("rewrite", r"\lim_{x \to 2} \frac{x^2 - 4}{x - 2}", r"x + 2") == RIGHT


def test_take_limit():
    assert t("take_limit", r"\lim_{x \to 0} \frac{\sin x}{x}", r"1") == RIGHT
    assert t("take_limit", r"\lim_{x \to 0} \frac{\sin x}{x}", r"0") == WRONG
    assert t("take_limit", r"\frac{\sin x}{x}", r"1") == UNCHECKED


def test_substitute_needs_the_value():
    assert t("substitute", r"6x + 2", r"14", {x: sp.Integer(2)}) == RIGHT
    assert t("substitute", r"6x + 2", r"12", {x: sp.Integer(2)}) == WRONG
    assert t("substitute", r"6x + 2", r"14") == UNCHECKED


def test_unknown_tries_every_reading():
    assert t("unknown", r"x^2", r"2x") == RIGHT
    assert t("unknown", r"x^2", r"5x") == UNCHECKED


def test_mislabelled_step_is_not_called_wrong():
    # The matcher said "rewrite" but the student differentiated, correctly.
    assert t("rewrite", r"x^2 \sin x", r"2x \sin x + x^2 \cos x") == RIGHT
    # Really wrong under every reading.
    assert t("rewrite", r"x^2 \sin x", r"2x \sin x - x^3 \cos x") == WRONG


def test_derivative_label_does_not_make_a_line_implicit():
    assert t("differentiate", r"y = x^2 \sin x", r"\frac{dy}{dx} = 2x \sin x + x^2 \cos x") == RIGHT
    assert t("differentiate", r"y = x^2 \sin x", r"\frac{dy}{dx} = 2x \sin x - x^2 \cos x") == WRONG
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run checker:test -- tests/test_transitions.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'checker.transitions'`.

- [ ] **Step 3: Write the implementation**

Create `services/checker/checker/transitions.py`:

```python
"""Does a line follow from the line before it?"""
from typing import Optional

import sympy as sp
from sympy.core.function import AppliedUndef

from .equiv import RIGHT, UNCHECKED, WRONG, prove_any, prove_equal, prove_equation
from .parse import ParsedLine

KINDS = ("rewrite", "differentiate", "integrate", "take_limit", "substitute", "evaluate", "unknown")


def _implicit(line: ParsedLine) -> bool:
    """True for work the line-to-line derivative check cannot follow: a derivative
    written as an unknown (dy_dx), or a real equation rather than a labelled value."""
    if any(s.name.startswith("d") and "_d" in s.name for s in line.value.free_symbols):
        return True
    label = line.label
    return label is not None and not isinstance(label, (sp.Symbol, AppliedUndef))


def _rewrite(prev: ParsedLine, cur: ParsedLine) -> str:
    by_value = prove_any(prev.value, cur.value)
    if by_value == RIGHT:
        return RIGHT
    both_equations = len(prev.sides) == 2 and len(cur.sides) == 2 and prev.label is not None and cur.label is not None
    if both_equations and prev.label != cur.label:
        # "x = -2" after "2x + 4 = 0": right when the value satisfies the equation above.
        if isinstance(cur.label, sp.Symbol) and cur.label not in cur.value.free_symbols:
            at = {cur.label: cur.value}
            return prove_equal(prev.label.subs(at), prev.value.subs(at))
        return prove_equation(prev.label, prev.value, cur.label, cur.value)
    # "x + 2" followed by "4" may be a limit or a substitution the student did not
    # write out. A bare number after an expression is never proof of an error.
    if by_value == WRONG and prev.value.free_symbols and not cur.value.free_symbols:
        return UNCHECKED
    return by_value


_FALLBACKS = ("rewrite", "differentiate", "integrate", "take_limit")


def check_transition(kind: str, prev: ParsedLine, cur: ParsedLine, variable: sp.Symbol,
                     substitution: Optional[dict] = None) -> str:
    """The matcher's label for a step is a model's guess. Before a step is called
    wrong, every other kind of step is tried; any that is proven right wins."""
    outcome = _check(kind, prev, cur, variable, substitution)
    if outcome == RIGHT:
        return RIGHT
    for other in _FALLBACKS:
        if other == kind:
            continue
        # A constant differentiates to 0 and any constant integrates 0, so these two
        # readings prove nothing unless the variable is really there.
        if other == "differentiate" and variable not in prev.value.free_symbols:
            continue
        if other == "integrate" and variable not in cur.value.free_symbols:
            continue
        if _check(other, prev, cur, variable, substitution) == RIGHT:
            return RIGHT
    return outcome


def _check(kind: str, prev: ParsedLine, cur: ParsedLine, variable: sp.Symbol,
           substitution: Optional[dict] = None) -> str:
    if kind in ("rewrite", "evaluate"):
        return _rewrite(prev, cur)
    if kind == "differentiate":
        if _implicit(prev) or _implicit(cur) or (prev.value.free_symbols - {variable}):
            return UNCHECKED
        return prove_equal(sp.diff(prev.value, variable), cur.value)
    if kind == "integrate":
        if isinstance(prev.value, sp.Integral):
            by_integrand = prove_equal(sp.diff(cur.value, variable), prev.value.function)
            definite = len(prev.value.limits[0]) == 3
            if by_integrand == RIGHT or not definite:
                return by_integrand
            # A definite integral may also be followed directly by its value.
            return prove_equal(prev.value, cur.value)
        return prove_equal(sp.diff(cur.value, variable), prev.value)
    if kind == "take_limit":
        if not prev.value.has(sp.Limit):
            return UNCHECKED
        return prove_equal(prev.value, cur.value)
    if kind == "substitute":
        if not substitution:
            return UNCHECKED
        return prove_equal(prev.value.subs(substitution), cur.value)
    return UNCHECKED
```

- [ ] **Step 4: Run the test**

Run: `npm run checker:test -- tests/test_transitions.py`
Expected: 14 passed.

- [ ] **Step 5: Commit**

```bash
git add services/checker/checker/transitions.py services/checker/tests/test_transitions.py
git commit -m "Add line-to-line transition checks to the checker"
```

---

### Task 5: Checker service: rubric points and follow-through

**Files:**
- Create: `services/checker/checker/rubric.py`
- Test: `services/checker/tests/test_rubric.py`

**Interfaces:**
- Consumes: `ParsedLine`, `parse_line`; everything `equiv.py` produces.
- Produces: `TYPES` (the four check types); `references(template) -> List[str]`; `eval_expected(template, variables, values) -> Basic`; `materially_easier(student, correct, variables) -> bool`; `compare(kind, line, expected, variable, declared, require_constant=False) -> (outcome, note)`; `check_points(points, lines, variable, variables, guard) -> (results, correct)`, where each result is `{"id", "outcome", "ftOutcome", "ftRefused", "note"}` and `guard(fn)` runs `fn` under the time limit and returns `None` on timeout or error.

In a rubric's `expected`, `{P1}` is the correct value of P1 in normal checking and the student's own value in follow-through. Rubric strings are trusted and go through `sympify`; student lines never do.

- [ ] **Step 1: Write the failing test**

Create `services/checker/tests/test_rubric.py`:

```python
import sympy as sp

from checker.equiv import RIGHT, UNCHECKED, WRONG
from checker.parse import parse_line
from checker.rubric import check_points, eval_expected, materially_easier, references

x = sp.Symbol("x")
guard = lambda fn: fn()

# Differentiate f(x) = x^3 + x^2, then give f'(2).
POINTS = [
    {"id": "P1", "type": "equivalent", "expected": "diff(x**3 + x**2, x)", "followThrough": False, "line": 1},
    {"id": "P2", "type": "exact_value", "expected": "({P1}).subs(x, 2)", "followThrough": True, "line": 2},
]


def run(l1, l2, points=POINTS):
    lines = {}
    if l1:
        lines[1] = parse_line(l1)
    if l2:
        lines[2] = parse_line(l2)
    results, _ = check_points(points, lines, "x", ["x"], guard)
    return {r["id"]: r for r in results}


def test_references_and_expected():
    assert references("({P1}).subs(x, 2) + {P2}") == ["P1", "P2"]
    assert eval_expected("({P1}).subs(x, 2)", ["x"], {"P1": 3 * x**2}) == 12


def test_all_right():
    r = run(r"f'(x) = 3x^2 + 2x", r"f'(2) = 16")
    assert r["P1"]["outcome"] == RIGHT and r["P2"]["outcome"] == RIGHT
    assert r["P2"]["ftOutcome"] is None


def test_follow_through_from_students_wrong_value():
    r = run(r"f'(x) = 3x^2 + x", r"f'(2) = 14")
    assert r["P1"]["outcome"] == WRONG
    assert r["P2"]["outcome"] == WRONG
    assert r["P2"]["ftOutcome"] == RIGHT
    assert r["P2"]["ftRefused"] is False


def test_follow_through_wrong_twice():
    r = run(r"f'(x) = 3x^2 + x", r"f'(2) = 15")
    assert r["P2"]["outcome"] == WRONG and r["P2"]["ftOutcome"] == WRONG


def test_follow_through_refused_when_materially_easier():
    r = run(r"f'(x) = 5", r"f'(2) = 5")
    assert r["P2"]["ftOutcome"] == RIGHT and r["P2"]["ftRefused"] is True


def test_unattempted_point_is_unchecked_with_no_follow_through():
    r = run(r"f'(x) = 3x^2 + 2x", None)
    assert r["P2"]["outcome"] == UNCHECKED and r["P2"]["ftOutcome"] is None


def test_materially_easier():
    assert materially_easier(sp.Integer(5), 3 * x**2 + 2 * x, [x]) is True
    assert materially_easier(3 * x**2 + x, 3 * x**2 + 2 * x, [x]) is False


def test_antiderivative_flags_missing_constant():
    pts = [{"id": "P1", "type": "antiderivative", "expected": "2*x", "followThrough": False, "requireConstant": True, "line": 1}]
    assert run(r"x^2 + C", None, pts)["P1"] == {"id": "P1", "outcome": RIGHT, "ftOutcome": None, "ftRefused": False, "note": None}
    assert run(r"x^2", None, pts)["P1"]["note"] == "missing_constant"
    assert run(r"2x^2 + C", None, pts)["P1"]["outcome"] == WRONG


def test_exact_value_decimal_is_inexact_not_wrong():
    pts = [{"id": "P1", "type": "exact_value", "expected": "Rational(1, 3)", "followThrough": False, "line": 1}]
    assert run(r"\frac{1}{3}", None, pts)["P1"]["outcome"] == RIGHT
    got = run(r"0.333", None, pts)["P1"]
    assert got["outcome"] == UNCHECKED and got["note"] == "inexact"
    assert run(r"0.5", None, pts)["P1"]["outcome"] == WRONG


def test_equation_point():
    pts = [{"id": "P1", "type": "equation", "expected": "Eq(dV_dt, 4*pi*r**2*dr_dt)", "followThrough": False, "line": 1}]
    lines = {1: parse_line(r"\frac{dV}{dt} = 4\pi r^2 \frac{dr}{dt}")}
    results, _ = check_points(pts, lines, "t", ["r", "t", "dV_dt", "dr_dt"], guard)
    assert results[0]["outcome"] == RIGHT
    lines = {1: parse_line(r"\frac{dV}{dt} = 4\pi r \frac{dr}{dt}")}
    results, _ = check_points(pts, lines, "t", ["r", "t", "dV_dt", "dr_dt"], guard)
    assert results[0]["outcome"] == WRONG


def test_antiderivative_without_require_constant_never_flags():
    pts = [{"id": "P1", "type": "antiderivative", "expected": "2*x", "followThrough": False, "line": 1}]
    assert run(r"x^2", None, pts)["P1"]["note"] is None


def test_exact_decimal_earns_the_point():
    pts = [{"id": "P1", "type": "exact_value", "expected": "Rational(15, 4)", "followThrough": False, "line": 1}]
    assert run(r"3.75", None, pts)["P1"]["outcome"] == RIGHT


def test_equivalent_matches_inside_a_limit_or_integral():
    pts = [{"id": "P1", "type": "equivalent", "expected": "x + 2", "followThrough": False, "line": 1}]
    assert run(r"\lim_{x \to 2} (x + 2)", None, pts)["P1"]["outcome"] == RIGHT
    pts = [{"id": "P1", "type": "equivalent", "expected": "cos(u)", "followThrough": False, "line": 1}]
    lines = {1: parse_line(r"\int \cos u \, du")}
    results, _ = check_points(pts, lines, "x", ["x", "u"], guard)
    assert results[0]["outcome"] == RIGHT


def test_follow_through_carries_the_expression_inside_a_limit():
    pts = [
        {"id": "P1", "type": "equivalent", "expected": "x + 2", "followThrough": False, "line": 1},
        {"id": "P2", "type": "exact_value", "expected": "limit({P1}, x, 2)", "followThrough": True, "line": 2},
    ]
    r = run(r"\lim_{x \to 2} (x - 2)", r"0", pts)
    assert r["P1"]["outcome"] == WRONG
    assert r["P2"]["ftOutcome"] == RIGHT and r["P2"]["ftRefused"] is False


def test_a_constant_of_integration_under_any_name_counts():
    pts = [{"id": "P1", "type": "antiderivative", "expected": "2*x", "followThrough": False, "requireConstant": True, "line": 1}]
    for written in (r"x^2 + c", r"x^2 + K", r"x^2 + C_1"):
        got = run(written, None, pts)["P1"]
        assert got["outcome"] == RIGHT and got["note"] is None, written
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run checker:test -- tests/test_rubric.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'checker.rubric'`.

- [ ] **Step 3: Write the implementation**

Create `services/checker/checker/rubric.py`:

```python
"""Rubric point checks, including follow-through from the student's own values."""
import re
from typing import Dict, List, Optional

import sympy as sp

from .equiv import RIGHT, UNCHECKED, WRONG, evaluate, forms, prove_any, prove_equal, prove_equation
from .parse import ParsedLine

TYPES = ("equivalent", "equation", "antiderivative", "exact_value")
_REF = re.compile(r"\{(P\d+)\}")

# Names a rubric author may use in `expected`. Rubrics are our own content and are trusted.
_NAMES = {
    name: getattr(sp, name)
    for name in (
        "diff", "integrate", "limit", "solve", "simplify", "expand", "factor", "sqrt", "sin", "cos", "tan",
        "sec", "csc", "cot", "asin", "acos", "atan", "exp", "log", "pi", "E", "oo", "Rational", "Abs", "Eq", "Symbol",
        "Limit", "Integral", "Derivative",
    )
}
_NAMES["ln"] = sp.log


def references(template: str) -> List[str]:
    return _REF.findall(template)


def eval_expected(template: str, variables: List[str], values: Dict[str, sp.Basic]) -> sp.Basic:
    names = dict(_NAMES)
    names.update({v: sp.Symbol(v) for v in variables})
    names.update(values)
    return sp.sympify(_REF.sub(r"\1", template), locals=names)


def materially_easier(student: sp.Basic, correct: sp.Basic, variables: List[sp.Symbol]) -> bool:
    """True when the student's wrong value makes the rest of the problem much simpler."""
    vs = set(variables)
    if (correct.free_symbols & vs) and not (student.free_symbols & vs):
        return True
    return sp.count_ops(student) < 0.5 * sp.count_ops(correct)


def compare(kind: str, line: ParsedLine, expected: sp.Basic, variable: sp.Symbol, declared: List[sp.Symbol],
            require_constant: bool = False):
    """Returns (outcome, note)."""
    if kind == "equivalent":
        return prove_any(line.value, expected), None
    if kind == "equation":
        if len(line.sides) < 2 or line.sides[-2] is None or not isinstance(expected, sp.Equality):
            return UNCHECKED, None
        return prove_equation(line.sides[-2], line.value, expected.lhs, expected.rhs), None
    if kind == "antiderivative":
        outcome = prove_equal(sp.diff(line.value, variable), expected)
        has_constant = bool(line.value.free_symbols - set(declared))
        return outcome, ("missing_constant" if require_constant and outcome == RIGHT and not has_constant else None)
    if kind == "exact_value":
        value = evaluate(line.value)
        if value.atoms(sp.Float):
            # 3.75 is exactly 15/4 and earns the point; 0.333 for 1/3 is only close.
            if prove_equal(sp.nsimplify(value, rational=True), expected) == RIGHT:
                return RIGHT, None
            try:
                got, want = float(sp.N(value)), float(sp.N(evaluate(expected)))
            except Exception:
                return UNCHECKED, None
            if abs(got - want) <= 0.005 * max(1.0, abs(want)):
                return UNCHECKED, "inexact"
            return WRONG, None
        return prove_equal(value, expected), None
    return UNCHECKED, None


def correct_value(kind: str, expected: sp.Basic, variable: sp.Symbol) -> sp.Basic:
    """What a later point sees as this point's value when the student got it right."""
    if kind == "antiderivative":
        return sp.integrate(expected, variable)
    if kind == "equation" and isinstance(expected, sp.Equality):
        return expected.rhs
    return expected


def check_points(points: List[dict], lines: Dict[int, ParsedLine], variable: str, variables: List[str], guard):
    """`guard(fn)` runs fn under the per-check time limit and returns None on timeout or error."""
    var = sp.Symbol(variable)
    declared = [sp.Symbol(v) for v in variables]
    correct: Dict[str, sp.Basic] = {}
    student: Dict[str, sp.Basic] = {}
    outcomes: Dict[str, str] = {}
    results = []
    for p in points:
        pid, kind, template = p["id"], p["type"], p["expected"]
        line: Optional[ParsedLine] = lines.get(p.get("line")) if p.get("line") is not None else None
        result = {"id": pid, "outcome": UNCHECKED, "ftOutcome": None, "ftRefused": False, "note": None}
        expected = guard(lambda: eval_expected(template, variables, correct))
        if expected is not None:
            value = guard(lambda: correct_value(kind, expected, var))
            if value is not None:
                correct[pid] = value
        if line is not None and expected is not None:
            # Carry the expression itself, not the limit or integral sign around it.
            student[pid] = forms(line.value)[-1]
            got = guard(lambda: compare(kind, line, expected, var, declared, bool(p.get("requireConstant"))))
            if got is not None:
                result["outcome"], result["note"] = got
            if result["outcome"] != RIGHT and p.get("followThrough"):
                deps = [d for d in references(template) if d in student and outcomes.get(d) != RIGHT]
                if deps and all(d in correct for d in references(template)):
                    carried = dict(correct)
                    carried.update({d: student[d] for d in deps})
                    ft_expected = guard(lambda: eval_expected(template, variables, carried))
                    if ft_expected is not None:
                        ft = guard(lambda: compare(kind, line, ft_expected, var, declared))
                        result["ftOutcome"] = ft[0] if ft is not None else UNCHECKED
                    else:
                        result["ftOutcome"] = UNCHECKED
                    easier = guard(lambda: any(materially_easier(student[d], correct[d], declared) for d in deps))
                    result["ftRefused"] = bool(easier)
        outcomes[pid] = result["outcome"]
        results.append(result)
    return results, correct
```

- [ ] **Step 4: Run the test**

Run: `npm run checker:test -- tests/test_rubric.py`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add services/checker/checker/rubric.py services/checker/tests/test_rubric.py
git commit -m "Add rubric point checks and follow-through to the checker"
```

---

### Task 6: Checker service: time-limited runner, HTTP API and container

**Files:**
- Create: `services/checker/checker/runner.py`, `services/checker/checker/app.py`, `services/checker/Dockerfile`, `services/checker/.dockerignore`
- Modify: `.env.example`
- Test: `services/checker/tests/test_runner.py`, `services/checker/tests/test_app.py`

**Interfaces:**
- Consumes: `parse_line`, `ParseError`, `ParsedLine`; `check_transition`, `KINDS`; `check_points`, `compare`, `eval_expected`, `TYPES`; `UNCHECKED`.
- Produces: `run_check(req: dict, seconds=5) -> dict`; `run_in_child(req: dict, seconds=5) -> Optional[dict]`; HTTP `GET /health` returning `{"ok": true}`; HTTP `POST /check` taking the `CheckRequest` JSON of `lib/engine/types.ts` and returning its `CheckResponse`. Status codes: 401 bad secret, 503 secret not configured, 422 unknown kind or type, 504 the child did not finish.

`SIGALRM` only works in a process's main thread, and FastAPI runs handlers in worker threads, so each request's checks run in a forked child whose main thread carries the alarm. The parent kills the child if it overruns 45 seconds.

- [ ] **Step 1: Write the failing tests**

Create `services/checker/tests/test_runner.py`:

```python
import time

from checker.runner import _guard, run_check, run_in_child

REQ = {
    "variable": "x",
    "variables": ["x"],
    "given": "x**3 + x**2",
    "lines": [{"n": 1, "latex": r"f'(x) = 3x^2 + 2x"}, {"n": 2, "latex": r"f'(2) = 16"}],
    "transitions": [
        {"to": 1, "kind": "differentiate", "substitution": None},
        {"to": 2, "kind": "substitute", "substitution": {"variable": "x", "latex": "2"}},
    ],
    "points": [
        {"id": "P1", "type": "equivalent", "expected": "diff(x**3 + x**2, x)", "followThrough": False, "line": 1},
        {"id": "P2", "type": "exact_value", "expected": "({P1}).subs(x, 2)", "followThrough": True, "line": 2},
    ],
    "finalPoint": "P2",
}


def test_full_problem():
    out = run_check(REQ)
    assert out["lines"] == [{"n": 1, "parsed": True}, {"n": 2, "parsed": True}]
    assert [t["outcome"] for t in out["transitions"]] == ["right", "right"]
    assert [p["outcome"] for p in out["points"]] == ["right", "right"]
    assert out["final"] == "right"


def test_unparseable_line_is_reported_and_its_checks_are_unchecked():
    req = dict(REQ, lines=[{"n": 1, "latex": r"f'(x) = 3x^2 + 2x"}, {"n": 2, "latex": r"\text{sixteen}"}])
    out = run_check(req)
    assert out["lines"][1] == {"n": 2, "parsed": False}
    assert out["transitions"][1]["outcome"] == "unchecked"
    assert out["points"][1]["outcome"] == "unchecked"
    assert out["final"] == "unchecked"


def test_guard_times_out():
    start = time.time()
    assert _guard(lambda: time.sleep(10), 1) is None
    assert time.time() - start < 3


def test_child_process_returns_the_same_result():
    assert run_in_child(REQ) == run_check(REQ)


def test_words_between_lines_do_not_break_the_chain():
    req = dict(REQ, lines=[REQ["lines"][0], {"n": 2, "latex": r"\text{now put in 2}"}, {"n": 3, "latex": r"f'(2) = 16"}],
               transitions=[REQ["transitions"][0], {"to": 2, "kind": "unknown", "substitution": None},
                            {"to": 3, "kind": "substitute", "substitution": {"variable": "x", "latex": "2"}}],
               points=[REQ["points"][0], dict(REQ["points"][1], line=3)])
    out = run_check(req)
    assert [t["outcome"] for t in out["transitions"]] == ["right", "unchecked", "right"]
    assert out["final"] == "right"


def test_a_line_with_a_huge_number_is_dropped_quickly_and_the_rest_is_still_checked():
    req = dict(REQ, lines=[REQ["lines"][0], {"n": 2, "latex": r"9^{9^{9}}"}, {"n": 3, "latex": r"f'(2) = 16"}],
               transitions=[REQ["transitions"][0], {"to": 2, "kind": "rewrite", "substitution": None},
                            {"to": 3, "kind": "substitute", "substitution": {"variable": "x", "latex": "2"}}],
               points=[REQ["points"][0], dict(REQ["points"][1], line=3)])
    start = time.time()
    out = run_in_child(req)
    assert time.time() - start < 10
    assert out["lines"][1] == {"n": 2, "parsed": False}
    assert [p["outcome"] for p in out["points"]] == ["right", "right"]
```

Create `services/checker/tests/test_app.py`:

```python
from fastapi.testclient import TestClient

from checker.app import app
from tests.test_runner import REQ

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"ok": True}


def test_refuses_when_secret_is_not_configured(monkeypatch):
    monkeypatch.delenv("CHECKER_SECRET", raising=False)
    assert client.post("/check", json=REQ).status_code == 503


def test_refuses_wrong_secret(monkeypatch):
    monkeypatch.setenv("CHECKER_SECRET", "s3cret")
    assert client.post("/check", json=REQ, headers={"x-checker-secret": "nope"}).status_code == 401
    assert client.post("/check", json=REQ).status_code == 401


def test_checks_with_secret(monkeypatch):
    monkeypatch.setenv("CHECKER_SECRET", "s3cret")
    r = client.post("/check", json=REQ, headers={"x-checker-secret": "s3cret"})
    assert r.status_code == 200
    assert r.json()["final"] == "right"


def test_rejects_unknown_kinds(monkeypatch):
    monkeypatch.setenv("CHECKER_SECRET", "s3cret")
    bad = dict(REQ, transitions=[{"to": 1, "kind": "teleport", "substitution": None}])
    assert client.post("/check", json=bad, headers={"x-checker-secret": "s3cret"}).status_code == 422
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run checker:test -- tests/test_runner.py tests/test_app.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'checker.runner'`.

- [ ] **Step 3: Write the implementation**

Create `services/checker/checker/runner.py`:

```python
"""Runs one problem's checks in a child process with a time limit on each check."""
import multiprocessing
import signal
from typing import Dict

import sympy as sp

from .equiv import UNCHECKED
from .parse import ParsedLine, ParseError, parse_line
from .rubric import check_points, compare
from .transitions import check_transition

CHECK_SECONDS = 5


class _Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise _Timeout()


def _guard(fn, seconds: int = CHECK_SECONDS):
    """Run fn; None on timeout or any error. Only valid in a process's main thread."""
    signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(seconds)
    try:
        return fn()
    except _Timeout:
        return None
    except Exception:
        return None
    finally:
        signal.alarm(0)


def run_check(req: dict, seconds: int = CHECK_SECONDS) -> dict:
    guard = lambda fn: _guard(fn, seconds)
    var = sp.Symbol(req["variable"])
    parsed: Dict[int, ParsedLine] = {}
    line_out = []
    for ln in req["lines"]:
        def parse(ln=ln):
            try:
                return parse_line(ln["latex"], req["variables"])
            except ParseError:
                return None
        p = guard(parse)
        if p is not None:
            parsed[ln["n"]] = p
        line_out.append({"n": ln["n"], "parsed": p is not None})

    given = None
    if req.get("given"):
        from .rubric import eval_expected
        g = guard(lambda: eval_expected(req["given"], req["variables"], {}))
        if g is not None:
            given = ParsedLine([g])

    order = [ln["n"] for ln in req["lines"]]
    trans_out = []
    for t in req["transitions"]:
        to = t["to"]
        idx = order.index(to) if to in order else -1
        # The line above may be words. Compare with the nearest parsed line above, or the question itself.
        earlier = [parsed[n] for n in order[:max(idx, 0)] if n in parsed]
        prev = (earlier[-1] if earlier else given) if idx >= 0 else None
        cur = parsed.get(to)
        outcome = UNCHECKED
        if prev is not None and cur is not None:
            sub = None
            if t.get("substitution"):
                s = t["substitution"]
                def parse_sub(s=s):
                    try:
                        return {sp.Symbol(s["variable"]): parse_line(s["latex"]).value}
                    except ParseError:
                        return None
                sub = guard(parse_sub)
            got = guard(lambda: check_transition(t["kind"], prev, cur, var, sub))
            outcome = got if got is not None else UNCHECKED
        trans_out.append({"to": to, "outcome": outcome})

    points, correct = check_points(req["points"], parsed, req["variable"], req["variables"], guard)

    final = UNCHECKED
    last = next((parsed[n] for n in reversed(order) if n in parsed), None)
    fp = next((p for p in req["points"] if p["id"] == req.get("finalPoint")), None)
    if last is not None and fp is not None and order and order[-1] in parsed:
        from .rubric import eval_expected
        declared = [sp.Symbol(v) for v in req["variables"]]
        def final_check():
            # `correct` holds each point's value; rebuild this point's expected from the earlier ones.
            expected = eval_expected(fp["expected"], req["variables"], correct)
            return compare(fp["type"], last, expected, var, declared)[0]
        got = guard(final_check)
        final = got if got is not None else UNCHECKED
    return {"lines": line_out, "transitions": trans_out, "points": points, "final": final}


def _child(conn, req, seconds):
    try:
        conn.send(run_check(req, seconds))
    except Exception:
        conn.send(None)
    finally:
        conn.close()


def run_in_child(req: dict, seconds: int = CHECK_SECONDS):
    """Returns the result dict, or None if the child died or overran its total budget."""
    ctx = multiprocessing.get_context("fork")
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(child, req, seconds), daemon=True)
    proc.start()
    child.close()
    checks = len(req["lines"]) + len(req["transitions"]) + 4 * len(req["points"]) + 2
    # One request never holds a worker for more than 45 seconds, however many checks it has.
    budget = min(45, seconds * checks + 5)
    result = parent.recv() if parent.poll(budget) else None
    proc.join(1)
    if proc.is_alive():
        proc.kill()
    return result
```

Create `services/checker/checker/app.py`:

```python
import hmac
import os
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .rubric import TYPES
from .runner import run_in_child
from .transitions import KINDS

app = FastAPI()


class Line(BaseModel):
    n: int
    latex: str = Field(max_length=400)


class Substitution(BaseModel):
    variable: str = Field(pattern=r"^[A-Za-z]$")
    latex: str = Field(max_length=100)


class Transition(BaseModel):
    to: int
    kind: str
    substitution: Optional[Substitution] = None


class Point(BaseModel):
    id: str = Field(pattern=r"^P\d+$")
    type: str
    expected: str
    followThrough: bool = False
    requireConstant: bool = False
    line: Optional[int] = None


class CheckRequest(BaseModel):
    variable: str
    variables: List[str]
    given: Optional[str] = None
    lines: List[Line] = Field(max_length=60)
    transitions: List[Transition] = Field(max_length=60)
    points: List[Point] = Field(max_length=20)
    finalPoint: Optional[str] = None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/check")
def check(req: CheckRequest, x_checker_secret: Optional[str] = Header(default=None)):
    secret = os.environ.get("CHECKER_SECRET", "")
    if not secret:
        raise HTTPException(503, "CHECKER_SECRET is not set")
    if not hmac.compare_digest(secret.encode(), (x_checker_secret or "").encode()):
        raise HTTPException(401, "bad secret")
    for t in req.transitions:
        if t.kind not in KINDS:
            raise HTTPException(422, "unknown transition kind")
    for p in req.points:
        if p.type not in TYPES:
            raise HTTPException(422, "unknown check type")
    result = run_in_child(req.model_dump())
    if result is None:
        raise HTTPException(504, "check did not finish")
    return result
```

Create `services/checker/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY checker ./checker
ENV PORT=8000
# Railway's private network is IPv6, so listen on :: rather than 0.0.0.0.
CMD ["sh", "-c", "uvicorn checker.app:app --host :: --port ${PORT} --workers 2"]
```

Create `services/checker/.dockerignore`:

```text
.venv
tests
__pycache__
.pytest_cache
```

Append to `.env.example`:

```
# The marking engine's private SymPy service (services/checker). Locally: npm run checker:dev
CHECKER_URL=http://127.0.0.1:8000
CHECKER_SECRET=dev
CHECKER_TIMEOUT_MS=60000
# Engine model per role; each falls back to MARK_MODEL_OPENAI or TUTOR_MODEL for the provider in use.
ENGINE_MODEL_READER=
ENGINE_MODEL_MATCHER=
ENGINE_MODEL_JUDGE=
ENGINE_EFFORT=low
ENGINE_TIMEOUT_MS=60000
```

- [ ] **Step 4: Run the whole checker suite**

Run: `npm run checker:test`
Expected: 83 passed.

- [ ] **Step 5: Start the service and call it**

Run in one terminal: `npm run checker:dev`
Run in another: `curl -s http://127.0.0.1:8000/health`
Expected: `{"ok":true}`. Leave the service running for Tasks 10 and 16.

- [ ] **Step 6: Run the existing suite (the env example is covered by a test)**

Run: `npm test`
Expected: 0 fail.

- [ ] **Step 7: Commit**

```bash
git add services/checker/checker/runner.py services/checker/checker/app.py services/checker/Dockerfile services/checker/.dockerignore services/checker/tests/test_runner.py services/checker/tests/test_app.py .env.example
git commit -m "Add the checker's time-limited runner, HTTP API and container"
```

---

### Task 7: Seed question bank

**Files:**
- Create: `content/calc1/questions.json`, `content/calc1/questions.ts`
- Test: `tests/engine-questions.test.ts`

**Interfaces:**
- Consumes: `parseQuestion`, `TOPICS`; `Question`, `TransitionKind`.
- Produces: `ModelLine { latex; kind: TransitionKind; point: string | null; sub: { variable; latex } | null; words: boolean }`; `SeedQuestion = Question & { model: ModelLine[] }`; `CALC1_QUESTIONS: SeedQuestion[]` (32 questions, 91 points); `getCalc1Question(id: unknown): SeedQuestion | undefined`.

Each question carries a model solution with the alignment a perfect matcher would give. Task 10 runs every one through the real checker, so a rubric that cannot recognise its own correct answer fails there. Rubric conventions the JSON follows: the last point of a rubric is the answer point; a limit question's `given` is an unevaluated `Limit(...)` and an integral's is `Integral(...)`; related-rates unknowns are symbols named `dV_dt`, which is what the parser turns `\frac{dV}{dt}` into.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-questions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALC1_QUESTIONS, getCalc1Question } from '@/content/calc1/questions';
import { TOPICS } from '@/lib/engine/rubric';

test('seed bank: about 30 questions, every topic covered, unique ids, model lines point at real points', () => {
  assert.ok(CALC1_QUESTIONS.length >= 30);
  assert.equal(new Set(CALC1_QUESTIONS.map((q) => q.id)).size, CALC1_QUESTIONS.length);
  for (const t of TOPICS) assert.ok(CALC1_QUESTIONS.some((q) => q.topic === t), `no question for ${t}`);
  for (const q of CALC1_QUESTIONS) {
    assert.ok(q.model.length > 0, q.id);
    const ids = new Set(q.points.map((p) => p.id));
    for (const l of q.model) assert.ok(l.point === null || ids.has(l.point), `${q.id}: model line points at ${l.point}`);
    // The model solution attempts every point.
    for (const p of q.points) assert.ok(q.model.some((l) => l.point === p.id), `${q.id}: model solution never attempts ${p.id}`);
  }
  assert.equal(getCalc1Question('der-chain')?.topic, 'derivatives');
  assert.equal(getCalc1Question('nope'), undefined);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-questions.test.ts`
Expected: FAIL, cannot find module `@/content/calc1/questions`.

- [ ] **Step 3: Write the data and the loader**

Create `content/calc1/questions.json`:

```json
[
 {
  "id": "lim-factor",
  "topic": "limits",
  "prompt": "Evaluate \\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}.",
  "variable": "x",
  "variables": ["x"],
  "given": "Limit((x**2 - 4)/(x - 2), x, 2)",
  "answer": "4",
  "points": [
   {"id": "P1", "label": "Cancels the common factor", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "x + 2"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Limit value", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "limit({P1}, x, 2)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "\\lim_{x \\to 2} \\frac{(x-2)(x+2)}{x-2}", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "= \\lim_{x \\to 2} (x+2)", "kind": "rewrite", "point": "P1", "sub": null, "words": false},
   {"latex": "= 4", "kind": "take_limit", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "lim-sin",
  "topic": "limits",
  "prompt": "Evaluate \\lim_{x \\to 0} \\frac{\\sin(3x)}{x}.",
  "variable": "x",
  "variables": ["x"],
  "given": "Limit(sin(3*x)/x, x, 0)",
  "answer": "3",
  "points": [
   {"id": "P1", "label": "Differentiates top and bottom (L'Hopital)", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "3*cos(3*x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Limit value", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "3"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\lim_{x \\to 0} \\frac{\\sin(3x)}{x}", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "= \\lim_{x \\to 0} \\frac{3\\cos(3x)}{1}", "kind": "rewrite", "point": "P1", "sub": null, "words": false},
   {"latex": "= 3", "kind": "take_limit", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "lim-infinity",
  "topic": "limits",
  "prompt": "Evaluate \\lim_{x \\to \\infty} \\frac{3x^2 + 2x}{x^2 - 5}.",
  "variable": "x",
  "variables": ["x"],
  "given": "Limit((3*x**2 + 2*x)/(x**2 - 5), x, oo)",
  "answer": "3",
  "points": [
   {"id": "P1", "label": "Divides through by the highest power", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "(3 + 2/x)/(1 - 5/x**2)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Limit value", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "3"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\lim_{x \\to \\infty} \\frac{3 + \\frac{2}{x}}{1 - \\frac{5}{x^2}}", "kind": "rewrite", "point": "P1", "sub": null, "words": false},
   {"latex": "= 3", "kind": "take_limit", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "lim-conjugate",
  "topic": "limits",
  "prompt": "Evaluate \\lim_{x \\to 3} \\frac{\\sqrt{x+1} - 2}{x - 3}.",
  "variable": "x",
  "variables": ["x"],
  "given": "Limit((sqrt(x + 1) - 2)/(x - 3), x, 3)",
  "answer": "Rational(1, 4)",
  "points": [
   {"id": "P1", "label": "Simplifies using the conjugate", "value": 2, "kind": "cas", "check": {"type": "equivalent", "expected": "1/(sqrt(x + 1) + 2)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Limit value", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "limit({P1}, x, 3)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "\\lim_{x \\to 3} \\frac{(\\sqrt{x+1}-2)(\\sqrt{x+1}+2)}{(x-3)(\\sqrt{x+1}+2)}", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "= \\lim_{x \\to 3} \\frac{1}{\\sqrt{x+1}+2}", "kind": "rewrite", "point": "P1", "sub": null, "words": false},
   {"latex": "= \\frac{1}{4}", "kind": "take_limit", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "lim-continuity",
  "topic": "limits",
  "prompt": "f(x) = x^2 + k for x < 1 and f(x) = 3x for x \\ge 1. Find k so that f is continuous at x = 1.",
  "variable": "x",
  "variables": ["x", "k"],
  "answer": "2",
  "points": [
   {"id": "P1", "label": "States the condition for continuity", "value": 1, "kind": "judge", "criterion": "States that the left-hand and right-hand limits at x = 1 must be equal", "requires": [], "followThrough": false},
   {"id": "P2", "label": "Sets the two sides equal at x = 1", "value": 1, "kind": "cas", "check": {"type": "equation", "expected": "Eq(1 + k, 3)"}, "requires": [], "followThrough": false},
   {"id": "P3", "label": "Value of k", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "2"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\text{left limit must equal right limit at } x = 1", "kind": "unknown", "point": "P1", "sub": null, "words": true},
   {"latex": "1 + k = 3", "kind": "unknown", "point": "P2", "sub": null, "words": false},
   {"latex": "k = 2", "kind": "rewrite", "point": "P3", "sub": null, "words": false}
  ]
 },
 {
  "id": "der-power-eval",
  "topic": "derivatives",
  "prompt": "f(x) = x^3 + x^2. Find f'(2).",
  "variable": "x",
  "variables": ["x"],
  "given": "x**3 + x**2",
  "answer": "16",
  "points": [
   {"id": "P1", "label": "Differentiates", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "diff(x**3 + x**2, x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Evaluates at x = 2", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, 2)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "f'(x) = 3x^2 + 2x", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "f'(2) = 16", "kind": "substitute", "point": "P2", "sub": {"variable": "x", "latex": "2"}, "words": false}
  ]
 },
 {
  "id": "der-product",
  "topic": "derivatives",
  "prompt": "Differentiate y = x^2 \\sin x.",
  "variable": "x",
  "variables": ["x"],
  "given": "x**2*sin(x)",
  "answer": "2*x*sin(x) + x**2*cos(x)",
  "points": [
   {"id": "P1", "label": "Product rule applied correctly", "value": 2, "kind": "cas", "check": {"type": "equivalent", "expected": "diff(x**2*sin(x), x)"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\frac{dy}{dx} = 2x \\sin x + x^2 \\cos x", "kind": "differentiate", "point": "P1", "sub": null, "words": false}
  ]
 },
 {
  "id": "der-quotient",
  "topic": "derivatives",
  "prompt": "Differentiate y = \\frac{x^2 + 1}{x - 1}.",
  "variable": "x",
  "variables": ["x"],
  "given": "(x**2 + 1)/(x - 1)",
  "answer": "(x**2 - 2*x - 1)/(x - 1)**2",
  "points": [
   {"id": "P1", "label": "Quotient rule applied correctly", "value": 2, "kind": "cas", "check": {"type": "equivalent", "expected": "diff((x**2 + 1)/(x - 1), x)"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\frac{dy}{dx} = \\frac{2x(x-1) - (x^2+1)}{(x-1)^2}", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "= \\frac{x^2 - 2x - 1}{(x-1)^2}", "kind": "rewrite", "point": null, "sub": null, "words": false}
  ]
 },
 {
  "id": "der-chain",
  "topic": "derivatives",
  "prompt": "Differentiate y = \\sin(x^2).",
  "variable": "x",
  "variables": ["x"],
  "given": "sin(x**2)",
  "answer": "2*x*cos(x**2)",
  "points": [
   {"id": "P1", "label": "Chain rule applied correctly", "value": 2, "kind": "cas", "check": {"type": "equivalent", "expected": "diff(sin(x**2), x)"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\frac{dy}{dx} = 2x\\cos(x^2)", "kind": "differentiate", "point": "P1", "sub": null, "words": false}
  ]
 },
 {
  "id": "der-chain-eval",
  "topic": "derivatives",
  "prompt": "y = (3x + 1)^4. Find \\frac{dy}{dx} at x = 0.",
  "variable": "x",
  "variables": ["x"],
  "given": "(3*x + 1)**4",
  "answer": "12",
  "points": [
   {"id": "P1", "label": "Chain rule", "value": 2, "kind": "cas", "check": {"type": "equivalent", "expected": "diff((3*x + 1)**4, x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Evaluates at x = 0", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, 0)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "\\frac{dy}{dx} = 12(3x+1)^3", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "12(1)^3 = 12", "kind": "substitute", "point": "P2", "sub": {"variable": "x", "latex": "0"}, "words": false}
  ]
 },
 {
  "id": "der-implicit",
  "topic": "derivatives",
  "prompt": "x^2 + y^2 = 25. Find \\frac{dy}{dx} at the point (3, 4).",
  "variable": "x",
  "variables": ["x", "y", "dy_dx"],
  "answer": "Rational(-3, 4)",
  "points": [
   {"id": "P1", "label": "Differentiates both sides implicitly", "value": 2, "kind": "cas", "check": {"type": "equation", "expected": "Eq(2*x + 2*y*dy_dx, 0)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Solves for dy/dx", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "-x/y"}, "requires": [], "followThrough": false},
   {"id": "P3", "label": "Evaluates at (3, 4)", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P2}).subs(x, 3).subs(y, 4)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "2x + 2y\\frac{dy}{dx} = 0", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "\\frac{dy}{dx} = -\\frac{x}{y}", "kind": "rewrite", "point": "P2", "sub": null, "words": false},
   {"latex": "= -\\frac{3}{4}", "kind": "substitute", "point": "P3", "sub": null, "words": false}
  ]
 },
 {
  "id": "der-tangent",
  "topic": "derivatives",
  "prompt": "Find the equation of the tangent line to f(x) = x^2 - 3x at x = 2.",
  "variable": "x",
  "variables": ["x"],
  "given": "x**2 - 3*x",
  "answer": "x - 4",
  "points": [
   {"id": "P1", "label": "Differentiates", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "diff(x**2 - 3*x, x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Slope at x = 2", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, 2)"}, "requires": [], "followThrough": true},
   {"id": "P3", "label": "Tangent line", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "{P2}*(x - 2) - 2"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "f'(x) = 2x - 3", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "f'(2) = 1", "kind": "substitute", "point": "P2", "sub": {"variable": "x", "latex": "2"}, "words": false},
   {"latex": "y = 1(x - 2) - 2", "kind": "unknown", "point": "P3", "sub": null, "words": false},
   {"latex": "y = x - 4", "kind": "rewrite", "point": null, "sub": null, "words": false}
  ]
 },
 {
  "id": "der-exp-log",
  "topic": "derivatives",
  "prompt": "Differentiate y = e^{2x} \\ln x.",
  "variable": "x",
  "variables": ["x"],
  "given": "exp(2*x)*log(x)",
  "answer": "2*exp(2*x)*log(x) + exp(2*x)/x",
  "points": [
   {"id": "P1", "label": "Product and chain rules applied correctly", "value": 2, "kind": "cas", "check": {"type": "equivalent", "expected": "diff(exp(2*x)*log(x), x)"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\frac{dy}{dx} = 2e^{2x}\\ln x + \\frac{e^{2x}}{x}", "kind": "differentiate", "point": "P1", "sub": null, "words": false}
  ]
 },
 {
  "id": "rr-sphere",
  "topic": "related_rates",
  "prompt": "A sphere's radius grows at 2 cm/s. How fast is its volume growing when r = 3 cm? (V = \\frac{4}{3}\\pi r^3)",
  "variable": "t",
  "variables": ["r", "t", "dV_dt", "dr_dt"],
  "answer": "72*pi",
  "points": [
   {"id": "P1", "label": "Differentiates V with respect to t", "value": 2, "kind": "cas", "check": {"type": "equation", "expected": "Eq(dV_dt, 4*pi*r**2*dr_dt)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Substitutes r = 3 and dr/dt = 2", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(r, 3).subs(dr_dt, 2)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "\\frac{dV}{dt} = 4\\pi r^2 \\frac{dr}{dt}", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "= 4\\pi (3)^2 (2)", "kind": "substitute", "point": null, "sub": null, "words": false},
   {"latex": "= 72\\pi", "kind": "rewrite", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "rr-ladder",
  "topic": "related_rates",
  "prompt": "A 10 ft ladder leans on a wall. Its foot slides away at 1 ft/s. How fast is the top moving when the foot is 6 ft from the wall?",
  "variable": "t",
  "variables": ["x", "y", "t", "dx_dt", "dy_dt"],
  "answer": "Rational(-3, 4)",
  "points": [
   {"id": "P1", "label": "Relates x and y", "value": 1, "kind": "cas", "check": {"type": "equation", "expected": "Eq(x**2 + y**2, 100)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Differentiates with respect to t", "value": 2, "kind": "cas", "check": {"type": "equation", "expected": "Eq(2*x*dx_dt + 2*y*dy_dt, 0)"}, "requires": [], "followThrough": false},
   {"id": "P3", "label": "Rate of the top", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "Rational(-3, 4)"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "x^2 + y^2 = 100", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "2x\\frac{dx}{dt} + 2y\\frac{dy}{dt} = 0", "kind": "differentiate", "point": "P2", "sub": null, "words": false},
   {"latex": "2(6)(1) + 2(8)\\frac{dy}{dt} = 0", "kind": "substitute", "point": null, "sub": null, "words": false},
   {"latex": "\\frac{dy}{dt} = -\\frac{3}{4}", "kind": "rewrite", "point": "P3", "sub": null, "words": false}
  ]
 },
 {
  "id": "rr-circle",
  "topic": "related_rates",
  "prompt": "A circle's radius grows at 3 cm/s. How fast is its area growing when r = 5 cm?",
  "variable": "t",
  "variables": ["r", "t", "dA_dt", "dr_dt"],
  "answer": "30*pi",
  "points": [
   {"id": "P1", "label": "Differentiates A with respect to t", "value": 2, "kind": "cas", "check": {"type": "equation", "expected": "Eq(dA_dt, 2*pi*r*dr_dt)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Substitutes r = 5 and dr/dt = 3", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(r, 5).subs(dr_dt, 3)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "A = \\pi r^2", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "\\frac{dA}{dt} = 2\\pi r \\frac{dr}{dt}", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "= 2\\pi(5)(3) = 30\\pi", "kind": "substitute", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "opt-rectangle",
  "topic": "optimisation",
  "prompt": "A rectangle has perimeter 40. Find the largest possible area.",
  "variable": "x",
  "variables": ["x"],
  "answer": "100",
  "points": [
   {"id": "P1", "label": "Area in one variable", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "x*(20 - x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Differentiates the area", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "diff({P1}, x)"}, "requires": [], "followThrough": true},
   {"id": "P3", "label": "Critical point", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "solve(diff({P1}, x), x)[0]"}, "requires": [], "followThrough": true},
   {"id": "P4", "label": "Justifies that it is a maximum", "value": 1, "kind": "judge", "criterion": "Justifies the maximum, for example the second derivative is negative or the derivative changes sign from positive to negative", "requires": [], "followThrough": false},
   {"id": "P5", "label": "Largest area", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, {P3})"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "A = x(20 - x)", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "A' = 20 - 2x", "kind": "differentiate", "point": "P2", "sub": null, "words": false},
   {"latex": "x = 10", "kind": "unknown", "point": "P3", "sub": null, "words": false},
   {"latex": "\\text{second derivative is } -2 \\text{, negative, so maximum}", "kind": "unknown", "point": "P4", "sub": null, "words": true},
   {"latex": "A = 10(10) = 100", "kind": "unknown", "point": "P5", "sub": null, "words": false}
  ]
 },
 {
  "id": "opt-sum",
  "topic": "optimisation",
  "prompt": "Find the minimum value of f(x) = x + \\frac{4}{x} for x > 0.",
  "variable": "x",
  "variables": ["x"],
  "given": "x + 4/x",
  "answer": "4",
  "points": [
   {"id": "P1", "label": "Differentiates", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "diff(x + 4/x, x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Critical point in the domain", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "2"}, "requires": [], "followThrough": false},
   {"id": "P3", "label": "Minimum value", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P2}) + 4/({P2})"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "f'(x) = 1 - \\frac{4}{x^2}", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "x = 2", "kind": "unknown", "point": "P2", "sub": null, "words": false},
   {"latex": "f(2) = 2 + \\frac{4}{2} = 4", "kind": "unknown", "point": "P3", "sub": null, "words": false}
  ]
 },
 {
  "id": "opt-box",
  "topic": "optimisation",
  "prompt": "Squares of side x are cut from the corners of a 12 by 12 sheet and the sides folded up. Find the largest volume of the open box.",
  "variable": "x",
  "variables": ["x"],
  "answer": "128",
  "points": [
   {"id": "P1", "label": "Volume in one variable", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "x*(12 - 2*x)**2"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Differentiates the volume", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "diff({P1}, x)"}, "requires": [], "followThrough": true},
   {"id": "P3", "label": "Critical point in the domain", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "2"}, "requires": [], "followThrough": false},
   {"id": "P4", "label": "Largest volume", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, {P3})"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "V = x(12 - 2x)^2", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "V' = (12-2x)^2 - 4x(12-2x)", "kind": "differentiate", "point": "P2", "sub": null, "words": false},
   {"latex": "x = 2", "kind": "unknown", "point": "P3", "sub": null, "words": false},
   {"latex": "V = 2(8)^2 = 128", "kind": "unknown", "point": "P4", "sub": null, "words": false}
  ]
 },
 {
  "id": "mvt-quadratic",
  "topic": "mvt",
  "prompt": "Find the value c guaranteed by the Mean Value Theorem for f(x) = x^2 on [1, 3].",
  "variable": "x",
  "variables": ["x", "c"],
  "answer": "2",
  "points": [
   {"id": "P1", "label": "States the hypotheses", "value": 1, "kind": "judge", "criterion": "States that f is continuous on [1, 3] and differentiable on (1, 3)", "requires": [], "followThrough": false},
   {"id": "P2", "label": "Average rate of change", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "(3**2 - 1**2)/(3 - 1)"}, "requires": [], "followThrough": false},
   {"id": "P3", "label": "Sets f'(c) equal to it", "value": 1, "kind": "cas", "check": {"type": "equation", "expected": "Eq(2*c, {P2})"}, "requires": [], "followThrough": true},
   {"id": "P4", "label": "Value of c", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "{P2}/2"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "\\text{f is continuous on [1,3] and differentiable on (1,3)}", "kind": "unknown", "point": "P1", "sub": null, "words": true},
   {"latex": "\\frac{9 - 1}{3 - 1} = 4", "kind": "unknown", "point": "P2", "sub": null, "words": false},
   {"latex": "2c = 4", "kind": "unknown", "point": "P3", "sub": null, "words": false},
   {"latex": "c = 2", "kind": "rewrite", "point": "P4", "sub": null, "words": false}
  ]
 },
 {
  "id": "mvt-cubic",
  "topic": "mvt",
  "prompt": "Find the value c in (0, 2) guaranteed by the Mean Value Theorem for f(x) = x^3 - x on [0, 2].",
  "variable": "x",
  "variables": ["x", "c"],
  "answer": "2*sqrt(3)/3",
  "points": [
   {"id": "P1", "label": "Average rate of change", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "((2**3 - 2) - 0)/(2 - 0)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Sets f'(c) equal to it", "value": 1, "kind": "cas", "check": {"type": "equation", "expected": "Eq(3*c**2 - 1, {P1})"}, "requires": [], "followThrough": true},
   {"id": "P3", "label": "Value of c in the interval", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "2*sqrt(3)/3"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\frac{6 - 0}{2 - 0} = 3", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "3c^2 - 1 = 3", "kind": "unknown", "point": "P2", "sub": null, "words": false},
   {"latex": "c^2 = \\frac{4}{3}", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "c = \\frac{2}{\\sqrt{3}}", "kind": "unknown", "point": "P3", "sub": null, "words": false}
  ]
 },
 {
  "id": "riemann-right",
  "topic": "riemann",
  "prompt": "Estimate \\int_0^2 x^2 \\, dx with a right Riemann sum using 4 equal subintervals.",
  "variable": "x",
  "variables": ["x"],
  "answer": "Rational(15, 4)",
  "points": [
   {"id": "P1", "label": "Width of each subinterval", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "Rational(1, 2)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Value of the sum", "value": 2, "kind": "cas", "check": {"type": "exact_value", "expected": "Rational(15, 4)"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\Delta x = \\frac{2 - 0}{4} = \\frac{1}{2}", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "\\frac{1}{2}\\left(\\frac{1}{4} + 1 + \\frac{9}{4} + 4\\right)", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "= \\frac{15}{4}", "kind": "rewrite", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "riemann-left",
  "topic": "riemann",
  "prompt": "Estimate \\int_0^3 (2x + 1) \\, dx with a left Riemann sum using 3 equal subintervals.",
  "variable": "x",
  "variables": ["x"],
  "answer": "9",
  "points": [
   {"id": "P1", "label": "Width of each subinterval", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "1"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Value of the sum", "value": 2, "kind": "cas", "check": {"type": "exact_value", "expected": "9"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\Delta x = 1", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "1(1 + 3 + 5)", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "= 9", "kind": "rewrite", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "ftc-poly",
  "topic": "ftc",
  "prompt": "Evaluate \\int_0^2 3x^2 \\, dx.",
  "variable": "x",
  "variables": ["x"],
  "given": "Integral(3*x**2, (x, 0, 2))",
  "answer": "8",
  "points": [
   {"id": "P1", "label": "Antiderivative", "value": 1, "kind": "cas", "check": {"type": "antiderivative", "expected": "3*x**2"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Evaluates between the limits", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, 2) - ({P1}).subs(x, 0)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "\\int_0^2 3x^2 \\, dx", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "x^3", "kind": "integrate", "point": "P1", "sub": null, "words": false},
   {"latex": "2^3 - 0^3", "kind": "evaluate", "point": null, "sub": null, "words": false},
   {"latex": "= 8", "kind": "rewrite", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "ftc-root",
  "topic": "ftc",
  "prompt": "Evaluate \\int_1^4 \\left(2x + \\frac{1}{\\sqrt{x}}\\right) dx.",
  "variable": "x",
  "variables": ["x"],
  "given": "Integral(2*x + 1/sqrt(x), (x, 1, 4))",
  "answer": "17",
  "points": [
   {"id": "P1", "label": "Antiderivative", "value": 2, "kind": "cas", "check": {"type": "antiderivative", "expected": "2*x + 1/sqrt(x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Evaluates between the limits", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, 4) - ({P1}).subs(x, 1)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "x^2 + 2\\sqrt{x}", "kind": "integrate", "point": "P1", "sub": null, "words": false},
   {"latex": "(16 + 4) - (1 + 2)", "kind": "evaluate", "point": null, "sub": null, "words": false},
   {"latex": "= 17", "kind": "rewrite", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "ftc-part-one",
  "topic": "ftc",
  "prompt": "Find \\frac{d}{dx} \\int_0^x \\cos(t^2) \\, dt.",
  "variable": "x",
  "variables": ["x", "t"],
  "answer": "cos(x**2)",
  "points": [
   {"id": "P1", "label": "Applies the Fundamental Theorem", "value": 2, "kind": "cas", "check": {"type": "equivalent", "expected": "cos(x**2)"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "\\cos(x^2)", "kind": "unknown", "point": "P1", "sub": null, "words": false}
  ]
 },
 {
  "id": "ftc-trig",
  "topic": "ftc",
  "prompt": "Evaluate \\int_0^{\\pi/2} \\cos x \\, dx.",
  "variable": "x",
  "variables": ["x"],
  "given": "Integral(cos(x), (x, 0, pi/2))",
  "answer": "1",
  "points": [
   {"id": "P1", "label": "Antiderivative", "value": 1, "kind": "cas", "check": {"type": "antiderivative", "expected": "cos(x)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Evaluates between the limits", "value": 1, "kind": "cas", "check": {"type": "exact_value", "expected": "({P1}).subs(x, pi/2) - ({P1}).subs(x, 0)"}, "requires": [], "followThrough": true}
  ],
  "model": [
   {"latex": "\\sin x", "kind": "integrate", "point": "P1", "sub": null, "words": false},
   {"latex": "\\sin\\left(\\frac{\\pi}{2}\\right) - \\sin(0)", "kind": "evaluate", "point": null, "sub": null, "words": false},
   {"latex": "= 1", "kind": "rewrite", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "ftc-indefinite",
  "topic": "ftc",
  "prompt": "Find \\int (6x^2 - 4x + 1) \\, dx.",
  "variable": "x",
  "variables": ["x"],
  "given": "Integral(6*x**2 - 4*x + 1, x)",
  "answer": "2*x**3 - 2*x**2 + x",
  "points": [
   {"id": "P1", "label": "Antiderivative", "value": 3, "kind": "cas", "check": {"type": "antiderivative", "expected": "6*x**2 - 4*x + 1", "requireConstant": true}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "2x^3 - 2x^2 + x + C", "kind": "integrate", "point": "P1", "sub": null, "words": false}
  ]
 },
 {
  "id": "sub-cos",
  "topic": "substitution",
  "prompt": "Find \\int 2x\\cos(x^2) \\, dx.",
  "variable": "x",
  "variables": ["x", "u"],
  "given": "Integral(2*x*cos(x**2), x)",
  "answer": "sin(x**2)",
  "points": [
   {"id": "P1", "label": "Chooses the substitution", "value": 1, "kind": "cas", "check": {"type": "equation", "expected": "Eq(u, x**2)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Integral in terms of u", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "cos(u)"}, "requires": [], "followThrough": false},
   {"id": "P3", "label": "Antiderivative in terms of x", "value": 1, "kind": "cas", "check": {"type": "antiderivative", "expected": "2*x*cos(x**2)", "requireConstant": true}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "u = x^2", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "\\int \\cos u \\, du", "kind": "unknown", "point": "P2", "sub": null, "words": false},
   {"latex": "\\sin u + C", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "\\sin(x^2) + C", "kind": "unknown", "point": "P3", "sub": null, "words": false}
  ]
 },
 {
  "id": "sub-power",
  "topic": "substitution",
  "prompt": "Find \\int x(x^2 + 1)^5 \\, dx.",
  "variable": "x",
  "variables": ["x", "u"],
  "given": "Integral(x*(x**2 + 1)**5, x)",
  "answer": "(x**2 + 1)**6/12",
  "points": [
   {"id": "P1", "label": "Chooses the substitution", "value": 1, "kind": "cas", "check": {"type": "equation", "expected": "Eq(u, x**2 + 1)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Integral in terms of u", "value": 1, "kind": "cas", "check": {"type": "equivalent", "expected": "u**5/2"}, "requires": [], "followThrough": false},
   {"id": "P3", "label": "Antiderivative in terms of x", "value": 1, "kind": "cas", "check": {"type": "antiderivative", "expected": "x*(x**2 + 1)**5", "requireConstant": true}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "u = x^2 + 1", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "\\int \\frac{1}{2} u^5 \\, du", "kind": "unknown", "point": "P2", "sub": null, "words": false},
   {"latex": "\\frac{u^6}{12} + C", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "\\frac{(x^2+1)^6}{12} + C", "kind": "unknown", "point": "P3", "sub": null, "words": false}
  ]
 },
 {
  "id": "sub-definite",
  "topic": "substitution",
  "prompt": "Evaluate \\int_0^1 2x e^{x^2} \\, dx.",
  "variable": "x",
  "variables": ["x", "u"],
  "given": "Integral(2*x*exp(x**2), (x, 0, 1))",
  "answer": "E - 1",
  "points": [
   {"id": "P1", "label": "Chooses the substitution", "value": 1, "kind": "cas", "check": {"type": "equation", "expected": "Eq(u, x**2)"}, "requires": [], "followThrough": false},
   {"id": "P2", "label": "Value of the integral", "value": 2, "kind": "cas", "check": {"type": "exact_value", "expected": "E - 1"}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "u = x^2", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "\\int_0^1 e^u \\, du", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "= e - 1", "kind": "evaluate", "point": "P2", "sub": null, "words": false}
  ]
 },
 {
  "id": "sub-trig",
  "topic": "substitution",
  "prompt": "Find \\int \\sin x \\cos x \\, dx.",
  "variable": "x",
  "variables": ["x", "u"],
  "given": "Integral(sin(x)*cos(x), x)",
  "answer": "sin(x)**2/2",
  "points": [
   {"id": "P1", "label": "Antiderivative", "value": 3, "kind": "cas", "check": {"type": "antiderivative", "expected": "sin(x)*cos(x)", "requireConstant": true}, "requires": [], "followThrough": false}
  ],
  "model": [
   {"latex": "u = \\sin x", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "\\int u \\, du", "kind": "unknown", "point": null, "sub": null, "words": false},
   {"latex": "\\frac{\\sin^2 x}{2} + C", "kind": "unknown", "point": "P1", "sub": null, "words": false}
  ]
 }
]
```

Create `content/calc1/questions.ts`:

```ts
import raw from './questions.json';
import { parseQuestion } from '@/lib/engine/rubric';
import type { Question, TransitionKind } from '@/lib/engine/types';

/** One line of a model solution, with the alignment a perfect matcher would give it. */
export interface ModelLine {
  latex: string;
  kind: TransitionKind;
  point: string | null;
  sub: { variable: string; latex: string } | null;
  /** True for a line of words, which the checker is expected not to parse. */
  words: boolean;
}
export type SeedQuestion = Question & { model: ModelLine[] };

// The seed bank for fixtures and the launch evaluation. Each rubric is validated on
// load, so a bad edit to the JSON fails at import instead of mid-marking.
export const CALC1_QUESTIONS: SeedQuestion[] = (raw as unknown as (Record<string, unknown> & { model: ModelLine[] })[]).map((q) => ({
  ...parseQuestion(q),
  model: q.model,
}));

export function getCalc1Question(id: unknown): SeedQuestion | undefined {
  return CALC1_QUESTIONS.find((q) => q.id === id);
}
```

- [ ] **Step 4: Run the test**

Run: `node --import tsx --test tests/engine-questions.test.ts`
Expected: 1 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add content/calc1/questions.json content/calc1/questions.ts tests/engine-questions.test.ts
git commit -m "Add the Calc I seed question bank with rubrics and model solutions"
```

---

### Task 8: Checker client

**Files:**
- Create: `lib/engine/checker-client.ts`
- Test: `tests/engine-checker-client.test.ts`

**Interfaces:**
- Consumes: `Alignment`, `CheckRequest`, `CheckResponse`, `Question`, `Transcript`.
- Produces: `buildCheckRequest(question, transcript, alignment): CheckRequest`; `CheckerCall = (req: CheckRequest) => Promise<{ kind: 'ok'; data: CheckResponse } | { kind: 'down' }>`; `callChecker: CheckerCall` (reads `CHECKER_URL`, `CHECKER_SECRET`, `CHECKER_TIMEOUT_MS`); `CheckResponseSchema`; `checkerTimeoutMs()`.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-checker-client.test.ts`:

```ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckRequest, callChecker } from '@/lib/engine/checker-client';
import type { Alignment, Question, Transcript } from '@/lib/engine/types';

const realFetch = globalThis.fetch;
const realError = console.error;
const saved = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  for (const k of ['CHECKER_URL', 'CHECKER_SECRET', 'CHECKER_TIMEOUT_MS'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});
const quiet = () => void (console.error = () => {});

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const Q: Question = {
  id: 'q',
  topic: 'ftc',
  prompt: 'Find the integral.',
  variable: 'x',
  variables: ['x'],
  given: 'Integral(2*x, x)',
  answer: 'x**2',
  points: [
    { id: 'P1', label: 'Antiderivative', value: 2, kind: 'cas', check: { type: 'antiderivative', expected: '2*x', requireConstant: true }, requires: [], followThrough: false },
    { id: 'P2', label: 'Reason', value: 1, kind: 'judge', criterion: 'Says why', requires: [], followThrough: false },
  ],
};
const T: Transcript = { lines: [1, 2].map((n) => ({ n, image: 0, latex: n === 1 ? 'x^{2} + C' : '\\text{done}', box, confidence: 'high' as const, confirmed: false })) };
const A: Alignment = { lines: [{ n: 1, transition: 'integrate', substitution: null }], points: [{ id: 'P1', line: 1 }] };

test('request: every line gets a transition, only CAS points are sent, a judged last point means no final check', () => {
  const req = buildCheckRequest(Q, T, A);
  assert.deepEqual(req.lines, [{ n: 1, latex: 'x^{2} + C' }, { n: 2, latex: '\\text{done}' }]);
  assert.deepEqual(req.transitions, [
    { to: 1, kind: 'integrate', substitution: null },
    { to: 2, kind: 'unknown', substitution: null },
  ]);
  assert.deepEqual(req.points, [{ id: 'P1', type: 'antiderivative', expected: '2*x', followThrough: false, requireConstant: true, line: 1 }]);
  assert.equal(req.finalPoint, null);
  assert.equal(req.given, 'Integral(2*x, x)');
  const casLast = buildCheckRequest({ ...Q, given: undefined, points: [Q.points[0]] }, T, { lines: [], points: [] });
  assert.equal(casLast.finalPoint, 'P1');
  assert.equal(casLast.given, null);
  assert.equal(casLast.points[0].line, null);
});

const reply = { lines: [{ n: 1, parsed: true }], transitions: [{ to: 1, outcome: 'right' }], points: [{ id: 'P1', outcome: 'right', ftOutcome: null, ftRefused: false, note: null }], final: 'right' };

test('posts to CHECKER_URL/check with the shared secret', async () => {
  process.env.CHECKER_URL = 'http://checker.internal:8000/';
  process.env.CHECKER_SECRET = 's3cret';
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  const r = await callChecker(buildCheckRequest(Q, T, A));
  assert.deepEqual(r, { kind: 'ok', data: reply });
  assert.equal(seen[0].url, 'http://checker.internal:8000/check');
  assert.equal((seen[0].init.headers as Record<string, string>)['x-checker-secret'], 's3cret');
});

test('down: no URL, a non-200, a reply of the wrong shape, a network error', async () => {
  quiet();
  delete process.env.CHECKER_URL;
  assert.deepEqual(await callChecker(buildCheckRequest(Q, T, A)), { kind: 'down' });
  process.env.CHECKER_URL = 'http://checker.internal:8000';
  for (const res of [new Response('{}', { status: 504 }), new Response(JSON.stringify({ lines: [] }), { status: 200 }), new Response('not json', { status: 200 })]) {
    globalThis.fetch = (async () => res) as typeof fetch;
    assert.deepEqual(await callChecker(buildCheckRequest(Q, T, A)), { kind: 'down' });
  }
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  assert.deepEqual(await callChecker(buildCheckRequest(Q, T, A)), { kind: 'down' });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-checker-client.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/checker-client`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/checker-client.ts`:

```ts
import { z } from 'zod';
import type { Alignment, CheckRequest, CheckResponse, Question, Transcript } from './types';

const OUTCOME = z.enum(['right', 'wrong', 'unchecked']);
export const CheckResponseSchema = z.object({
  lines: z.array(z.object({ n: z.number(), parsed: z.boolean() })),
  transitions: z.array(z.object({ to: z.number(), outcome: OUTCOME })),
  points: z.array(
    z.object({
      id: z.string(),
      outcome: OUTCOME,
      ftOutcome: OUTCOME.nullable(),
      ftRefused: z.boolean(),
      note: z.enum(['missing_constant', 'inexact']).nullable(),
    }),
  ),
  final: OUTCOME,
});

/** What the checker is asked for one problem. The judge's points are not sent. */
export function buildCheckRequest(question: Question, transcript: Transcript, alignment: Alignment): CheckRequest {
  const stepOf = new Map(alignment.lines.map((l) => [l.n, l]));
  const lineOf = new Map(alignment.points.map((p) => [p.id, p.line]));
  const last = question.points[question.points.length - 1];
  return {
    variable: question.variable,
    variables: question.variables,
    given: question.given ?? null,
    lines: transcript.lines.map((l) => ({ n: l.n, latex: l.latex })),
    transitions: transcript.lines.map((l) => ({
      to: l.n,
      kind: stepOf.get(l.n)?.transition ?? 'unknown',
      substitution: stepOf.get(l.n)?.substitution ?? null,
    })),
    points: question.points
      .filter((p) => p.kind === 'cas' && p.check)
      .map((p) => ({
        id: p.id,
        type: p.check!.type,
        expected: p.check!.expected,
        followThrough: p.followThrough,
        requireConstant: p.check!.requireConstant === true,
        line: lineOf.get(p.id) ?? null,
      })),
    finalPoint: last.kind === 'cas' ? last.id : null,
  };
}

export type CheckerCall = (req: CheckRequest) => Promise<{ kind: 'ok'; data: CheckResponse } | { kind: 'down' }>;

export function checkerTimeoutMs(): number {
  const v = Number(process.env.CHECKER_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

/** Calls the private SymPy service. Any failure is `down`: the caller decides what that means. */
export const callChecker: CheckerCall = async (req) => {
  const base = process.env.CHECKER_URL?.trim().replace(/\/+$/, '');
  if (!base) {
    console.error('engine: CHECKER_URL is not set');
    return { kind: 'down' };
  }
  try {
    const res = await fetch(`${base}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-checker-secret': process.env.CHECKER_SECRET ?? '' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(checkerTimeoutMs()),
    });
    if (!res.ok) {
      console.error('engine: checker answered', res.status);
      return { kind: 'down' };
    }
    const parsed = CheckResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.error('engine: checker reply did not match the schema');
      return { kind: 'down' };
    }
    return { kind: 'ok', data: parsed.data };
  } catch (err) {
    console.error('engine: checker call failed', err instanceof Error ? err.message : String(err));
    return { kind: 'down' };
  }
};
```

- [ ] **Step 4: Run the test**

Run: `node --import tsx --test tests/engine-checker-client.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/checker-client.ts tests/engine-checker-client.test.ts
git commit -m "Add the engine's checker client"
```

---

### Task 9: Scorer

**Files:**
- Create: `lib/engine/scorer.ts`
- Test: `tests/engine-scorer.test.ts`

**Interfaces:**
- Consumes: the types of Task 1.
- Produces: `ScoreInput { question; profile; transcript; alignment; check: CheckResponse; judgements: Judgement[] | null }`; `scoreProblem(i: ScoreInput): MarkResult`; `scoreExam(results: MarkResult[], profile: Profile): ExamScore`; `MISSING_PLUS_C = 'missing_plus_c'`; `REASONS`.

The rules, in the order the code applies them: a point with no line is "not attempted" (no red); a proven-right point is earned; a proven-wrong point on an untrusted line is unchecked; a proven-wrong point is credited by follow-through when the checker proved it consistent with the student's own value and no carried value made the problem easier; a point whose required point was lost is not earned (no red); a point whose required point is unchecked is unchecked; a judged point needs a quote that is really on the named line. Then, if every line of maths is a proven step and the last line equals the answer, every CAS point is earned. A line is red only when its own point was proven wrong, or it has no point and its step was proven wrong.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-scorer.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_PLUS_C, REASONS, scoreExam, scoreProblem, type ScoreInput } from '@/lib/engine/scorer';
import type { Alignment, CheckResponse, Profile, Question, Transcript } from '@/lib/engine/types';

const AP: Profile = { id: 'ap-default', followThrough: true, plusC: { penalty: 1, scope: 'exam' }, exactForm: true };
const box = { x0: 0, y0: 0, x1: 10, y1: 10 };

// Differentiate, evaluate at 2, then say why the tangent is rising.
const Q: Question = {
  id: 'q',
  topic: 'derivatives',
  prompt: 'f(x) = x^3 + x^2. Find f\'(2) and say whether f is increasing at x = 2.',
  variable: 'x',
  variables: ['x'],
  given: 'x**3 + x**2',
  answer: '16',
  points: [
    { id: 'P1', label: 'Differentiates', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'diff(x**3 + x**2, x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Evaluates at 2', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '({P1}).subs(x, 2)' }, requires: [], followThrough: true },
    { id: 'P3', label: 'Reason', value: 1, kind: 'judge', criterion: 'States that f is increasing because f\'(2) > 0', requires: ['P2'], followThrough: false },
  ],
};

const transcript = (over: Partial<Transcript['lines'][number]>[] = []): Transcript => ({
  lines: [
    { n: 1, image: 0, latex: "f'(x) = 3x^2 + 2x", box, confidence: 'high', confirmed: false, ...over[0] },
    { n: 2, image: 0, latex: "f'(2) = 16", box, confidence: 'high', confirmed: false, ...over[1] },
    { n: 3, image: 0, latex: 'increasing since 16 > 0', box, confidence: 'high', confirmed: false, ...over[2] },
  ],
});
const alignment: Alignment = {
  lines: [
    { n: 1, transition: 'differentiate', substitution: null },
    { n: 2, transition: 'substitute', substitution: { variable: 'x', latex: '2' } },
    { n: 3, transition: 'unknown', substitution: null },
  ],
  points: [
    { id: 'P1', line: 1 },
    { id: 'P2', line: 2 },
    { id: 'P3', line: 3 },
  ],
};
const pt = (id: string, outcome: 'right' | 'wrong' | 'unchecked', extra: object = {}) => ({ id, outcome, ftOutcome: null, ftRefused: false, note: null, ...extra });
const check = (p1 = pt('P1', 'right'), p2 = pt('P2', 'right'), over: Partial<CheckResponse> = {}): CheckResponse => ({
  lines: [1, 2, 3].map((n) => ({ n, parsed: n !== 3 })),
  transitions: [
    { to: 1, outcome: p1.outcome },
    { to: 2, outcome: 'right' },
    { to: 3, outcome: 'unchecked' },
  ],
  points: [p1, p2] as CheckResponse['points'],
  final: 'unchecked',
  ...over,
});
const judged = [{ id: 'P3', met: true, line: 3, quote: 'increasing since 16 > 0' }];
const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({ question: Q, profile: AP, transcript: transcript(), alignment, check: check(), judgements: judged, ...over });
const statuses = (r: ReturnType<typeof scoreProblem>) => r.points.map((p) => p.status);

test('all correct: full marks, every line ok', () => {
  const r = scoreProblem(input());
  assert.deepEqual(statuses(r), ['earned', 'earned', 'earned']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [3, 3, 0]);
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'ok', 'ok']);
});

test('follow-through: wrong derivative is red, the consistent value after it is credited', () => {
  const r = scoreProblem(input({ check: check(pt('P1', 'wrong'), pt('P2', 'wrong', { ftOutcome: 'right' })) }));
  assert.deepEqual(statuses(r), ['not_earned', 'earned_follow_through', 'earned']);
  assert.deepEqual(r.lines.map((l) => l.status), ['wrong', 'ok', 'ok']);
  assert.deepEqual([r.earned, r.total], [2, 3]);
});

test('follow-through off in the profile: the later point is lost', () => {
  const r = scoreProblem(input({ profile: { ...AP, followThrough: false }, check: check(pt('P1', 'wrong'), pt('P2', 'wrong', { ftOutcome: 'right' })) }));
  assert.equal(r.points[1].status, 'not_earned');
});

test('materially easier carried value: follow-through refused, and for later points too', () => {
  const q: Question = { ...Q, points: [...Q.points.slice(0, 2), { id: 'P4', label: 'Doubles it', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '2*{P2}' }, requires: [], followThrough: true }] };
  const c = check(pt('P1', 'wrong'), pt('P2', 'wrong', { ftOutcome: 'right', ftRefused: true }));
  c.points.push(pt('P4', 'wrong', { ftOutcome: 'right' }) as CheckResponse['points'][number]);
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: 2 }, { id: 'P4', line: 3 }] };
  const r = scoreProblem(input({ question: q, check: c, alignment: a, judgements: [] }));
  assert.deepEqual(statuses(r), ['not_earned', 'not_earned', 'not_earned']);
});

test('eligibility: a point whose required point was lost is not earned, with no red on its line', () => {
  const r = scoreProblem(input({ check: check(pt('P1', 'right'), pt('P2', 'wrong')) }));
  assert.deepEqual(statuses(r), ['earned', 'not_earned', 'not_earned']);
  assert.equal(r.points[2].reason, 'Needs P2');
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'wrong', 'unchecked']);
});

test('eligibility: a required point that could not be checked makes the dependent point unchecked', () => {
  const r = scoreProblem(input({ check: check(pt('P1', 'right'), pt('P2', 'unchecked')) }));
  assert.deepEqual(statuses(r), ['earned', 'unchecked', 'unchecked']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [1, 1, 2]);
});

test('red needs a trusted line: a low-confidence unconfirmed line is never marked wrong', () => {
  const t = transcript([{ confidence: 'low' }]);
  const r = scoreProblem(input({ transcript: t, check: check(pt('P1', 'wrong'), pt('P2', 'right')) }));
  assert.equal(r.points[0].status, 'unchecked');
  assert.equal(r.points[0].reason, REASONS.unread);
  assert.equal(r.lines[0].status, 'unchecked');
});

test('a low-confidence line the student confirmed can be marked wrong', () => {
  const t = transcript([{ confidence: 'low', confirmed: true }]);
  const r = scoreProblem(input({ transcript: t, check: check(pt('P1', 'wrong'), pt('P2', 'right')) }));
  assert.equal(r.points[0].status, 'not_earned');
  assert.equal(r.lines[0].status, 'wrong');
});

test('not attempted: no line, no red, not earned', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const r = scoreProblem(input({ alignment: a, judgements: [{ id: 'P3', met: false, line: null, quote: '' }] }));
  assert.equal(r.points[1].status, 'not_earned');
  assert.equal(r.points[1].reason, REASONS.notAttempted);
  assert.ok(!r.lines.some((l) => l.status === 'wrong'));
});

test('judge: no quote, or a quote that is not on the line, earns nothing', () => {
  for (const j of [
    { id: 'P3', met: true, line: 3, quote: '' },
    { id: 'P3', met: true, line: 3, quote: 'because the derivative is positive' },
    { id: 'P3', met: true, line: null, quote: 'increasing' },
    { id: 'P3', met: true, line: 9, quote: 'increasing' },
  ]) {
    const r = scoreProblem(input({ judgements: [j] }));
    assert.equal(r.points[2].status, 'not_earned');
    assert.equal(r.points[2].reason, REASONS.noReason);
  }
});

test('judge unavailable: judged points are unchecked and leave the total', () => {
  const r = scoreProblem(input({ judgements: null }));
  assert.equal(r.points[2].status, 'unchecked');
  assert.deepEqual([r.earned, r.total, r.unchecked], [2, 2, 1]);
});

test('any valid method: a proven chain to the answer earns every CAS point', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: null }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'unchecked'), pt('P2', 'unchecked'), {
    transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'right' }, { to: 3, outcome: 'unchecked' }],
    final: 'right',
  });
  const r = scoreProblem(input({ alignment: a, check: c, judgements: [] }));
  assert.deepEqual(statuses(r), ['earned', 'earned', 'not_earned']);
  assert.equal(r.points[0].reason, REASONS.validMethod);
});

test('a line with an unparsed line of words above is compared with the maths above that', () => {
  const t = transcript([{}, { latex: '\\text{now put in 2}', confidence: 'low' }, { latex: "f'(2) = 17" }]);
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'right'), pt('P2', 'unchecked'), {
    lines: [{ n: 1, parsed: true }, { n: 2, parsed: false }, { n: 3, parsed: true }],
    transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'unchecked' }, { to: 3, outcome: 'wrong' }],
  });
  const r = scoreProblem(input({ transcript: t, alignment: a, check: c, judgements: [] }));
  // Line 2 is low-confidence words, but line 3 was checked against line 1, which is trusted.
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'unchecked', 'wrong']);
});

test('a broken chain does not trigger any-valid-method', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: null }, { id: 'P2', line: null }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'unchecked'), pt('P2', 'unchecked'), { final: 'right' });
  const r = scoreProblem(input({ alignment: a, check: c, judgements: [] }));
  assert.deepEqual(statuses(r), ['not_earned', 'not_earned', 'not_earned']);
});

test('a line with no rubric point is red only when its step is proven wrong', () => {
  const a = { ...alignment, points: [{ id: 'P1', line: 1 }, { id: 'P2', line: 3 }, { id: 'P3', line: null }] };
  const c = check(pt('P1', 'right'), pt('P2', 'right'), {
    lines: [1, 2, 3].map((n) => ({ n, parsed: true })),
    transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'wrong' }, { to: 3, outcome: 'right' }],
  });
  const r = scoreProblem(input({ alignment: a, check: c, judgements: [] }));
  assert.deepEqual(r.lines.map((l) => l.status), ['ok', 'wrong', 'ok']);
});

test('decimal for an exact value: unchecked under exactForm, earned without it', () => {
  const c = check(pt('P1', 'right'), pt('P2', 'unchecked', { note: 'inexact' }));
  assert.equal(scoreProblem(input({ check: c })).points[1].status, 'unchecked');
  assert.equal(scoreProblem(input({ check: c, profile: { ...AP, exactForm: false } })).points[1].status, 'earned');
});

test('missing +C raises a flag; scoreExam applies it once across problems', () => {
  const c = check(pt('P1', 'right', { note: 'missing_constant' }), pt('P2', 'right'));
  const one = scoreProblem(input({ check: c }));
  assert.deepEqual(one.penaltyFlags, [MISSING_PLUS_C]);
  assert.equal(one.earned, 3);
  const exam = scoreExam([one, one, scoreProblem(input())], AP);
  assert.deepEqual(exam, { earned: 8, total: 9, unchecked: 0, penalties: [{ id: MISSING_PLUS_C, value: 1 }] });
});

test('scoreExam: no flags, no penalty; never below zero', () => {
  assert.deepEqual(scoreExam([scoreProblem(input())], AP).penalties, []);
  const zero = { ...scoreProblem(input()), earned: 0, penaltyFlags: [MISSING_PLUS_C] };
  assert.equal(scoreExam([zero], AP).earned, 0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-scorer.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/scorer`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/scorer.ts`:

```ts
import type { Alignment, CheckResponse, ExamScore, Judgement, LineResult, MarkResult, PointResult, PointStatus, Profile, Question, Transcript, TranscriptLine } from './types';

export const MISSING_PLUS_C = 'missing_plus_c';

export const REASONS = {
  earned: 'Correct',
  followThrough: 'Correct from your earlier value',
  validMethod: 'Correct by a different method',
  notAttempted: 'Not attempted',
  wrong: 'This step is not correct',
  noReason: 'No reason given',
  unread: 'Could not read this line with confidence',
  unchecked: 'Could not check this point',
  inexact: 'Decimal given; could not check it against the exact value',
} as const;

export interface ScoreInput {
  question: Question;
  profile: Profile;
  transcript: Transcript;
  alignment: Alignment;
  check: CheckResponse;
  /** null when the judge could not be reached: judged points become unchecked. */
  judgements: Judgement[] | null;
}

const trusted = (l: TranscriptLine | undefined) => !!l && (l.confidence === 'high' || l.confirmed);
const squash = (s: string) => s.replace(/\s+/g, '');
const isEarned = (s: PointStatus | undefined) => s === 'earned' || s === 'earned_follow_through';

export function scoreProblem(i: ScoreInput): MarkResult {
  const { question, profile, transcript, alignment, check, judgements } = i;
  const lineByN = new Map(transcript.lines.map((l) => [l.n, l]));
  const lineOf = new Map(alignment.points.map((p) => [p.id, p.line]));
  const status = new Map<string, PointStatus>();
  const wrongLines = new Set<number>();
  const flags = new Set<string>();
  const points: PointResult[] = [];
  let ftBlocked = false;

  for (const p of question.points) {
    const n = lineOf.get(p.id) ?? null;
    const line = n === null ? undefined : lineByN.get(n);
    let st: PointStatus;
    let reason: string;
    let proven = false;
    let lineRef: number | undefined = line?.n;

    if (p.kind === 'judge') {
      const j = judgements?.find((x) => x.id === p.id);
      const quoted = j && j.line !== null ? lineByN.get(j.line) : undefined;
      if (!judgements) [st, reason] = ['unchecked', REASONS.unchecked];
      else if (j?.met && quoted && squash(j.quote) && squash(quoted.latex).includes(squash(j.quote))) {
        [st, reason] = ['earned', REASONS.earned];
        lineRef = quoted.n;
      } else [st, reason] = ['not_earned', REASONS.noReason];
    } else {
      const c = check.points.find((x) => x.id === p.id);
      const ftAllowed = profile.followThrough && p.followThrough && !!c && !c.ftRefused && !ftBlocked;
      if (!line) [st, reason] = ['not_earned', REASONS.notAttempted];
      else if (!c) [st, reason] = ['unchecked', REASONS.unchecked];
      else if (c.outcome === 'right') {
        [st, reason] = ['earned', REASONS.earned];
        if (c.note === 'missing_constant') flags.add(MISSING_PLUS_C);
      } else if (c.outcome === 'unchecked') {
        if (c.note === 'inexact') [st, reason] = profile.exactForm ? ['unchecked', REASONS.inexact] : ['earned', REASONS.earned];
        else [st, reason] = ['unchecked', REASONS.unchecked];
      } else if (!trusted(line)) [st, reason] = ['unchecked', REASONS.unread];
      else if (ftAllowed && c.ftOutcome === 'right') [st, reason] = ['earned_follow_through', REASONS.followThrough];
      else if (ftAllowed && c.ftOutcome === 'unchecked') [st, reason] = ['unchecked', REASONS.unchecked];
      else {
        [st, reason] = ['not_earned', REASONS.wrong];
        proven = true;
      }
      // A carried value that makes the problem easier ends follow-through for the rest of the problem.
      if (c?.ftRefused) ftBlocked = true;
    }

    if (isEarned(st)) {
      const needs = p.requires.map((id) => ({ id, s: status.get(id) }));
      const missing = needs.filter((x) => x.s === 'not_earned' || x.s === undefined);
      if (missing.length) [st, reason] = ['not_earned', `Needs ${missing.map((x) => x.id).join(', ')}`];
      else if (needs.some((x) => x.s === 'unchecked')) [st, reason] = ['unchecked', REASONS.unchecked];
    }
    if (proven && line) wrongLines.add(line.n);
    status.set(p.id, st);
    points.push({ id: p.id, status: st, ...(lineRef === undefined ? {} : { line: lineRef }), verifiedBy: p.kind, reason });
  }

  // Any valid method: every step from the question to a final line equal to the answer is proven right.
  const transitionOf = new Map(check.transitions.map((t) => [t.to, t.outcome]));
  // Lines of words do not parse and are skipped; every line of maths must be proven.
  const maths = check.lines.filter((l) => l.parsed);
  const chainProven = check.final === 'right' && maths.length > 0 && maths.every((l) => transitionOf.get(l.n) === 'right');
  if (chainProven) {
    wrongLines.clear();
    question.points.forEach((p, k) => {
      if (p.kind !== 'cas' || isEarned(status.get(p.id))) return;
      status.set(p.id, 'earned');
      points[k] = { ...points[k], status: 'earned', reason: REASONS.validMethod };
    });
  }

  const parsed = new Map(check.lines.map((l) => [l.n, l.parsed]));
  const mathsAbove = (k: number) => transcript.lines.slice(0, k).reverse().find((l) => parsed.get(l.n));
  const lines: LineResult[] = transcript.lines.map((l, k) => {
    const here = question.points.filter((p) => lineOf.get(p.id) === l.n);
    let st: LineResult['status'] = 'unchecked';
    if (wrongLines.has(l.n)) st = 'wrong';
    else if (here.some((p) => isEarned(status.get(p.id)))) st = 'ok';
    else if (here.length === 0) {
      const t = transitionOf.get(l.n);
      // The step was checked against the nearest line of maths above (or the question itself).
      const prev = mathsAbove(k);
      if (t === 'right') st = 'ok';
      else if (t === 'wrong' && parsed.get(l.n) && trusted(l) && (!prev || trusted(prev))) st = 'wrong';
    }
    return { n: l.n, image: l.image, status: st, box: l.box };
  });

  const sum = (f: (s: PointStatus) => boolean) => question.points.reduce((a, p) => a + (f(status.get(p.id)!) ? p.value : 0), 0);
  return {
    questionId: question.id,
    points,
    lines,
    earned: sum(isEarned),
    total: sum((s) => s !== 'unchecked'),
    unchecked: sum((s) => s === 'unchecked'),
    penaltyFlags: [...flags],
    trace: { transcript, alignment, check, judgements },
  };
}

/** Exam-scope penalties are applied once, however many problems raise the flag. */
export function scoreExam(results: MarkResult[], profile: Profile): ExamScore {
  const penalties: ExamScore['penalties'] = [];
  if (profile.plusC.penalty > 0 && results.some((r) => r.penaltyFlags.includes(MISSING_PLUS_C)))
    penalties.push({ id: MISSING_PLUS_C, value: profile.plusC.penalty });
  const raw = results.reduce((a, r) => a + r.earned, 0);
  return {
    earned: Math.max(0, raw - penalties.reduce((a, p) => a + p.value, 0)),
    total: results.reduce((a, r) => a + r.total, 0),
    unchecked: results.reduce((a, r) => a + r.unchecked, 0),
    penalties,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `node --import tsx --test tests/engine-scorer.test.ts`
Expected: 18 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/scorer.ts tests/engine-scorer.test.ts
git commit -m "Add the engine's scorer"
```

---

### Task 10: The compute path against the real checker

**Files:**
- Create: `fixtures/engine/typed.json`
- Test: `tests/engine-compute.test.ts`

**Interfaces:**
- Consumes: `buildCheckRequest`, `callChecker`; `scoreProblem`; `AP_DEFAULT`; `CALC1_QUESTIONS`, `getCalc1Question`, `ModelLine`, `SeedQuestion`; the running checker from Task 6.
- Produces: `fixtures/engine/typed.json`, an array of `{ id, questionId, lines: ModelLine[], expect: Record<pointId, PointStatus>, red: number[], flags: string[] }`, also read by `scripts/eval-engine.ts` in Task 15.

This is the spec's typed-transcript set: no model and no handwriting, so it measures the compute path alone. It skips itself when `CHECKER_URL` is unset, so `npm test` stays green on a machine without Python.

- [ ] **Step 1: Write the fixture**

Create `fixtures/engine/typed.json`:

```json
[
 {
  "id": "der-power-eval-wrong-derivative", "questionId": "der-power-eval",
  "lines": [
   {"latex": "f'(x) = 3x^{2} + x", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "f'(2) = 14", "kind": "substitute", "point": "P2", "sub": {"variable": "x", "latex": "2"}, "words": false}
  ],
  "expect": {"P1": "not_earned", "P2": "earned_follow_through"}, "red": [1], "flags": []
 },
 {
  "id": "der-power-eval-easier", "questionId": "der-power-eval",
  "lines": [
   {"latex": "f'(x) = 5", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "f'(2) = 5", "kind": "substitute", "point": "P2", "sub": {"variable": "x", "latex": "2"}, "words": false}
  ],
  "expect": {"P1": "not_earned", "P2": "not_earned"}, "red": [1, 2], "flags": []
 },
 {
  "id": "der-chain-missing-inner", "questionId": "der-chain",
  "lines": [
   {"latex": "\\frac{dy}{dx} = \\cos(x^{2})", "kind": "differentiate", "point": "P1", "sub": null, "words": false}
  ],
  "expect": {"P1": "not_earned"}, "red": [1], "flags": []
 },
 {
  "id": "ftc-poly-wrong-antiderivative", "questionId": "ftc-poly",
  "lines": [
   {"latex": "\\int_{0}^{2} 3x^{2} \\, dx", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "3x^{3}", "kind": "integrate", "point": "P1", "sub": null, "words": false},
   {"latex": "= 24", "kind": "evaluate", "point": "P2", "sub": null, "words": false}
  ],
  "expect": {"P1": "not_earned", "P2": "earned_follow_through"}, "red": [2], "flags": []
 },
 {
  "id": "ftc-indefinite-no-constant", "questionId": "ftc-indefinite",
  "lines": [
   {"latex": "2x^{3} - 2x^{2} + x", "kind": "integrate", "point": "P1", "sub": null, "words": false}
  ],
  "expect": {"P1": "earned"}, "red": [], "flags": ["missing_plus_c"]
 },
 {
  "id": "opt-rectangle-wrong-area", "questionId": "opt-rectangle",
  "lines": [
   {"latex": "A = x(40 - x)", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "A' = 40 - 2x", "kind": "differentiate", "point": "P2", "sub": null, "words": false},
   {"latex": "x = 20", "kind": "unknown", "point": "P3", "sub": null, "words": false},
   {"latex": "A = 20(20) = 400", "kind": "unknown", "point": "P5", "sub": null, "words": false}
  ],
  "expect": {"P1": "not_earned", "P2": "earned_follow_through", "P3": "earned_follow_through", "P4": "not_earned", "P5": "earned_follow_through"}, "red": [1], "flags": []
 },
 {
  "id": "rr-sphere-wrong-power", "questionId": "rr-sphere",
  "lines": [
   {"latex": "\\frac{dV}{dt} = 4\\pi r \\frac{dr}{dt}", "kind": "differentiate", "point": "P1", "sub": null, "words": false},
   {"latex": "= 24\\pi", "kind": "substitute", "point": "P2", "sub": null, "words": false}
  ],
  "expect": {"P1": "not_earned", "P2": "earned_follow_through"}, "red": [1], "flags": []
 },
 {
  "id": "lim-factor-wrong-cancel", "questionId": "lim-factor",
  "lines": [
   {"latex": "\\lim_{x \\to 2} (x - 2)", "kind": "rewrite", "point": "P1", "sub": null, "words": false},
   {"latex": "= 0", "kind": "take_limit", "point": "P2", "sub": null, "words": false}
  ],
  "expect": {"P1": "not_earned", "P2": "earned_follow_through"}, "red": [1], "flags": []
 },
 {
  "id": "sub-trig-other-form", "questionId": "sub-trig",
  "lines": [
   {"latex": "-\\frac{\\cos^{2} x}{2} + C", "kind": "unknown", "point": "P1", "sub": null, "words": false}
  ],
  "expect": {"P1": "earned"}, "red": [], "flags": []
 },
 {
  "id": "riemann-right-decimals", "questionId": "riemann-right",
  "lines": [
   {"latex": "\\Delta x = 0.5", "kind": "unknown", "point": "P1", "sub": null, "words": false},
   {"latex": "3.75", "kind": "unknown", "point": "P2", "sub": null, "words": false}
  ],
  "expect": {"P1": "earned", "P2": "earned"}, "red": [], "flags": []
 },
 {
  "id": "der-product-mislabelled-step", "questionId": "der-product",
  "lines": [
   {"latex": "2x \\sin x + x^{2} \\cos x", "kind": "rewrite", "point": "P1", "sub": null, "words": false}
  ],
  "expect": {"P1": "earned"}, "red": [], "flags": []
 },
 {
  "id": "der-power-eval-answer-only", "questionId": "der-power-eval",
  "lines": [
   {"latex": "16", "kind": "unknown", "point": "P2", "sub": null, "words": false}
  ],
  "expect": {"P1": "not_earned", "P2": "earned"}, "red": [], "flags": []
 },
 {
  "id": "lim-sin-other-method", "questionId": "lim-sin",
  "lines": [
   {"latex": "\\lim_{x \\to 0} 3 \\cdot \\frac{\\sin(3x)}{3x}", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "= 3 \\cdot 1", "kind": "rewrite", "point": null, "sub": null, "words": false},
   {"latex": "= 3", "kind": "rewrite", "point": null, "sub": null, "words": false}
  ],
  "expect": {"P1": "earned", "P2": "earned"}, "red": [], "flags": []
 }
]
```

- [ ] **Step 2: Write the test**

Create `tests/engine-compute.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import typed from '@/fixtures/engine/typed.json';
import { buildCheckRequest, callChecker } from '@/lib/engine/checker-client';
import { AP_DEFAULT } from '@/lib/engine/profiles';
import { CALC1_QUESTIONS, getCalc1Question, type ModelLine, type SeedQuestion } from '@/content/calc1/questions';
import { scoreProblem } from '@/lib/engine/scorer';
import type { Alignment, Judgement, MarkResult, Transcript } from '@/lib/engine/types';

// The compute path with no model in it: typed lines and a hand-made alignment go
// through the real SymPy service and the scorer. Needs the checker running:
//   CHECKER_URL=http://127.0.0.1:8000 CHECKER_SECRET=dev npm test
const skip = process.env.CHECKER_URL ? false : 'CHECKER_URL is not set';
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };

async function mark(q: SeedQuestion, lines: ModelLine[]): Promise<MarkResult> {
  const transcript: Transcript = { lines: lines.map((l, k) => ({ n: k + 1, image: 0, latex: l.latex, box, confidence: 'high' as const, confirmed: true })) };
  const lineOf = (id: string) => {
    const k = lines.findIndex((l) => l.point === id);
    return k < 0 ? null : k + 1;
  };
  const alignment: Alignment = {
    lines: lines.map((l, k) => ({ n: k + 1, transition: l.kind, substitution: l.sub })),
    points: q.points.filter((p) => p.kind === 'cas').map((p) => ({ id: p.id, line: lineOf(p.id) })),
  };
  const judgements: Judgement[] = q.points
    .filter((p) => p.kind === 'judge')
    .map((p) => {
      const n = lineOf(p.id);
      return n === null ? { id: p.id, met: false, line: null, quote: '' } : { id: p.id, met: true, line: n, quote: lines[n - 1].latex };
    });
  const check = await callChecker(buildCheckRequest(q, transcript, alignment));
  assert.equal(check.kind, 'ok', 'the checker must be reachable');
  if (check.kind !== 'ok') throw new Error('unreachable');
  return scoreProblem({ question: q, profile: AP_DEFAULT, transcript, alignment, check: check.data, judgements });
}

test('every seed model solution earns full marks, with no red line and nothing unchecked', { skip }, async () => {
  for (const q of CALC1_QUESTIONS) {
    const r = await mark(q, q.model);
    const full = q.points.reduce((a, p) => a + p.value, 0);
    assert.deepEqual([r.earned, r.total, r.unchecked], [full, full, 0], q.id);
    assert.deepEqual(r.lines.filter((l) => l.status === 'wrong'), [], q.id);
    assert.deepEqual(r.penaltyFlags, [], q.id);
  }
});

test('typed cases: common errors, follow-through, other methods', { skip }, async () => {
  for (const c of typed as unknown as { id: string; questionId: string; lines: ModelLine[]; expect: Record<string, string>; red: number[]; flags: string[] }[]) {
    const q = getCalc1Question(c.questionId);
    assert.ok(q, c.id);
    const r = await mark(q, c.lines);
    assert.deepEqual(Object.fromEntries(r.points.map((p) => [p.id, p.status])), c.expect, c.id);
    assert.deepEqual(r.lines.filter((l) => l.status === 'wrong').map((l) => l.n), c.red, c.id);
    assert.deepEqual(r.penaltyFlags, c.flags, c.id);
  }
});
```

- [ ] **Step 3: Run it without the checker to confirm it skips**

Run: `node --import tsx --test tests/engine-compute.test.ts`
Expected: 0 pass, 2 skipped.

- [ ] **Step 4: Run it against the checker**

With `npm run checker:dev` still running:

Run: `CHECKER_URL=http://127.0.0.1:8000 CHECKER_SECRET=dev node --import tsx --test tests/engine-compute.test.ts`
Expected: 2 pass, 0 fail. If a seed question fails here, the fault is in that question's rubric or model solution in `questions.json`, or in the checker; report it rather than loosening the assertion.

- [ ] **Step 5: Commit**

```bash
git add fixtures/engine/typed.json tests/engine-compute.test.ts
git commit -m "Test the compute path against the real checker with typed transcripts"
```

---

### Task 11: Engine model layer

**Files:**
- Create: `lib/engine/model.ts`
- Test: `tests/engine-model.test.ts`

**Interfaces:**
- Consumes (existing code, unchanged): `OPENAI_URL`, `strictJsonSchema` from `@/lib/mark/openai`; `anthropicClient` from `@/lib/mark/anthropic`; `DEFAULT_OPENAI_MODEL`, `markProvider` from `@/lib/config`.
- Produces: `EngineRole = 'reader' | 'matcher' | 'judge'`; `EngineImage { mediaType: 'image/png' | 'image/jpeg'; base64: string }`; `EngineUsage { input; output }`; `EngineModelArgs<T> { role; system; instruction; images; schema: z.ZodType<T> }`; `EngineModelResult<T>`; `EngineModel`; `openAIEngineModel`, `anthropicEngineModel`, `engineModelFor(env?)`; `openAIEngineRequest(a, model)`; `engineTimeoutMs()`; `withRetry(call)`; `class EngineError extends Error { retryable: true; stage: 'reader' | 'matcher' | 'checker' }`.

OpenAI's strict structured output rejects optional fields, so every schema passed to this layer uses `.nullable()`, never `.optional()`, and plain `z.number()` rather than `z.number().int()`.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-model.test.ts`:

```ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { anthropicEngineModel, engineModelFor, engineTimeoutMs, openAIEngineModel, openAIEngineRequest, withRetry, type EngineModelArgs } from '@/lib/engine/model';
import { anthropicClient } from '@/lib/mark/anthropic';
import { DEFAULT_OPENAI_MODEL } from '@/lib/config';

const realFetch = globalThis.fetch;
const realError = console.error;
const realParse = anthropicClient.messages.parse;
const saved = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  anthropicClient.messages.parse = realParse;
  for (const k of ['MARK_PROVIDER', 'MARK_MODEL_OPENAI', 'ENGINE_MODEL_READER', 'ENGINE_EFFORT', 'ENGINE_TIMEOUT_MS', 'OPENAI_API_KEY'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});
const quiet = () => void (console.error = () => {});

const Out = z.object({ ok: z.boolean(), note: z.string().nullable() });
const args: EngineModelArgs<z.infer<typeof Out>> = {
  role: 'reader',
  system: 'SYS',
  instruction: 'INSTR',
  images: [
    { mediaType: 'image/jpeg', base64: 'AAAA' },
    { mediaType: 'image/png', base64: 'BBBB' },
  ],
  schema: Out,
};
const done = (text: string) => ({ model: 'gpt-x', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 900, output_tokens: 120 } });
const stub = (status: number, body: unknown, seen: RequestInit[] = []) => {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return seen;
};

test('openai request: every image then the text, strict schema named for the role, no store', () => {
  const r = openAIEngineRequest(args, 'gpt-x');
  assert.deepEqual(r.input[0].content, [
    { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA', detail: 'high' },
    { type: 'input_image', image_url: 'data:image/png;base64,BBBB', detail: 'high' },
    { type: 'input_text', text: 'INSTR' },
  ]);
  assert.equal(r.instructions, 'SYS');
  assert.equal(r.text.format.name, 'reader');
  assert.equal(r.text.format.strict, true);
  assert.equal(r.store, false);
  assert.equal(r.reasoning.effort, 'low');
  assert.ok(!JSON.stringify(r.text.format.schema).includes('oneOf'));
});

test('openai: the role model overrides the marking model, which overrides the default', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  const seen = stub(200, done('{"ok":true,"note":null}'));
  await openAIEngineModel(args);
  process.env.MARK_MODEL_OPENAI = 'gpt-mark';
  await openAIEngineModel(args);
  process.env.ENGINE_MODEL_READER = 'gpt-reader';
  await openAIEngineModel(args);
  assert.deepEqual(seen.map((i) => JSON.parse(String(i.body)).model), [DEFAULT_OPENAI_MODEL, 'gpt-mark', 'gpt-reader']);
  assert.equal((seen[0].headers as Record<string, string>).Authorization, 'Bearer sk-test');
});

test('openai ok: parsed data and usage', async () => {
  stub(200, done('{"ok":true,"note":"x"}'));
  assert.deepEqual(await openAIEngineModel(args), { kind: 'ok', data: { ok: true, note: 'x' }, model: 'gpt-x', usage: { input: 900, output: 120 } });
});

test('openai failures map to a reason', async () => {
  quiet();
  const cases: [number, unknown, string][] = [
    [500, { error: { message: 'boom' } }, 'api'],
    [200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'max_tokens'],
    [200, { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'refusal'],
    [200, { status: 'failed' }, 'api'],
    [200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'refusal'],
    [200, done('not json'), 'invalid'],
    [200, done('{"ok":"yes"}'), 'invalid'],
    [200, { status: 'completed', output: [] }, 'invalid'],
  ];
  for (const [status, body, reason] of cases) {
    stub(status, body);
    assert.deepEqual(await openAIEngineModel(args), { kind: 'fail', reason });
  }
  globalThis.fetch = (async () => {
    throw new Error('timeout');
  }) as typeof fetch;
  assert.deepEqual(await openAIEngineModel(args), { kind: 'fail', reason: 'api' });
});

test('anthropic: images then text, parsed output validated, failures mapped', async () => {
  quiet();
  const seen: unknown[] = [];
  const reply = (over: object) =>
    (async (body: unknown) => {
      seen.push(body);
      return { stop_reason: 'end_turn', parsed_output: { ok: true, note: null }, model: 'claude-x', usage: { input_tokens: 5, output_tokens: 7 }, ...over };
    }) as unknown as typeof anthropicClient.messages.parse;
  anthropicClient.messages.parse = reply({});
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'ok', data: { ok: true, note: null }, model: 'claude-x', usage: { input: 5, output: 7 } });
  const content = (seen[0] as { messages: { content: { type: string }[] }[] }).messages[0].content;
  assert.deepEqual(content.map((c) => c.type), ['image', 'image', 'text']);
  anthropicClient.messages.parse = reply({ stop_reason: 'refusal' });
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'refusal' });
  anthropicClient.messages.parse = reply({ stop_reason: 'max_tokens' });
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'max_tokens' });
  anthropicClient.messages.parse = reply({ parsed_output: null });
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'invalid' });
  anthropicClient.messages.parse = (async () => {
    throw new Error('503');
  }) as unknown as typeof anthropicClient.messages.parse;
  assert.deepEqual(await anthropicEngineModel(args), { kind: 'fail', reason: 'api' });
});

test('provider switch and timeout', () => {
  assert.equal(engineModelFor({ MARK_PROVIDER: 'openai' }), openAIEngineModel);
  assert.equal(engineModelFor({}), anthropicEngineModel);
  assert.equal(engineTimeoutMs(), 60_000);
  process.env.ENGINE_TIMEOUT_MS = '5000';
  assert.equal(engineTimeoutMs(), 5000);
  process.env.ENGINE_TIMEOUT_MS = 'soon';
  assert.equal(engineTimeoutMs(), 60_000);
});

test('withRetry: one retry after a failure, none after success', async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? ({ kind: 'fail', reason: 'api' } as const) : ({ kind: 'ok', data: 1, model: 'm', usage: { input: 0, output: 0 } } as const));
  assert.equal((await withRetry(flaky)).kind, 'ok');
  assert.equal(calls, 2);
  calls = 0;
  const dead = async () => (calls++, { kind: 'fail', reason: 'refusal' } as const);
  assert.deepEqual(await withRetry(dead), { kind: 'fail', reason: 'refusal' });
  assert.equal(calls, 2);
  calls = 0;
  const fine = async () => (calls++, { kind: 'ok', data: 1, model: 'm', usage: { input: 0, output: 0 } } as const);
  await withRetry(fine);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-model.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/model`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/model.ts`:

```ts
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { DEFAULT_OPENAI_MODEL, markProvider } from '@/lib/config';
import { anthropicClient } from '@/lib/mark/anthropic';
import { OPENAI_URL, strictJsonSchema } from '@/lib/mark/openai';

// One structured model call for the engine's three roles. Unlike lib/mark's ModelCall
// it takes any output schema and several images (a problem may span photos).

export type EngineRole = 'reader' | 'matcher' | 'judge';
export interface EngineImage {
  mediaType: 'image/png' | 'image/jpeg';
  base64: string;
}
export interface EngineUsage {
  input: number;
  output: number;
}
export interface EngineModelArgs<T> {
  role: EngineRole;
  system: string;
  instruction: string;
  images: EngineImage[];
  schema: z.ZodType<T>;
}
export type EngineModelResult<T> =
  | { kind: 'ok'; data: T; model: string; usage: EngineUsage }
  | { kind: 'fail'; reason: 'refusal' | 'max_tokens' | 'invalid' | 'api' };
export type EngineModel = <T>(a: EngineModelArgs<T>) => Promise<EngineModelResult<T>>;

const ROLE_ENV = { reader: 'ENGINE_MODEL_READER', matcher: 'ENGINE_MODEL_MATCHER', judge: 'ENGINE_MODEL_JUDGE' } as const;
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** One model call may take 60 s (ENGINE_TIMEOUT_MS): a full page read is slower than a live check. */
export function engineTimeoutMs(): number {
  const v = Number(process.env.ENGINE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

function effort(): string {
  const e = process.env.ENGINE_EFFORT?.trim().toLowerCase();
  return e && EFFORTS.includes(e) ? e : 'low';
}

/** The request body for one engine call. Exported for tests. */
export function openAIEngineRequest<T>(a: EngineModelArgs<T>, model: string) {
  return {
    model,
    instructions: a.system,
    input: [
      {
        role: 'user',
        content: [
          ...a.images.map((i) => ({ type: 'input_image', image_url: `data:${i.mediaType};base64,${i.base64}`, detail: 'high' })),
          { type: 'input_text', text: a.instruction },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: a.role, schema: strictJsonSchema(a.schema), strict: true } },
    reasoning: { effort: effort() },
    max_output_tokens: 8192,
    store: false,
  };
}

type ResponsesReply = {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string } | null;
};

const log = (who: string, msg: string) => console.error(`engine: ${who} call failed`, msg);

export const openAIEngineModel: EngineModel = async (a) => {
  const model = process.env[ROLE_ENV[a.role]]?.trim() || process.env.MARK_MODEL_OPENAI?.trim() || DEFAULT_OPENAI_MODEL;
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
      body: JSON.stringify(openAIEngineRequest(a, model)),
      signal: AbortSignal.timeout(engineTimeoutMs()),
    });
    const j = (await res.json().catch(() => ({}))) as ResponsesReply;
    if (!res.ok) {
      log(a.role, `HTTP ${res.status}: ${j.error?.message ?? 'no error message'}`);
      return { kind: 'fail', reason: 'api' };
    }
    if (j.status === 'incomplete') {
      const why = j.incomplete_details?.reason;
      if (why === 'max_output_tokens') return { kind: 'fail', reason: 'max_tokens' };
      if (why === 'content_filter') return { kind: 'fail', reason: 'refusal' };
      log(a.role, `incomplete: ${why ?? 'unknown'}`);
      return { kind: 'fail', reason: 'api' };
    }
    if (j.status !== 'completed') {
      log(a.role, `status ${j.status ?? 'missing'}`);
      return { kind: 'fail', reason: 'api' };
    }
    const parts = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
    if (parts.some((p) => p.type === 'refusal')) return { kind: 'fail', reason: 'refusal' };
    const text = parts.find((p) => p.type === 'output_text')?.text;
    if (!text) return { kind: 'fail', reason: 'invalid' };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: 'fail', reason: 'invalid' };
    }
    const parsed = a.schema.safeParse(json);
    if (!parsed.success) return { kind: 'fail', reason: 'invalid' };
    return { kind: 'ok', data: parsed.data, model: j.model ?? model, usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 } };
  } catch (err) {
    log(a.role, err instanceof Error ? err.message : String(err));
    return { kind: 'fail', reason: 'api' };
  }
};

export const anthropicEngineModel: EngineModel = async (a) => {
  const model = process.env[ROLE_ENV[a.role]]?.trim() || process.env.TUTOR_MODEL?.trim() || 'claude-sonnet-5';
  try {
    const response = await anthropicClient.messages.parse(
      {
        model,
        max_tokens: 8192,
        system: a.system,
        output_config: { effort: 'low', format: zodOutputFormat(a.schema) },
        messages: [
          {
            role: 'user',
            content: [
              ...a.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.base64 } })),
              { type: 'text' as const, text: a.instruction },
            ],
          },
        ],
      },
      { timeout: engineTimeoutMs() },
    );
    if (response.stop_reason === 'refusal') return { kind: 'fail', reason: 'refusal' };
    if (response.stop_reason === 'max_tokens') return { kind: 'fail', reason: 'max_tokens' };
    const parsed = a.schema.safeParse(response.parsed_output);
    if (!parsed.success) return { kind: 'fail', reason: 'invalid' };
    return { kind: 'ok', data: parsed.data, model: response.model, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
  } catch (err) {
    log(a.role, err instanceof Error ? err.message : String(err));
    return { kind: 'fail', reason: 'api' };
  }
};

/** The engine model for MARK_PROVIDER: anthropic (default) | openai. */
export function engineModelFor(env: Record<string, string | undefined> = process.env): EngineModel {
  return markProvider(env) === 'openai' ? openAIEngineModel : anthropicEngineModel;
}

/** One retry after any failure, as the spec requires; the second failure is returned. */
export async function withRetry<T>(call: () => Promise<EngineModelResult<T>>): Promise<EngineModelResult<T>> {
  const first = await call();
  return first.kind === 'ok' ? first : call();
}

/** Raised when a problem could not be marked this time. The caller may try again and must not count the attempt. */
export class EngineError extends Error {
  readonly retryable = true;
  constructor(
    public readonly stage: 'reader' | 'matcher' | 'checker',
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
```

- [ ] **Step 4: Run the test**

Run: `node --import tsx --test tests/engine-model.test.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/model.ts tests/engine-model.test.ts
git commit -m "Add the engine's structured model call for both providers"
```

---

### Task 12: Reader

**Files:**
- Create: `lib/engine/reader.ts`
- Test: `tests/engine-reader.test.ts`

**Interfaces:**
- Consumes: `EngineError`, `engineModelFor`, `withRetry`, `EngineImage`, `EngineModel`, `EngineUsage`; `Question`, `Transcript`.
- Produces: `readProblem(images: EngineImage[], question: Question, deps?: { model: EngineModel }): Promise<ReadOutcome>`; `ReadOutcome = { kind: 'transcript'; transcript: Transcript; usage: EngineUsage } | { kind: 'retake'; reason: string }`; `ReaderSchema`, `READER_SYSTEM`, `readerInstruction`, the limits `MAX_IMAGES` (4), `MAX_IMAGE_BASE64`, `MAX_LINES` (40), `MAX_LATEX` (400), and the three `RETAKE_*` messages. Throws `EngineError('reader')` after one failed retry; throws `TypeError` for zero or more than four images.

Every line comes back `confirmed: false`. The caller sets `confirmed: true` on lines the student accepted or corrected in the read-back.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-reader.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, type EngineModel, type EngineModelArgs } from '@/lib/engine/model';
import { MAX_IMAGE_BASE64, MAX_LATEX, MAX_LINES, READER_SYSTEM, RETAKE_DEFAULT, RETAKE_EMPTY, RETAKE_TOO_LARGE, readProblem, readerInstruction } from '@/lib/engine/reader';
import type { Question } from '@/lib/engine/types';

const Q: Question = {
  id: 'q',
  topic: 'derivatives',
  prompt: 'Differentiate y = \\sin(x^2).',
  variable: 'x',
  variables: ['x'],
  answer: '2*x*cos(x**2)',
  points: [{ id: 'P1', label: 'Chain rule', value: 2, kind: 'cas', check: { type: 'equivalent', expected: 'diff(sin(x**2), x)' }, requires: [], followThrough: false }],
};
const img = { mediaType: 'image/jpeg' as const, base64: 'AAAA' };
const box = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.3 };
const line = (latex: string, over: object = {}) => ({ image: 0, latex, box, confidence: 'high' as const, ...over });

function model(replies: unknown[], calls: EngineModelArgs<unknown>[] = []): EngineModel {
  let k = 0;
  return (async (a: EngineModelArgs<unknown>) => {
    calls.push(a);
    const r = replies[Math.min(k++, replies.length - 1)];
    return r === 'fail' ? { kind: 'fail', reason: 'api' } : { kind: 'ok', data: r, model: 'm', usage: { input: 10, output: 5 } };
  }) as EngineModel;
}
const read = (data: unknown, images = [img]) => readProblem(images, Q, { model: model([data]) });

test('a readable page becomes numbered, unconfirmed lines', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const r = await readProblem([img], Q, { model: model([{ readable: true, retakeReason: '', lines: [line('\\frac{dy}{dx} = 2x\\cos(x^{2})'), line('= 2x\\cos(x^{2})', { confidence: 'low' })] }], calls) });
  assert.equal(r.kind, 'transcript');
  if (r.kind !== 'transcript') return;
  assert.deepEqual(r.transcript.lines.map((l) => [l.n, l.image, l.confidence, l.confirmed]), [[1, 0, 'high', false], [2, 0, 'low', false]]);
  assert.deepEqual(r.usage, { input: 10, output: 5 });
  assert.equal(calls[0].role, 'reader');
  assert.equal(calls[0].system, READER_SYSTEM);
  assert.deepEqual(calls[0].images, [img]);
});

test('the instruction names the question and variables and forbids guessing', () => {
  const s = readerInstruction(Q, 2);
  assert.match(s, /Differentiate y/);
  assert.match(s, /Variables in this question: x\./);
  assert.match(s, /are 2 images/);
  assert.match(s, /Do not use the question to guess/);
});

test('unreadable: the model\'s reason, or the default when it gives none', async () => {
  assert.deepEqual(await read({ readable: false, retakeReason: 'Too dark.', lines: [] }), { kind: 'retake', reason: 'Too dark.' });
  assert.deepEqual(await read({ readable: false, retakeReason: '  ', lines: [] }), { kind: 'retake', reason: RETAKE_DEFAULT });
});

test('a blank page, or lines of only whitespace, asks for a retake', async () => {
  assert.deepEqual(await read({ readable: true, retakeReason: '', lines: [] }), { kind: 'retake', reason: RETAKE_EMPTY });
  assert.deepEqual(await read({ readable: true, retakeReason: '', lines: [line('   '), line('\u0000')] }), { kind: 'retake', reason: RETAKE_EMPTY });
});

test('an oversized image is refused before any model call', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const big = { mediaType: 'image/jpeg' as const, base64: 'A'.repeat(MAX_IMAGE_BASE64 + 1) };
  assert.deepEqual(await readProblem([big], Q, { model: model([{}], calls) }), { kind: 'retake', reason: RETAKE_TOO_LARGE });
  assert.equal(calls.length, 0);
});

test('no images, or more than four, is a caller bug', async () => {
  await assert.rejects(() => readProblem([], Q, { model: model([{}]) }), TypeError);
  await assert.rejects(() => readProblem([img, img, img, img, img], Q, { model: model([{}]) }), TypeError);
});

test('boxes are clamped and ordered; a bad image index is pulled into range', async () => {
  const r = await read({ readable: true, retakeReason: '', lines: [line('x', { image: 7, box: { x0: 1.4, y0: 0.5, x1: -0.2, y1: 0.1 } }), line('y', { image: -3, box: { x0: NaN, y0: 0, x1: 0.5, y1: 0.5 } })] }, [img, img]);
  assert.equal(r.kind, 'transcript');
  if (r.kind !== 'transcript') return;
  assert.deepEqual(r.transcript.lines[0].box, { x0: 0, y0: 0.1, x1: 1, y1: 0.5 });
  assert.equal(r.transcript.lines[0].image, 1);
  assert.equal(r.transcript.lines[1].image, 0);
  assert.deepEqual(r.transcript.lines[1].box, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 });
});

test('an over-long line is cut and can no longer be trusted; a huge page is capped', async () => {
  const many = Array.from({ length: MAX_LINES + 10 }, (_, k) => line(`x + ${k}`));
  many[0] = line('x'.repeat(MAX_LATEX + 50));
  const r = await read({ readable: true, retakeReason: '', lines: many });
  assert.equal(r.kind, 'transcript');
  if (r.kind !== 'transcript') return;
  assert.equal(r.transcript.lines.length, MAX_LINES);
  assert.equal(r.transcript.lines[0].latex.length, MAX_LATEX);
  assert.equal(r.transcript.lines[0].confidence, 'low');
});

test('one retry, then a retryable EngineError', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const ok = { readable: true, retakeReason: '', lines: [line('x')] };
  assert.equal((await readProblem([img], Q, { model: model(['fail', ok], calls) })).kind, 'transcript');
  assert.equal(calls.length, 2);
  await assert.rejects(
    () => readProblem([img], Q, { model: model(['fail', 'fail']) }),
    (e: unknown) => e instanceof EngineError && e.stage === 'reader' && e.retryable === true,
  );
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-reader.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/reader`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/reader.ts`:

```ts
import { z } from 'zod';
import { EngineError, engineModelFor, withRetry, type EngineImage, type EngineModel, type EngineUsage } from './model';
import type { Question, Transcript } from './types';

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BASE64 = 6_000_000;
export const MAX_LINES = 40;
export const MAX_LATEX = 400;

export const RETAKE_DEFAULT = 'We could not read this. Please retake the photo straight on, in good light.';
export const RETAKE_EMPTY = 'No working was found on this page.';
export const RETAKE_TOO_LARGE = 'That image is too large. Please retake it at a lower resolution.';

const Frac = z.number();
export const ReaderSchema = z.object({
  readable: z.boolean(),
  retakeReason: z.string(),
  lines: z.array(
    z.object({
      image: z.number(),
      latex: z.string(),
      box: z.object({ x0: Frac, y0: Frac, x1: Frac, y1: Frac }),
      confidence: z.enum(['high', 'low']),
    }),
  ),
});

export const READER_SYSTEM = `You transcribe a student's handwritten calculus working. You do not mark it.

Return one entry per written line, in reading order.

Rules for each line:
- Copy exactly what is written, including mistakes. Never correct, complete or tidy the maths.
- Write LaTeX using only: \\frac, \\sqrt, ^{}, _{}, \\sin \\cos \\tan \\sec \\csc \\cot, \\arcsin \\arccos \\arctan, \\ln, \\log, \\int, \\lim, \\to, \\infty, \\pi, \\theta, \\Delta, \\cdot, \\sum, \\left, \\right.
- Always put braces round an exponent or subscript: x^{2}, \\int_{0}^{2}, x^{10}.
- Write a derivative as a fraction, \\frac{dy}{dx}, never dy/dx.
- If the line begins with an equals sign, begin the LaTeX with =.
- For an evaluation bar or bracket with limits, write only the expression being evaluated.
- Put words inside \\text{...}. A line of only words is one \\text{...}.
- Skip anything crossed out.
- box is the line's position as fractions of that image's width and height: x0,y0 top-left, x1,y1 bottom-right, each between 0 and 1.
- image is the index of the image the line is on, starting at 0.
- confidence is "low" if any character is unclear or could be read two ways, otherwise "high".

If the image is too blurred, dark, rotated or cropped to read, or shows no handwritten maths, set readable to false, give a short retakeReason telling the student what to fix, and return no lines. Otherwise set readable to true and retakeReason to "".`;

/** The question is shown only to settle which letters are variables, never to guess what was meant. */
export function readerInstruction(question: Question, imageCount: number): string {
  return [
    `The student is answering: ${question.prompt}`,
    `Variables in this question: ${question.variables.join(', ')}.`,
    `There ${imageCount === 1 ? 'is 1 image' : `are ${imageCount} images`}.`,
    'Do not use the question to guess what the student meant. Transcribe what is on the page.',
  ].join('\n');
}

export type ReadOutcome =
  | { kind: 'transcript'; transcript: Transcript; usage: EngineUsage }
  | { kind: 'retake'; reason: string };

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const unit = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export async function readProblem(
  images: EngineImage[],
  question: Question,
  deps: { model: EngineModel } = { model: engineModelFor() },
): Promise<ReadOutcome> {
  if (images.length === 0 || images.length > MAX_IMAGES) throw new TypeError(`readProblem takes 1 to ${MAX_IMAGES} images`);
  if (images.some((i) => i.base64.length > MAX_IMAGE_BASE64)) return { kind: 'retake', reason: RETAKE_TOO_LARGE };

  const res = await withRetry(() =>
    deps.model({ role: 'reader', system: READER_SYSTEM, instruction: readerInstruction(question, images.length), images, schema: ReaderSchema }),
  );
  if (res.kind === 'fail') throw new EngineError('reader', `The reader failed: ${res.reason}`);
  if (!res.data.readable) return { kind: 'retake', reason: clean(res.data.retakeReason, 200) || RETAKE_DEFAULT };

  const lines = res.data.lines
    .map((l) => ({ ...l, latex: clean(l.latex, MAX_LATEX + 1) }))
    .filter((l) => l.latex)
    .slice(0, MAX_LINES)
    .map((l, k) => {
      const [x0, x1] = [unit(l.box.x0), unit(l.box.x1)].sort((a, b) => a - b);
      const [y0, y1] = [unit(l.box.y0), unit(l.box.y1)].sort((a, b) => a - b);
      const tooLong = l.latex.length > MAX_LATEX;
      return {
        n: k + 1,
        image: Math.min(images.length - 1, Math.max(0, Math.round(Number.isFinite(l.image) ? l.image : 0))),
        latex: l.latex.slice(0, MAX_LATEX),
        box: { x0, y0, x1, y1 },
        // A line cut short cannot be trusted to say what the student wrote.
        confidence: tooLong ? ('low' as const) : l.confidence,
        confirmed: false,
      };
    });
  if (lines.length === 0) return { kind: 'retake', reason: RETAKE_EMPTY };
  return { kind: 'transcript', transcript: { lines }, usage: res.usage };
}
```

- [ ] **Step 4: Run the test**

Run: `node --import tsx --test tests/engine-reader.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/reader.ts tests/engine-reader.test.ts
git commit -m "Add the engine's handwriting reader"
```

---

### Task 13: Matcher and judge

**Files:**
- Create: `lib/engine/matcher.ts`, `lib/engine/judge.ts`
- Test: `tests/engine-matcher.test.ts`

**Interfaces:**
- Consumes: `EngineError`, `engineModelFor`, `withRetry`, `EngineModel`, `EngineUsage`; `Alignment`, `Judgement`, `Question`, `Transcript`, `TransitionKind`.
- Produces: `matchLines(question, transcript, deps?): Promise<{ alignment: Alignment; usage: EngineUsage }>` (throws `EngineError('matcher')`); `sanitiseAlignment(question, transcript, raw): Alignment`; `MatcherSchema`, `RawAlignment`, `MATCHER_SYSTEM`, `matcherInstruction`, `TRANSITIONS`; `judgePoints(question, transcript, deps?): Promise<{ judgements: Judgement[] | null; usage: EngineUsage }>` (never throws; `null` when the judge could not be reached); `JudgeSchema`, `JUDGE_SYSTEM`, `judgeInstruction`.

The matcher is shown point labels only, never expected values, so it cannot line things up by correctness. The judge is shown criteria only. Neither receives the image.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-matcher.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, type EngineModel, type EngineModelArgs } from '@/lib/engine/model';
import { matchLines, matcherInstruction, sanitiseAlignment, type RawAlignment } from '@/lib/engine/matcher';
import { judgeInstruction, judgePoints } from '@/lib/engine/judge';
import type { Question, Transcript } from '@/lib/engine/types';

const Q: Question = {
  id: 'q',
  topic: 'optimisation',
  prompt: 'A rectangle has perimeter 40. Find the largest possible area.',
  variable: 'x',
  variables: ['x'],
  answer: '100',
  points: [
    { id: 'P1', label: 'Area in one variable', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'x*(20 - x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Justifies that it is a maximum', value: 1, kind: 'judge', criterion: 'Justifies the maximum', requires: [], followThrough: false },
    { id: 'P3', label: 'Largest area', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '100' }, requires: [], followThrough: false },
  ],
};
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const T: Transcript = { lines: ['A = x(20 - x)', '\\text{second derivative negative so max}', 'A = 100'].map((latex, k) => ({ n: k + 1, image: 0, latex, box, confidence: 'high' as const, confirmed: false })) };

function model(replies: unknown[], calls: EngineModelArgs<unknown>[] = []): EngineModel {
  let k = 0;
  return (async (a: EngineModelArgs<unknown>) => {
    calls.push(a);
    const r = replies[Math.min(k++, replies.length - 1)];
    return r === 'fail' ? { kind: 'fail', reason: 'api' } : { kind: 'ok', data: r, model: 'm', usage: { input: 3, output: 2 } };
  }) as EngineModel;
}

test('matcher instruction shows labels of CAS points only, never expected values or criteria', () => {
  const s = matcherInstruction(Q, T);
  assert.match(s, /P1: Area in one variable/);
  assert.match(s, /P3: Largest area/);
  assert.ok(!s.includes('P2'));
  assert.ok(!s.includes('x*(20 - x)'));
  assert.match(s, /3\. A = 100/);
});

test('sanitise: missing lines become unknown, bad references are dropped, substitution only with substitute', () => {
  const raw: RawAlignment = {
    lines: [
      { n: 1, transition: 'rewrite', substitution: { variable: 'x', latex: '2' } },
      { n: 3, transition: 'substitute', substitution: { variable: 'x', latex: ' 10 ' } },
      { n: 9, transition: 'differentiate', substitution: null },
    ],
    points: [
      { id: 'P1', line: 1 },
      { id: 'P2', line: 2 },
      { id: 'P3', line: 8 },
      { id: 'P7', line: 1 },
    ],
  };
  assert.deepEqual(sanitiseAlignment(Q, T, raw), {
    lines: [
      { n: 1, transition: 'rewrite', substitution: null },
      { n: 2, transition: 'unknown', substitution: null },
      { n: 3, transition: 'substitute', substitution: { variable: 'x', latex: '10' } },
    ],
    points: [
      { id: 'P1', line: 1 },
      { id: 'P3', line: null },
    ],
  });
});

test('sanitise: a substitution with a bad variable or an empty value is dropped', () => {
  const sub = (variable: string, latex: string): RawAlignment => ({ lines: [{ n: 1, transition: 'substitute', substitution: { variable, latex } }], points: [] });
  assert.equal(sanitiseAlignment(Q, T, sub('xy', '2')).lines[0].substitution, null);
  assert.equal(sanitiseAlignment(Q, T, sub('x', '  ')).lines[0].substitution, null);
  assert.equal(sanitiseAlignment(Q, T, sub('x', '1'.repeat(101))).lines[0].substitution, null);
});

test('matchLines: no image is sent; one retry, then EngineError', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const ok = { lines: [], points: [{ id: 'P1', line: 1 }] };
  const r = await matchLines(Q, T, { model: model(['fail', ok], calls) });
  assert.deepEqual(r.alignment.points, [{ id: 'P1', line: 1 }, { id: 'P3', line: null }]);
  assert.deepEqual(r.usage, { input: 3, output: 2 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].images, []);
  assert.equal(calls[0].role, 'matcher');
  await assert.rejects(() => matchLines(Q, T, { model: model(['fail']) }), (e: unknown) => e instanceof EngineError && e.stage === 'matcher');
});

test('judge instruction lists criteria of judged points only', () => {
  const s = judgeInstruction(Q, T);
  assert.match(s, /P2: Justifies the maximum/);
  assert.ok(!s.includes('P1:'));
  assert.match(s, /2\. \\text\{second derivative negative so max\}/);
});

test('judge: one judgement per judged point; a point the model skipped is not met', async () => {
  const r = await judgePoints(Q, T, { model: model([{ judgements: [{ id: 'P2', met: true, line: 2, quote: 'second derivative negative' }, { id: 'P1', met: true, line: 1, quote: 'A' }] }]) });
  assert.deepEqual(r.judgements, [{ id: 'P2', met: true, line: 2, quote: 'second derivative negative' }]);
  const skipped = await judgePoints(Q, T, { model: model([{ judgements: [] }]) });
  assert.deepEqual(skipped.judgements, [{ id: 'P2', met: false, line: null, quote: '' }]);
});

test('judge: no judged points means no model call; a dead judge gives null', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const casOnly = { ...Q, points: [Q.points[0]] };
  assert.deepEqual(await judgePoints(casOnly, T, { model: model([{}], calls) }), { judgements: [], usage: { input: 0, output: 0 } });
  assert.equal(calls.length, 0);
  const dead = await judgePoints(Q, T, { model: model(['fail'], calls) });
  assert.equal(dead.judgements, null);
  assert.equal(calls.length, 2);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-matcher.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/matcher`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/matcher.ts`:

```ts
import { z } from 'zod';
import { EngineError, engineModelFor, withRetry, type EngineModel, type EngineUsage } from './model';
import type { Alignment, Question, Transcript, TransitionKind } from './types';

export const TRANSITIONS = ['rewrite', 'differentiate', 'integrate', 'take_limit', 'substitute', 'evaluate', 'unknown'] as const;

export const MatcherSchema = z.object({
  lines: z.array(
    z.object({
      n: z.number(),
      transition: z.enum(TRANSITIONS),
      substitution: z.object({ variable: z.string(), latex: z.string() }).nullable(),
    }),
  ),
  points: z.array(z.object({ id: z.string(), line: z.number().nullable() })),
});
export type RawAlignment = z.infer<typeof MatcherSchema>;

export const MATCHER_SYSTEM = `You line up a student's calculus working with a marking rubric. You never decide whether anything is correct.

For every numbered line, say how it follows from the line of maths above it (or, for the first line, from the question):
- "rewrite": the same quantity or equation in another form (expanding, factoring, simplifying, rearranging, solving).
- "differentiate": the line is meant to be the derivative of the line above.
- "integrate": the line is meant to be an antiderivative of the line above.
- "take_limit": the line is meant to be the value of the limit written above.
- "substitute": a value is put in for a variable. Give the variable and the value as LaTeX in substitution.
- "evaluate": arithmetic on numbers only.
- "unknown": a new starting point, words, or anything else.
Set substitution to null unless the transition is "substitute".

For every rubric point, give the number of the first line where the student attempts that step, or null if no line attempts it. Choose by what the line is trying to do, not by whether it is right. One line may attempt several points.`;

export function matcherInstruction(question: Question, transcript: Transcript): string {
  const points = question.points.filter((p) => p.kind === 'cas').map((p) => `${p.id}: ${p.label}`);
  return [
    `Question: ${question.prompt}`,
    '',
    'Rubric points:',
    ...points,
    '',
    'Student lines:',
    ...transcript.lines.map((l) => `${l.n}. ${l.latex}`),
  ].join('\n');
}

/** Keeps only what refers to real lines and real CAS points; everything else falls back to "unknown" or null. */
export function sanitiseAlignment(question: Question, transcript: Transcript, raw: RawAlignment): Alignment {
  const real = new Set(transcript.lines.map((l) => l.n));
  return {
    lines: transcript.lines.map((l) => {
      const m = raw.lines.find((x) => x.n === l.n);
      const transition: TransitionKind = m?.transition ?? 'unknown';
      const s = m?.substitution;
      const substitution =
        transition === 'substitute' && s && /^[A-Za-z]$/.test(s.variable) && s.latex.trim() && s.latex.length <= 100
          ? { variable: s.variable, latex: s.latex.trim() }
          : null;
      return { n: l.n, transition, substitution };
    }),
    points: question.points
      .filter((p) => p.kind === 'cas')
      .map((p) => {
        const line = raw.points.find((x) => x.id === p.id)?.line ?? null;
        return { id: p.id, line: line !== null && real.has(line) ? line : null };
      }),
  };
}

export async function matchLines(
  question: Question,
  transcript: Transcript,
  deps: { model: EngineModel } = { model: engineModelFor() },
): Promise<{ alignment: Alignment; usage: EngineUsage }> {
  const res = await withRetry(() =>
    deps.model({ role: 'matcher', system: MATCHER_SYSTEM, instruction: matcherInstruction(question, transcript), images: [], schema: MatcherSchema }),
  );
  if (res.kind === 'fail') throw new EngineError('matcher', `The matcher failed: ${res.reason}`);
  return { alignment: sanitiseAlignment(question, transcript, res.data), usage: res.usage };
}
```

Create `lib/engine/judge.ts`:

```ts
import { z } from 'zod';
import { engineModelFor, withRetry, type EngineModel, type EngineUsage } from './model';
import type { Judgement, Question, Transcript } from './types';

export const JudgeSchema = z.object({
  judgements: z.array(z.object({ id: z.string(), met: z.boolean(), line: z.number().nullable(), quote: z.string() })),
});

export const JUDGE_SYSTEM = `You check whether a student's working states a required reason. You do not check any calculation.

For each criterion, decide whether one of the student's lines states it. If one does, set met to true, give that line's number, and copy the exact characters from that line that state it into quote. If no line states it, set met to false, line to null and quote to "".

Only what is written counts. Do not give credit for a reason the student could have given, or one that is implied by correct working. The quote must be copied character for character from the line you name.`;

export function judgeInstruction(question: Question, transcript: Transcript): string {
  const criteria = question.points.filter((p) => p.kind === 'judge').map((p) => `${p.id}: ${p.criterion}`);
  return [`Question: ${question.prompt}`, '', 'Criteria:', ...criteria, '', 'Student lines:', ...transcript.lines.map((l) => `${l.n}. ${l.latex}`)].join('\n');
}

const NONE: EngineUsage = { input: 0, output: 0 };

/**
 * One judgement per judged point. `judgements` is null when the judge could not
 * be reached, which the scorer turns into "couldn't check". The scorer, not this
 * function, enforces that the quote is really on the named line.
 */
export async function judgePoints(
  question: Question,
  transcript: Transcript,
  deps: { model: EngineModel } = { model: engineModelFor() },
): Promise<{ judgements: Judgement[] | null; usage: EngineUsage }> {
  const judged = question.points.filter((p) => p.kind === 'judge');
  if (judged.length === 0) return { judgements: [], usage: NONE };
  const res = await withRetry(() =>
    deps.model({ role: 'judge', system: JUDGE_SYSTEM, instruction: judgeInstruction(question, transcript), images: [], schema: JudgeSchema }),
  );
  if (res.kind === 'fail') return { judgements: null, usage: NONE };
  return {
    judgements: judged.map((p) => {
      const j = res.data.judgements.find((x) => x.id === p.id);
      return j ? { id: p.id, met: j.met, line: j.line, quote: j.quote } : { id: p.id, met: false, line: null, quote: '' };
    }),
    usage: res.usage,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `node --import tsx --test tests/engine-matcher.test.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/matcher.ts lib/engine/judge.ts tests/engine-matcher.test.ts
git commit -m "Add the engine's matcher and judge"
```

---

### Task 14: markProblem and the public surface

**Files:**
- Create: `lib/engine/mark.ts`, `lib/engine/index.ts`
- Test: `tests/engine-mark.test.ts`

**Interfaces:**
- Consumes: `buildCheckRequest`, `callChecker`, `CheckerCall`; `judgePoints`; `matchLines`; `EngineError`, `engineModelFor`, `EngineModel`; `scoreProblem`.
- Produces: `MarkDeps { model: EngineModel; checker: CheckerCall }`; `markProblem(question, profile, transcript, deps?): Promise<MarkResult>` (throws `EngineError('matcher' | 'checker')`; `trace.usage` holds the summed token usage); `unparsedLines(question, transcript, deps?): Promise<number[]>`; `lib/engine/index.ts` re-exporting `readProblem`, `ReadOutcome`, `markProblem`, `unparsedLines`, `MarkDeps`, `scoreExam`, `EngineError`, `EngineImage`, `AP_DEFAULT`, `parseQuestion` and every type.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-mark.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckerCall } from '@/lib/engine/checker-client';
import { markProblem, unparsedLines } from '@/lib/engine/mark';
import { EngineError, type EngineModel, type EngineModelArgs } from '@/lib/engine/model';
import { AP_DEFAULT } from '@/lib/engine/profiles';
import type { CheckRequest, CheckResponse, Question, Transcript } from '@/lib/engine/types';

const Q: Question = {
  id: 'q',
  topic: 'derivatives',
  prompt: 'f(x) = x^3 + x^2. Find f\'(2) and say whether f is increasing there.',
  variable: 'x',
  variables: ['x'],
  given: 'x**3 + x**2',
  answer: '16',
  points: [
    { id: 'P1', label: 'Differentiates', value: 1, kind: 'cas', check: { type: 'equivalent', expected: 'diff(x**3 + x**2, x)' }, requires: [], followThrough: false },
    { id: 'P2', label: 'Evaluates at 2', value: 1, kind: 'cas', check: { type: 'exact_value', expected: '({P1}).subs(x, 2)' }, requires: [], followThrough: true },
    { id: 'P3', label: 'Reason', value: 1, kind: 'judge', criterion: 'States that f is increasing because the derivative is positive', requires: [], followThrough: false },
  ],
};
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
const T: Transcript = { lines: ["f'(x) = 3x^{2} + 2x", "f'(2) = 16", '\\text{increasing since 16 > 0}'].map((latex, k) => ({ n: k + 1, image: 0, latex, box, confidence: 'high' as const, confirmed: true })) };

const alignment = { lines: [{ n: 1, transition: 'differentiate', substitution: null }, { n: 2, transition: 'substitute', substitution: { variable: 'x', latex: '2' } }, { n: 3, transition: 'unknown', substitution: null }], points: [{ id: 'P1', line: 1 }, { id: 'P2', line: 2 }] };
const judgements = { judgements: [{ id: 'P3', met: true, line: 3, quote: 'increasing since 16 > 0' }] };
const checkOk: CheckResponse = {
  lines: [{ n: 1, parsed: true }, { n: 2, parsed: true }, { n: 3, parsed: false }],
  transitions: [{ to: 1, outcome: 'right' }, { to: 2, outcome: 'right' }, { to: 3, outcome: 'unchecked' }],
  points: [{ id: 'P1', outcome: 'right', ftOutcome: null, ftRefused: false, note: null }, { id: 'P2', outcome: 'right', ftOutcome: null, ftRefused: false, note: null }],
  final: 'unchecked',
};

function model(by: Partial<Record<'matcher' | 'judge', unknown>>, calls: EngineModelArgs<unknown>[] = []): EngineModel {
  return (async (a: EngineModelArgs<unknown>) => {
    calls.push(a);
    const r = by[a.role as 'matcher' | 'judge'];
    return r === undefined || r === 'fail' ? { kind: 'fail', reason: 'api' } : { kind: 'ok', data: r, model: 'm', usage: { input: 100, output: 10 } };
  }) as EngineModel;
}
const checker = (data: CheckResponse | 'down', seen: CheckRequest[] = []): CheckerCall => async (req) => {
  seen.push(req);
  return data === 'down' ? { kind: 'down' } : { kind: 'ok', data };
};

test('marks a problem end to end: matcher and judge feed the checker, the scorer decides', async () => {
  const seen: CheckRequest[] = [];
  const r = await markProblem(Q, AP_DEFAULT, T, { model: model({ matcher: alignment, judge: judgements }), checker: checker(checkOk, seen) });
  assert.deepEqual(r.points.map((p) => p.status), ['earned', 'earned', 'earned']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [3, 3, 0]);
  assert.deepEqual(seen[0].points.map((p) => [p.id, p.line]), [['P1', 1], ['P2', 2]]);
  assert.equal(seen[0].finalPoint, null);
  assert.deepEqual((r.trace as { usage: unknown }).usage, { input: 200, output: 20 });
});

test('an empty transcript scores zero without calling a model or the checker', async () => {
  const calls: EngineModelArgs<unknown>[] = [];
  const seen: CheckRequest[] = [];
  const r = await markProblem(Q, AP_DEFAULT, { lines: [] }, { model: model({}, calls), checker: checker('down', seen) });
  assert.deepEqual(r.points.map((p) => p.status), ['not_earned', 'not_earned', 'not_earned']);
  assert.deepEqual([r.earned, r.total], [0, 3]);
  assert.equal(calls.length + seen.length, 0);
});

test('checker down: a retryable EngineError, not a score', async () => {
  await assert.rejects(
    () => markProblem(Q, AP_DEFAULT, T, { model: model({ matcher: alignment, judge: judgements }), checker: checker('down') }),
    (e: unknown) => e instanceof EngineError && e.stage === 'checker' && e.retryable,
  );
});

test('matcher down: a retryable EngineError', async () => {
  await assert.rejects(
    () => markProblem(Q, AP_DEFAULT, T, { model: model({ judge: judgements }), checker: checker(checkOk) }),
    (e: unknown) => e instanceof EngineError && e.stage === 'matcher',
  );
});

test('judge down: the judged point is left out, the rest is still marked', async () => {
  const r = await markProblem(Q, AP_DEFAULT, T, { model: model({ matcher: alignment }), checker: checker(checkOk) });
  assert.deepEqual(r.points.map((p) => p.status), ['earned', 'earned', 'unchecked']);
  assert.deepEqual([r.earned, r.total, r.unchecked], [2, 2, 1]);
});

test('unparsedLines: maths the checker cannot parse, but not lines of words', async () => {
  const t: Transcript = { lines: [...T.lines, { n: 4, image: 0, latex: 'x \\ge 0', box, confidence: 'high', confirmed: false }] };
  const reply: CheckResponse = { lines: [{ n: 1, parsed: true }, { n: 2, parsed: true }, { n: 3, parsed: false }, { n: 4, parsed: false }], transitions: [], points: [], final: 'unchecked' };
  assert.deepEqual(await unparsedLines(Q, t, { checker: checker(reply) }), [4]);
  await assert.rejects(() => unparsedLines(Q, t, { checker: checker('down') }), EngineError);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-mark.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/mark`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/mark.ts`:

```ts
import { buildCheckRequest, callChecker, type CheckerCall } from './checker-client';
import { judgePoints } from './judge';
import { matchLines } from './matcher';
import { EngineError, engineModelFor, type EngineModel } from './model';
import { scoreProblem } from './scorer';
import type { Alignment, CheckResponse, MarkResult, Profile, Question, Transcript } from './types';

export interface MarkDeps {
  model: EngineModel;
  checker: CheckerCall;
}
const defaults = (): MarkDeps => ({ model: engineModelFor(), checker: callChecker });

/**
 * Marks one problem from a transcript the student has had the chance to confirm.
 * Throws EngineError (retryable) when the matcher or the checker could not be
 * reached; the caller must not count that attempt against the student.
 */
export async function markProblem(question: Question, profile: Profile, transcript: Transcript, deps: MarkDeps = defaults()): Promise<MarkResult> {
  if (transcript.lines.length === 0) {
    // Nothing written: nothing to align or check, and no model call to pay for.
    const alignment: Alignment = { lines: [], points: [] };
    const check: CheckResponse = { lines: [], transitions: [], points: [], final: 'unchecked' };
    return scoreProblem({ question, profile, transcript, alignment, check, judgements: question.points.filter((p) => p.kind === 'judge').map((p) => ({ id: p.id, met: false, line: null, quote: '' })) });
  }
  const [matched, judged] = await Promise.all([matchLines(question, transcript, deps), judgePoints(question, transcript, deps)]);
  const check = await deps.checker(buildCheckRequest(question, transcript, matched.alignment));
  if (check.kind === 'down') throw new EngineError('checker', 'The checker could not be reached');
  const result = scoreProblem({ question, profile, transcript, alignment: matched.alignment, check: check.data, judgements: judged.judgements });
  const usage = { input: matched.usage.input + judged.usage.input, output: matched.usage.output + judged.usage.output };
  return { ...result, trace: { ...(result.trace as object), usage } };
}

/**
 * Line numbers of maths the checker cannot parse, for the read-back to ask the
 * student to retype. Lines of words (\text{...}) are expected not to parse and are left out.
 */
export async function unparsedLines(question: Question, transcript: Transcript, deps: { checker: CheckerCall } = { checker: callChecker }): Promise<number[]> {
  const res = await deps.checker(buildCheckRequest({ ...question, points: [question.points[0]] }, transcript, { lines: [], points: [] }));
  if (res.kind === 'down') throw new EngineError('checker', 'The checker could not be reached');
  const words = new Set(transcript.lines.filter((l) => /^\\text\{[^{}]*\}$/.test(l.latex.trim())).map((l) => l.n));
  return res.data.lines.filter((l) => !l.parsed && !words.has(l.n)).map((l) => l.n);
}
```

Create `lib/engine/index.ts`:

```ts
// The Calc I marking engine. Callers use these three calls and the types:
//   readProblem  -> a transcript for the student to confirm (or a retake reason)
//   markProblem  -> points and line statuses for one problem
//   scoreExam    -> the exam total, with exam-wide penalties applied once
export { readProblem, type ReadOutcome } from './reader';
export { markProblem, unparsedLines, type MarkDeps } from './mark';
export { scoreExam } from './scorer';
export { EngineError, type EngineImage } from './model';
export { AP_DEFAULT } from './profiles';
export { parseQuestion } from './rubric';
export type * from './types';
```

- [ ] **Step 4: Run the test, then everything**

Run: `node --import tsx --test tests/engine-mark.test.ts`
Expected: 6 pass, 0 fail.

Run: `npm test && npx tsc --noEmit`
Expected: 0 fail; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/mark.ts lib/engine/index.ts tests/engine-mark.test.ts
git commit -m "Add markProblem and the engine's public surface"
```

---

### Task 15: Launch metrics and the evaluation script

**Files:**
- Create: `lib/engine/eval.ts`, `scripts/eval-engine.ts`, `eval/README.md`
- Test: `tests/engine-eval.test.ts`

**Interfaces:**
- Consumes: `MarkResult`; `markProblem`; `readProblem`; `EngineError`, `EngineImage`; `AP_DEFAULT`; `CALC1_QUESTIONS`, `getCalc1Question`, `ModelLine`; `fixtures/engine/typed.json`.
- Produces: `FALSE_RED_MAX = 0.02`, `AGREEMENT_MIN = 0.85`; `HandInPath`, `GraderMark`, `EvalSolution`, `EvalRun`, `Adjudication`, `PathMetrics`; `redLines(runs)`; `metricsFor(path, runs, adjudication): PathMetrics`; the commands `npm run eval:typed` and `npm run eval:engine`.

False red cannot be measured from a blind grade alone, because the grader and the reader split a page into lines differently. So it is measured in a second pass: the script lists every line the engine marked wrong, the grader says for each whether the handwritten line really is wrong, and the rate is the lines the grader calls fine divided by all the lines the grader judged correct in the blind pass. Until every red line has a verdict the rate, and `passes`, are `null`.

- [ ] **Step 1: Write the failing test**

Create `tests/engine-eval.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGREEMENT_MIN, FALSE_RED_MAX, metricsFor, redLines, type EvalRun } from '@/lib/engine/eval';
import type { MarkResult, PointStatus } from '@/lib/engine/types';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
function run(id: string, path: 'canvas' | 'photo', grader: { points: Record<string, boolean>; score: number; correctLines: number }, engine: { points: Record<string, PointStatus>; lines: ('ok' | 'wrong' | 'unchecked')[] } | null): EvalRun {
  const result: MarkResult | null = engine && {
    questionId: 'q',
    points: Object.entries(engine.points).map(([pid, status]) => ({ id: pid, status, verifiedBy: 'cas' as const, reason: '' })),
    lines: engine.lines.map((status, k) => ({ n: k + 1, image: 0, status, box })),
    earned: Object.values(engine.points).filter((s) => s === 'earned' || s === 'earned_follow_through').length,
    total: Object.values(engine.points).filter((s) => s !== 'unchecked').length,
    unchecked: Object.values(engine.points).filter((s) => s === 'unchecked').length,
    penaltyFlags: [],
    trace: null,
  };
  return { solution: { id, questionId: 'q', path, images: [], grader }, result };
}

const runs: EvalRun[] = [
  // Agrees exactly; one correct red line.
  run('s1', 'photo', { points: { P1: false, P2: true }, score: 1, correctLines: 2 }, { points: { P1: 'not_earned', P2: 'earned_follow_through' }, lines: ['wrong', 'ok', 'ok'] }),
  // Engine red on a line the grader calls correct, and a point credited that the grader withheld.
  run('s2', 'photo', { points: { P1: true, P2: false }, score: 1, correctLines: 3 }, { points: { P1: 'not_earned', P2: 'earned' }, lines: ['wrong', 'ok', 'ok'] }),
  // Two points left unchecked: engine 0 against grader 2 is outside one point.
  run('s3', 'photo', { points: { P1: true, P2: true }, score: 2, correctLines: 3 }, { points: { P1: 'unchecked', P2: 'unchecked' }, lines: ['unchecked', 'unchecked', 'unchecked'] }),
  // The engine could not mark this one at all.
  run('s4', 'photo', { points: { P1: true, P2: true }, score: 2, correctLines: 2 }, null),
  run('c1', 'canvas', { points: { P1: true }, score: 1, correctLines: 1 }, { points: { P1: 'earned' }, lines: ['ok'] }),
];

test('red lines are listed for the second pass', () => {
  assert.deepEqual(redLines(runs), [{ solutionId: 's1', line: 1 }, { solutionId: 's2', line: 1 }]);
});

test('false-red rate is pending until every red line is adjudicated', () => {
  const m = metricsFor('photo', runs, { s1: { '1': true } });
  assert.equal(m.falseRedRate, null);
  assert.equal(m.pendingRedLines, 1);
  assert.equal(m.passes, null);
});

test('photo metrics: false red over correct lines, agreement within one point, false credit, coverage', () => {
  const m = metricsFor('photo', runs, { s1: { '1': true }, s2: { '1': false } });
  assert.equal(m.solutions, 4);
  assert.equal(m.falseRedRate, 1 / 10);
  assert.equal(m.scoreAgreement, 2 / 4);
  assert.equal(m.falseCreditRate, 1 / 2);
  assert.equal(m.coverage, 1 - 4 / 8);
  assert.equal(m.passes, false);
});

test('paths are measured separately; a clean path passes', () => {
  const m = metricsFor('canvas', runs, {});
  assert.deepEqual([m.solutions, m.falseRedRate, m.scoreAgreement, m.falseCreditRate, m.coverage, m.passes], [1, 0, 1, 0, 1, true]);
});

test('the bar sits exactly at the thresholds', () => {
  assert.equal(FALSE_RED_MAX, 0.02);
  assert.equal(AGREEMENT_MIN, 0.85);
  const many: EvalRun[] = Array.from({ length: 20 }, (_, k) =>
    run(`a${k}`, 'canvas', { points: { P1: true }, score: 1, correctLines: 5 }, { points: { P1: k < 17 ? 'earned' : 'not_earned' }, lines: k < 2 ? ['wrong'] : ['ok'] }),
  );
  // 17 of 20 agree exactly; the other three are 0 against 1, still within one point.
  assert.equal(metricsFor('canvas', many, { a0: { '1': false }, a1: { '1': false } }).falseRedRate, 2 / 100);
  assert.equal(metricsFor('canvas', many, { a0: { '1': false }, a1: { '1': false } }).passes, true);
  const worse = [...many, run('a20', 'canvas', { points: { P1: true }, score: 1, correctLines: 0 }, { points: { P1: 'earned' }, lines: ['wrong'] })];
  assert.equal(metricsFor('canvas', worse, { a0: { '1': false }, a1: { '1': false }, a20: { '1': false } }).passes, false);
});

test('an empty path does not pass', () => {
  const m = metricsFor('photo', [], {});
  assert.deepEqual([m.solutions, m.passes, m.coverage], [0, false, 0]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/engine-eval.test.ts`
Expected: FAIL, cannot find module `@/lib/engine/eval`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/eval.ts`:

```ts
import type { MarkResult } from './types';

// The launch bar from the spec. A hand-in path may go live when both hold on its own evaluation set.
export const FALSE_RED_MAX = 0.02;
export const AGREEMENT_MIN = 0.85;

export type HandInPath = 'canvas' | 'photo';

/** What the human grader recorded for one solution, without seeing the engine's output. */
export interface GraderMark {
  /** Rubric point id -> awarded. */
  points: Record<string, boolean>;
  score: number;
  /** How many of the student's lines the grader judged correct. */
  correctLines: number;
}
export interface EvalSolution {
  id: string;
  questionId: string;
  path: HandInPath;
  /** Image paths relative to the manifest. */
  images: string[];
  grader: GraderMark;
}
/** `result` is null when the engine asked for a retake or failed: it scored nothing and settled nothing. */
export interface EvalRun {
  solution: EvalSolution;
  result: MarkResult | null;
}
/** Second pass: for each line the engine marked wrong, did the grader agree it is wrong? solution id -> line n -> really wrong. */
export type Adjudication = Record<string, Record<string, boolean>>;

export interface PathMetrics {
  path: HandInPath;
  solutions: number;
  /** null until every red line has been adjudicated. */
  falseRedRate: number | null;
  pendingRedLines: number;
  scoreAgreement: number;
  falseCreditRate: number;
  coverage: number;
  /** null while the false-red rate is pending. */
  passes: boolean | null;
}

export function redLines(runs: EvalRun[]): { solutionId: string; line: number }[] {
  return runs.flatMap((r) => (r.result?.lines ?? []).filter((l) => l.status === 'wrong').map((l) => ({ solutionId: r.solution.id, line: l.n })));
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function metricsFor(path: HandInPath, all: EvalRun[], adjudication: Adjudication): PathMetrics {
  const runs = all.filter((r) => r.solution.path === path);
  const reds = redLines(runs);
  const verdicts = reds.map((r) => adjudication[r.solutionId]?.[String(r.line)]);
  const pending = verdicts.filter((v) => v === undefined).length;
  const falseReds = verdicts.filter((v) => v === false).length;
  const correctLines = runs.reduce((a, r) => a + r.solution.grader.correctLines, 0);

  // An unchecked point is not in `earned`, so it already counts as not earned here.
  const agree = runs.filter((r) => Math.abs((r.result?.earned ?? 0) - r.solution.grader.score) <= 1).length;

  let credited = 0;
  let falseCredit = 0;
  let points = 0;
  let unchecked = 0;
  for (const r of runs) {
    const graded = Object.keys(r.solution.grader.points).length;
    points += graded;
    if (!r.result) {
      unchecked += graded;
      continue;
    }
    for (const p of r.result.points) {
      if (p.status === 'unchecked') unchecked += 1;
      if (p.status === 'earned' || p.status === 'earned_follow_through') {
        credited += 1;
        if (r.solution.grader.points[p.id] === false) falseCredit += 1;
      }
    }
  }

  const falseRedRate = pending > 0 ? null : ratio(falseReds, correctLines);
  const scoreAgreement = ratio(agree, runs.length);
  return {
    path,
    solutions: runs.length,
    falseRedRate,
    pendingRedLines: pending,
    scoreAgreement,
    falseCreditRate: ratio(falseCredit, credited),
    coverage: points === 0 ? 0 : 1 - unchecked / points,
    passes: runs.length === 0 ? false : falseRedRate === null ? null : falseRedRate <= FALSE_RED_MAX && scoreAgreement >= AGREEMENT_MIN,
  };
}
```

Create `scripts/eval-engine.ts`:

```ts
// Runs the marking engine over an evaluation set and prints the launch numbers.
//
//   node --import tsx scripts/eval-engine.ts --typed
//       Typed transcripts with known scores (fixtures/engine/typed.json plus every
//       seed model solution) through markProblem: real matcher, judge and checker,
//       no handwriting. Exits 1 on any mismatch.
//
//   node --import tsx scripts/eval-engine.ts --manifest eval/manifest.json [--adjudication eval/adjudication.json] [--fresh]
//       Handwritten solutions through readProblem and markProblem. Results are cached
//       in <manifest dir>/out/results.json so an interrupted run resumes; --fresh
//       starts again. Writes out/red-lines.json for the grader's second pass.
//
// Needs CHECKER_URL, CHECKER_SECRET and the key for MARK_PROVIDER.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import typed from '@/fixtures/engine/typed.json';
import { metricsFor, redLines, type Adjudication, type EvalRun, type EvalSolution, type HandInPath } from '@/lib/engine/eval';
import { markProblem } from '@/lib/engine/mark';
import { EngineError, type EngineImage } from '@/lib/engine/model';
import { AP_DEFAULT } from '@/lib/engine/profiles';
import { CALC1_QUESTIONS, getCalc1Question, type ModelLine } from '@/content/calc1/questions';
import { readProblem } from '@/lib/engine/reader';
import type { MarkResult, Transcript } from '@/lib/engine/types';

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string) => {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 ? process.argv[k + 1] : undefined;
};
const pct = (v: number | null) => (v === null ? 'pending' : `${(v * 100).toFixed(1)}%`);
const box = { x0: 0, y0: 0, x1: 1, y1: 1 };

async function readJson<T>(file: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if (fallback !== undefined && (err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function runTyped(): Promise<number> {
  type Case = { id: string; questionId: string; lines: ModelLine[]; expect: Record<string, string> };
  const cases: Case[] = [
    ...CALC1_QUESTIONS.map((q) => ({ id: `${q.id}-model`, questionId: q.id, lines: q.model, expect: Object.fromEntries(q.points.map((p) => [p.id, 'earned'])) })),
    ...(typed as unknown as Case[]),
  ];
  let bad = 0;
  for (const c of cases) {
    const q = getCalc1Question(c.questionId);
    if (!q) throw new Error(`${c.id}: unknown question ${c.questionId}`);
    const transcript: Transcript = { lines: c.lines.map((l, k) => ({ n: k + 1, image: 0, latex: l.latex, box, confidence: 'high' as const, confirmed: true })) };
    let got: Record<string, string>;
    try {
      got = Object.fromEntries((await markProblem(q, AP_DEFAULT, transcript)).points.map((p) => [p.id, p.status]));
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      got = { error: err.stage };
    }
    const same = JSON.stringify(got) === JSON.stringify(c.expect);
    if (!same) bad += 1;
    console.log(`${same ? 'ok  ' : 'DIFF'} ${c.id}${same ? '' : `\n     expected ${JSON.stringify(c.expect)}\n     got      ${JSON.stringify(got)}`}`);
  }
  console.log(`\n${cases.length - bad} of ${cases.length} typed cases match.`);
  return bad === 0 ? 0 : 1;
}

async function runManifest(file: string): Promise<number> {
  const dir = path.dirname(file);
  const outDir = path.join(dir, 'out');
  await mkdir(outDir, { recursive: true });
  const resultsFile = path.join(outDir, 'results.json');
  const manifest = await readJson<{ solutions: EvalSolution[] }>(file);
  const cache = flag('fresh') ? {} : await readJson<Record<string, MarkResult | null>>(resultsFile, {});

  for (const s of manifest.solutions) {
    if (s.id in cache) continue;
    const q = getCalc1Question(s.questionId);
    if (!q) throw new Error(`${s.id}: unknown question ${s.questionId}`);
    const images: EngineImage[] = await Promise.all(
      s.images.map(async (p) => ({
        mediaType: p.toLowerCase().endsWith('.png') ? ('image/png' as const) : ('image/jpeg' as const),
        base64: (await readFile(path.join(dir, p))).toString('base64'),
      })),
    );
    let result: MarkResult | null = null;
    try {
      // No student is present to confirm the transcript, so this is the worst case:
      // low-confidence lines stay unconfirmed and can never be marked wrong.
      const read = await readProblem(images, q);
      if (read.kind === 'transcript') result = await markProblem(q, AP_DEFAULT, read.transcript);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
    }
    cache[s.id] = result;
    await writeFile(resultsFile, JSON.stringify(cache, null, 1));
    console.log(`${s.id}: ${result ? `${result.earned}/${result.total} (grader ${s.grader.score})` : 'not marked'}`);
  }

  const runs: EvalRun[] = manifest.solutions.map((s) => ({ solution: s, result: cache[s.id] ?? null }));
  await writeFile(path.join(outDir, 'red-lines.json'), JSON.stringify(redLines(runs), null, 1));
  const adjudicationFile = option('adjudication');
  const adjudication = adjudicationFile ? await readJson<Adjudication>(adjudicationFile) : {};

  console.table(
    (['canvas', 'photo'] as HandInPath[]).map((p) => {
      const m = metricsFor(p, runs, adjudication);
      return {
        path: p,
        solutions: m.solutions,
        'false red (max 2%)': pct(m.falseRedRate),
        'red lines to adjudicate': m.pendingRedLines,
        'within 1 point (min 85%)': pct(m.scoreAgreement),
        'false credit': pct(m.falseCreditRate),
        coverage: pct(m.coverage),
        passes: m.passes === null ? 'pending' : m.passes ? 'YES' : 'no',
      };
    }),
  );
  return 0;
}

// No top-level await: this repo's scripts are compiled as CommonJS by tsx.
async function main(): Promise<number> {
  const manifest = option('manifest');
  if (flag('typed')) return runTyped();
  if (manifest) return runManifest(manifest);
  console.error('Usage: eval-engine.ts --typed | --manifest <file> [--adjudication <file>] [--fresh]');
  return 2;
}
main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
```

Create `eval/README.md`:

````markdown
# Launch evaluation set

This folder holds the handwritten solutions and the human grades used to decide
whether a hand-in path (canvas or photo) may go live. Everything here except this
file is ignored by git: it is other people's handwriting and paid work.

The bar, per path: the engine marks correct lines wrong at most 2% of the time,
and at least 85% of its scores are within one point of the grader's.

## Layout

```
eval/
  manifest.json
  adjudication.json        (second pass, see below)
  canvas/s001.png
  photo/s151.jpg
  out/                     (written by the script)
```

`manifest.json`:

```json
{
  "solutions": [
    {
      "id": "s151",
      "questionId": "der-chain",
      "path": "photo",
      "images": ["photo/s151.jpg"],
      "grader": { "points": { "P1": false }, "score": 0, "correctLines": 1 }
    }
  ]
}
```

- `questionId` is an id from `content/calc1/questions.json`.
- `path` is `canvas` or `photo`. Aim for about 150 of each.
- `images` are PNG or JPEG, one to four per solution, each under 4 MB.

## For the solution writers

Write each solution by hand as a student would in an exam: on paper, photographed
with a phone, for `photo`; on the site's canvas, saved as PNG, for `canvas`. For
each question produce a mix: fully correct work, work with one of the common
errors listed for that topic in the research report, and correct work by a
different method. Do not write neatly on purpose.

## For the grader: first pass, blind

Mark every solution against the rubric in `content/calc1/questions.json` without
seeing any engine output. Follow-through applies: after an error, later points
are earned if they are consistent with the student's own value, unless the error
made the problem much easier. Record for each solution:

- `points`: each rubric point id, `true` if awarded.
- `score`: the total awarded. Do not deduct for a missing +C; that penalty is
  applied once per exam, not per problem.
- `correctLines`: how many of the student's written lines are correct.

## For the grader: second pass

Run `npm run eval:engine`. It writes `out/red-lines.json`, the lines the engine
marked wrong. For each one, look at the handwritten line and record whether it
really is wrong:

`adjudication.json`:

```json
{ "s151": { "1": true }, "s152": { "3": false } }
```

`true` means the line is wrong, so the red mark is fair. `false` means the line
is fine, so the engine made a false red. A line the engine misread counts as
`false`: the student's line was fine.

Then run:

```
npm run eval:engine -- --adjudication eval/adjudication.json
```

The table shows, per path, the false-red rate, the share of scores within one
point, the false-credit rate, coverage, and whether the path passes.

## Typed set

`npm run eval:typed` runs typed transcripts with known scores through the real
matcher, judge and checker. It needs no handwriting and costs a few cents.
````

- [ ] **Step 4: Run the test and the script's two cheap paths**

Run: `node --import tsx --test tests/engine-eval.test.ts`
Expected: 6 pass, 0 fail.

Run: `node --import tsx scripts/eval-engine.ts; echo "exit $?"`
Expected: the usage line, then `exit 2`.

Run: `mkdir -p /tmp/rp-eval && echo '{"solutions":[]}' > /tmp/rp-eval/manifest.json && node --import tsx scripts/eval-engine.ts --manifest /tmp/rp-eval/manifest.json`
Expected: a two-row table (canvas, photo) with 0 solutions and `passes` "no"; `/tmp/rp-eval/out/red-lines.json` exists.

- [ ] **Step 5: Run everything**

Run: `npm test && npx tsc --noEmit && npm run checker:test`
Expected: 0 fail; `tsc` prints nothing; 83 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/eval.ts scripts/eval-engine.ts eval/README.md tests/engine-eval.test.ts
git commit -m "Add launch metrics and the evaluation script"
```

---

### Task 16: First live run with real models

**Files:** none created. This task spends a small amount on the model API (45 problems, text only, no images).

**Interfaces:**
- Consumes: `npm run eval:typed`; the running checker; `OPENAI_API_KEY` in `.env.local`.
- Produces: a recorded result in the task report: how many of the 45 typed cases match with the real matcher and judge.

- [ ] **Step 1: Run the typed set**

With `npm run checker:dev` running:

Run: `MARK_PROVIDER=openai CHECKER_URL=http://127.0.0.1:8000 CHECKER_SECRET=dev npm run eval:typed`
Expected: one `ok` or `DIFF` line per case, then "N of 45 typed cases match."

- [ ] **Step 2: Read the result honestly**

Task 10 already proved these 45 cases score correctly with a perfect alignment, so every `DIFF` here is the matcher or the judge. For each `DIFF`, note the case id and whether a CAS point or a judged point differs. Do not edit expectations to make a case pass.

- [ ] **Step 3: Report and stop**

Report the count and the list of differing cases to Mehroz. If 42 or more match, the engine is ready for the handwritten evaluation. If fewer, the next piece of work is the matcher or judge prompt, which is a new task to agree, not a change to slip in here.

---

### Task 17: Deploy the checker to Railway (needs Mehroz's go-ahead)

**Files:** none.

This creates a service in the Expop1 project in Mario Stewart's Railway workspace. Do not start it without Mehroz saying so in the session. The CLI is `npx -y @railway/cli`; its flags are not verified in this plan, so read `--help` for each command before running it, or use the dashboard.

- [ ] **Step 1: Confirm with Mehroz, then push the branch**

```bash
git push -u origin feat/calc1-engine
```

Pushing this branch deploys nothing: the `web` service builds only `feat/presale-site`.

- [ ] **Step 2: Create the service with these settings**

| Setting | Value |
|---|---|
| Project / environment | Expop1 / production |
| Service name | `checker` |
| Source | GitHub `MuhammadMehroz786/redpen-maths`, branch `feat/calc1-engine` |
| Root directory | `services/checker` |
| Builder | Dockerfile |
| Variables on `checker` | `PORT=8000`, `CHECKER_SECRET=<output of: openssl rand -hex 32>` |
| Public networking | none; do not generate a domain |

Do not set `CHECKER_URL` or `CHECKER_SECRET` on the `web` service yet. A variable change redeploys the live site, and nothing in `web` calls the engine until piece 3.

- [ ] **Step 3: Verify from inside the service**

Open a shell in the `checker` service and run:

```bash
python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read())"
```

Expected: `b'{"ok":true}'`. The deploy log should show uvicorn listening on `[::]:8000` with two workers.

- [ ] **Step 4: Record what was created**

Report the service id and the private hostname (`checker.railway.internal`) to Mehroz. Piece 3 will set `CHECKER_URL=http://checker.railway.internal:8000` and the same `CHECKER_SECRET` on `web`.

---

## What this plan does not do

- **The 300 handwritten solutions.** Hiring the writers and the grader is Mehroz's to arrange; `eval/README.md` is their brief. When the data exists, `npm run eval:engine` produces the launch numbers.
- **Routes, storage, the read-back screen and page splitting.** Piece 3.
- **A separate reader set.** The spec asked for handwritten images with known transcripts to measure reading on its own. No such images exist yet, so the spec now defers it: a misread shows up in the launch evaluation as a false red or an unchecked line. If the launch numbers miss the bar and reading is the suspect, build the reader set then.
- **Latency.** The 30-second target is not measured by the script.
- **Tuning.** The follow-through "materially easier" threshold and the matcher and judge prompts are first versions. The evaluation set is what tunes them.
