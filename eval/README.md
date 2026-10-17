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
