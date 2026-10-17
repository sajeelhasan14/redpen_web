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
import { attempt, metricsFor, redLines, type Adjudication, type EvalRun, type EvalSolution, type HandInPath } from '@/lib/engine/eval';
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
    // No student is present to confirm the transcript, so this is the worst case:
    // low-confidence lines stay unconfirmed and can never be marked wrong.
    const { result, final } = await attempt(async () => {
      const read = await readProblem(images, q);
      return read.kind === 'transcript' ? markProblem(q, AP_DEFAULT, read.transcript) : null;
    });
    if (!final) {
      // An outage is not the engine's mark: leave it out of the cache so the next run retries it.
      console.log(`${s.id}: engine unavailable, will retry on the next run`);
      continue;
    }
    cache[s.id] = result;
    await writeFile(resultsFile, JSON.stringify(cache, null, 1));
    console.log(`${s.id}: ${result ? `${result.earned}/${result.total} (grader ${s.grader.score})` : 'retake requested'}`);
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
