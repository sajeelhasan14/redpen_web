// Runs every fixture through the live tutor route and scores two things:
//   verdict   - did it respond the way the case demands (mark / stay quiet / stay silent)
//   placement - for error cases, did the mark land on the wrong symbol
// Each case can run several times so flakiness shows up as a rate, not a coin toss.
//
//   node fixtures/run-demo.js            one pass
//   node fixtures/run-demo.js --runs 3   three passes per case, reported as n/N
//   node fixtures/run-demo.js --only hand   only the cases whose file matches the pattern
//
// Needs `npm run dev` on :3000 and fixtures/demo-targets.json from `npm run fixtures`.
const fs = require('fs');
const path = require('path');

const ARGS = process.argv.slice(2);
const RUNS = Number(ARGS[ARGS.indexOf('--runs') + 1]) || 1;
const URL = process.env.TUTOR_URL || 'http://localhost:3000/api/mark';
const CONCURRENCY = 3;
const ONLY = ARGS.includes('--only') ? new RegExp(ARGS[ARGS.indexOf('--only') + 1]) : null;

const CASES = [
  // The hero challenge's trap (6x dx written as 6 du) and its other slips.
  { file: 'ch-factor.png', expect: 'incorrect' },
  { file: 'ch-limits.png', expect: 'incorrect' },
  { file: 'ch-bare-wrong.png', expect: 'incorrect' },
  { file: 'imp-chain.png', expect: 'incorrect' },
  { file: 'lim-zero.png', expect: 'incorrect' },
  { file: 'ch-correct.png', expect: 'quiet' },
  { file: 'imp-correct.png', expect: 'quiet' },
  { file: 'lim-correct.png', expect: 'quiet' },
  { file: 'blank.png', expect: 'quiet' },
  { file: 'scribble.png', expect: 'silent' },
  // "Check my work" pressed on a page with nothing to mark: still silent.
  { file: 'blank.png', name: 'blank+force', force: true, expect: 'silent' },
  { file: 'scribble.png', name: 'scribble+force', force: true, expect: 'silent' },
  // A valid route the mark scheme does not list first is correct work: no red ink.
  { file: 'alt-lhopital.png', expect: 'quiet' },
  { file: 'alt-backsub.png', expect: 'quiet' },
  // Hand-drawn (angular polylines), as a visitor writes with a mouse.
  { file: 'hand-wrongline.png', expect: 'incorrect' },
  { file: 'hand-factor.png', expect: 'incorrect' },
  { file: 'hand-bare-wrong.png', expect: 'incorrect' },
  { file: 'hand-correct-step.png', expect: 'quiet' },
  { file: 'hand-unfinished.png', expect: 'nudge' },
  { file: 'hand-offquestion.png', expect: 'incorrect' },
  { file: 'hand-offquestion-true.png', expect: 'remark' },
];

const meta = fs.existsSync('fixtures/demo-targets.json') ? JSON.parse(fs.readFileSync('fixtures/demo-targets.json', 'utf8')) : { targets: {}, question: {} };
const targets = meta.targets;

function verdict(r, c) {
  const anns = r.annotations || [];
  const silent = !r.speech && !anns.length;
  const praise = /good|great|nice|well done|correct|caught|fixed/i.test(r.speech || '');
  switch (c.expect) {
    case 'incorrect':
      return !r.correct && anns.length > 0;
    case 'quiet':
      return anns.length === 0 && (silent || r.correct);
    case 'silent':
      return silent;
    case 'nudge':
      // No red ink and no praise; the visitor still sees a message (the model's speech,
      // or TryIt's "finish the line" nudge when the reply is worthResponding:false).
      return !r.correct && anns.length === 0;
    case 'remark':
      // A true line that is not a step of the question: a spoken reply, no red ink, not "correct".
      return !r.correct && anns.length === 0 && Boolean(r.speech);
    case 'no-remark':
      return !r.correct && anns.length === 0 && !praise;
  }
  return false;
}

/** Whether any mark lands on the wrong symbol. */
function placed(r, box) {
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const pad = 18;
  const inside = (x, y, px = pad, py = pad) => x >= x0 - px && x <= x1 + px && y >= y0 - py && y <= y1 + py;
  for (const a of r.annotations || []) {
    if (a.kind === 'strike' && inside((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2)) return true;
    if (a.kind === 'circle' && inside(a.x, a.y, pad + 10, pad + 10)) return true;
    // A written correction sits just above the wrong value.
    if (a.kind === 'write' && a.x >= x0 - 40 && a.x <= x1 + 40 && a.y >= y0 - 90 && a.y <= y1 + 10) return true;
  }
  return false;
}

async function callTutor(c) {
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join('fixtures', c.file)).toString('base64');
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, space: { width: 900, height: 620 }, questionId: meta.question[c.file.replace(/\.png$/, '')], prior: c.prior ?? [], transcript: [], ...(c.force ? { force: true } : {}) }),
  });
  const r = await res.json();
  const [tin, tout] = (res.headers.get('x-tutor-tokens') || '').split('/').map(Number);
  return { r, ms: Date.now() - t0, model: res.headers.get('x-tutor-model'), tin: tin || 0, tout: tout || 0 };
}

async function pool(tasks, n) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < tasks.length) {
        const k = i++;
        out[k] = await tasks[k]();
      }
    }),
  );
  return out;
}

(async () => {
  const jobs = [];
  for (const c of CASES) {
    if (ONLY && !ONLY.test(c.file)) continue;
    if (!fs.existsSync(path.join('fixtures', c.file))) {
      console.log(`SKIP ${c.file} (missing; run npm run fixtures)`);
      continue;
    }
    for (let k = 0; k < RUNS; k++) jobs.push(() => callTutor(c).then((x) => ({ c, ...x })));
  }
  const results = await pool(jobs, CONCURRENCY);

  const rows = [];
  let model = null;
  for (const c of CASES) {
    const mine = results.filter((x) => x && x.c === c);
    if (!mine.length) continue;
    model ??= mine[0].model;
    const errors = mine.filter((x) => x.r.error);
    const ok = mine.filter((x) => !x.r.error && verdict(x.r, c));
    const box = targets[c.file.replace(/\.png$/, '')];
    const pl = box ? mine.filter((x) => !x.r.error && placed(x.r, box)) : null;
    const ms = Math.round(mine.reduce((s, x) => s + x.ms, 0) / mine.length);
    const maxMs = Math.max(...mine.map((x) => x.ms));
    const label = c.name ?? c.file;
    rows.push({ file: label, expect: c.expect, verdict: `${ok.length}/${mine.length}`, placed: pl ? `${pl.length}/${mine.length}` : '-', ms, maxMs, errors: errors.length });
    const pass = ok.length === mine.length && errors.length === 0;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${label.padEnd(22)} ${c.expect.padEnd(10)} verdict ${ok.length}/${mine.length}${pl ? `  placed ${pl.length}/${mine.length}` : ''}  ~${ms}ms`);
    for (const x of mine) {
      if (x.r.error) console.log(`      ERROR ${x.r.error}`);
      else if (!verdict(x.r, c) || (pl && !placed(x.r, box)))
        console.log(`      ${verdict(x.r, c) ? 'misplaced' : 'wrong'}: correct=${x.r.correct} worth=${x.r.worthResponding} speech="${x.r.speech}" ann=${JSON.stringify(x.r.annotations)}`);
    }
  }

  const total = rows.length;
  const passed = rows.filter((r) => r.verdict.split('/')[0] === r.verdict.split('/')[1] && r.errors === 0).length;
  const placedRows = rows.filter((r) => r.placed !== '-');
  const placedN = placedRows.reduce((s, r) => s + Number(r.placed.split('/')[0]), 0);
  const placedD = placedRows.reduce((s, r) => s + Number(r.placed.split('/')[1]), 0);
  const placedOk = placedN >= 0.8 * placedD;
  console.log(`\nverdict ${rows.reduce((n, r) => n + Number(r.verdict.split('/')[0]), 0)}/${rows.reduce((n, r) => n + Number(r.verdict.split('/')[1]), 0)}, placement ${placedN}/${placedD}  (${passed}/${total} cases clean, model ${model ?? '?'}, ${RUNS} run(s))`);
  const done = results.filter((x) => x && !x.r.error);
  const mean = (f) => (done.length ? Math.round(done.reduce((s, x) => s + f(x), 0) / done.length) : 0);
  const usage = { meanMs: mean((x) => x.ms), worstMs: Math.max(0, ...done.map((x) => x.ms)), meanIn: mean((x) => x.tin), meanOut: mean((x) => x.tout), calls: results.length };
  console.log(`latency mean ${usage.meanMs}ms worst ${usage.worstMs}ms, tokens mean ${usage.meanIn} in / ${usage.meanOut} out, ${usage.calls} calls`);
  fs.writeFileSync('fixtures/last-run.json', JSON.stringify({ when: new Date().toISOString(), model, runs: RUNS, usage, rows }, null, 2));
  process.exit(passed === total && placedOk ? 0 : 1);
})();
