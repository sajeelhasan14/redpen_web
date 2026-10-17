'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, LessonStep, TranscriptLine, TutorReply } from '@/lib/types';
import { drawInk, type Measure } from '@/lib/ink';
import { computeLayout, resolveMarks, writtenLines } from '@/lib/layout';
import { Page, PEN, PEN_WIDTH, type StudentStroke } from '@/lib/page';
import { drawHint, drawQuestionBand } from '@/lib/board';
import { prefetchSpeech, setMuted, speak, speakAsync, stopSpeaking, warmVoices } from '@/lib/speech';
import { DEMO_QUESTIONS, type DemoQuestion } from '@/content/demo-questions';
import HeroDemo from './HeroDemo';
import QuestionMath from './QuestionMath';
import SolutionHook from './SolutionHook';
import { useSessionReady } from './HumanGate';

const W = 900;
const H = 620;
const IDLE_MS = 2500;
// Longer than the server's own model timeouts (check 20 s, lesson 45 s), so a slow model fails there first.
const CHECK_TIMEOUT_MS = 25_000;
const LESSON_TIMEOUT_MS = 50_000;
// Shown when a check finds no finished line (blank, scribble, or a line that stops mid-way).
const nudge = (q: DemoQuestion) =>
  `I couldn't see a finished line yet. Write a full step${q.id === 'q-challenge' ? ', like u = x², du = 2x dx,' : ''} then pause or press Check.`;
type Status = 'ready' | 'watching' | 'thinking' | 'marking' | 'correct' | 'error';
type Shown = { sig: string; message: string; status: Status };

function setupCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export default function TryIt() {
  const ready = useSessionReady();
  const pageRef = useRef<Page>(new Page(W, H));
  const page = pageRef.current;
  const inkRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<StudentStroke | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSig = useRef('');
  const busy = useRef(false);
  const cancelInk = useRef<((finish?: boolean) => void) | null>(null);
  // Marks being drawn, and (for a check) how many items the page had when it was sent.
  const pending = useRef<{ marks: Annotation[]; at?: number } | null>(null);
  const drawDone = useRef<(() => void) | null>(null);
  const transcript = useRef<TranscriptLine[]>([]);
  const readyRef = useRef(false);
  const callRef = useRef<(question?: string, force?: boolean) => Promise<void>>(async () => {});
  const gen = useRef(0); // bumped on Clear / tab switch so a reply or lesson still in flight is dropped
  const lastCheck = useRef<Shown | null>(null); // the last check's reply, keyed by the page it ended on

  const [q, setQ] = useState<DemoQuestion>(DEMO_QUESTIONS[0]);
  const qRef = useRef(q); // read by repaint, which reset() calls before the state update lands

  const [status, setStatus] = useState<Status>('ready');
  const [message, setMessage] = useState('Write your working on the page, then pause.');
  const [canTeach, setCanTeach] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  // The "I'm stuck" moment: a check marked a mistake, or the page stayed blank. It lights up the solution hook.
  const [stuck, setStuck] = useState(false);

  const measure: Measure = useCallback((t, f) => {
    const ctx = overlayRef.current!.getContext('2d')!;
    ctx.font = f;
    return ctx.measureText(t).width;
  }, []);

  // The view adds the printed question (and, on an empty page, a faint hint)
  // beneath the ink. capture() renders the page without them, so the tutor
  // sees exactly what it saw before; it is told about the band in text instead.
  const repaint = useCallback(() => {
    const c = inkRef.current!;
    const cssW = c.getBoundingClientRect().width;
    const minSize = cssW > 0 ? (11 * W) / cssW : 0; // page units for ~11 CSS px at this scale
    const blank = !live.current && !page.items.some((it) => it.kind !== 'tutor');
    page.render(c.getContext('2d')!, (ctx) => {
      drawQuestionBand(ctx, qRef.current.text, W, minSize);
      if (blank) drawHint(ctx, minSize);
    });
  }, [page]);

  const clearOverlay = useCallback(() => {
    const c = overlayRef.current!;
    const ctx = c.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
  }, []);

  // A check's marks belong to the page that was sent: they go in right after it,
  // under any strokes written while the call was in flight, and lastSig records
  // the sent page plus the marks, so those strokes still differ and get checked.
  const commit = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    cancelInk.current = null;
    let sigEnd = page.items.length;
    if (p?.marks.length) {
      const at = p.at;
      if (at !== undefined && at <= page.items.length && page.items.slice(at).every((it) => it.kind === 'stroke')) {
        page.items.splice(at, 0, { kind: 'tutor', annotations: p.marks });
        sigEnd = at + 1;
      } else {
        page.push({ kind: 'tutor', annotations: p.marks });
        sigEnd = page.items.length;
      }
    }
    repaint();
    clearOverlay();
    lastSig.current = page.signature(sigEnd);
    drawDone.current?.();
    drawDone.current = null;
  }, [page, repaint, clearOverlay]);

  // Cancel finishes the ink but never calls onDone, so commit here: it moves the
  // marks onto the page and resolves whatever lesson step is awaiting the animation.
  const finish = useCallback(() => {
    const c = cancelInk.current;
    if (!c) return;
    c(true);
    commit();
  }, [commit]);

  const animate = useCallback(
    (marks: Annotation[], at?: number) =>
      new Promise<void>((resolve) => {
        if (!marks.length) return resolve();
        finish();
        pending.current = { marks, at };
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
    async (question?: string, force = false) => {
      if (busy.current || !readyRef.current) return;
      busy.current = true;
      const g = gen.current;
      setStatus('thinking');
      setMessage(question ? 'Planning the explanation…' : 'Checking your working…');
      const sig = page.signature();
      const sentLen = page.items.length;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), question ? LESSON_TIMEOUT_MS : CHECK_TIMEOUT_MS);
      try {
        const res = await fetch('/api/mark', {
          signal: abort.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataUrl: capture(), space: { width: W, height: H }, questionId: q.id,
            ...(question ? { lesson: true } : force ? { force: true } : {}), prior: page.tutorMarks(), transcript: transcript.current, layout: computeLayout(page, measure),
          }),
        });
        if (g !== gen.current) return;
        if (res.status === 429) {
          const j = (await res.json().catch(() => ({}))) as { reason?: string };
          setFallback(j.reason === 'rate' ? "You've used today's free checks. Here's how it marks:" : "The live demo is busy. Here's how it marks:");
          return;
        }
        if (res.status === 403) {
          // The 24 h session cookie ran out; retrying cannot help until the gate runs again.
          setStatus('error');
          setMessage('Your session expired — refresh the page');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          setMessage('The tutor could not look that time. Press Check to try again.');
          return;
        }
        const reply = (await res.json()) as TutorReply;
        if (g !== gen.current) return;
        if (reply.steps?.length) {
          await playLesson(reply.steps, g);
          return;
        }
        const marks = resolveMarks(reply.annotations, writtenLines(page.tutorMarks()), computeLayout(page, measure), W, measure);
        if (!reply.worthResponding || (!reply.speech && !marks.length && !reply.correct)) {
          setStatus('watching');
          setMessage(nudge(q));
          lastCheck.current = { sig, message: nudge(q), status: 'watching' };
          return;
        }
        if (reply.speech) transcript.current = [...transcript.current, { who: 'tutor' as const, text: reply.speech }].slice(-8);
        const said = reply.speech || (reply.correct ? 'That working is right.' : '');
        setMessage(said);
        setCanTeach(!reply.correct && marks.length > 0);
        if (reply.speech) speak(reply.speech);
        if (marks.length) {
          if (!reply.correct) setStuck(true);
          setStatus('marking');
          // Insert after the sent page only if that page is still there as sent.
          await animate(marks, page.signature(sentLen) === sig ? sentLen : undefined);
          if (g !== gen.current) return;
          setStatus('watching');
          // Cache only when the page is exactly what was sent plus these marks: strokes
          // written (or undone) while the call was in flight have not been checked.
          const unmoved = page.items.length === sentLen + 1 && page.items[sentLen].kind === 'tutor' && page.signature(sentLen) === sig;
          lastCheck.current = unmoved ? { sig: page.signature(), message: said, status: 'watching' } : null;
        } else {
          setStatus(reply.correct ? 'correct' : 'watching');
          lastCheck.current = { sig, message: said, status: reply.correct ? 'correct' : 'watching' };
        }
      } catch {
        if (g !== gen.current) return;
        setStatus('error');
        setMessage(abort.signal.aborted ? 'The tutor took too long that time. Press Check to try again.' : 'Connection problem. Press Check to try again.');
      } finally {
        clearTimeout(timer);
        if (g === gen.current) {
          busy.current = false;
          if (page.signature() !== sig) schedule();
        }
      }
    },
    // playLesson and schedule are stable function declarations below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, q, capture, measure, animate],
  );
  readyRef.current = ready;
  callRef.current = call;

  async function playLesson(steps: LessonStep[], g: number) {
    setStatus('marking');
    setCanTeach(false);
    const layout = computeLayout(page, measure);
    for (const [i, st] of steps.entries()) {
      if (g !== gen.current) return;
      setMessage(st.say);
      const write = resolveMarks(st.write, writtenLines(page.tutorMarks()), layout, W, measure);
      if (steps[i + 1]?.say) prefetchSpeech(steps[i + 1].say);
      await Promise.all([speakAsync(st.say), animate(write)]);
      await new Promise((r) => setTimeout(r, 350));
    }
    if (g === gen.current) setStatus('watching');
  }

  function schedule() {
    if (idle.current) clearTimeout(idle.current);
    setStatus((s) => (s === 'thinking' || s === 'marking' ? s : 'watching'));
    idle.current = setTimeout(() => {
      const sig = page.signature();
      // Not ready yet, or a call still in flight: leave lastSig alone so this work is
      // checked once the session arrives or the call's finally re-schedules.
      if (!readyRef.current || busy.current || sig === lastSig.current || !page.studentWorkSinceLastMark()) return;
      lastSig.current = sig;
      void callRef.current();
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
    const first = !page.items.some((it) => it.kind !== 'tutor');
    live.current = { kind: 'stroke', pts: [p], width: PEN_WIDTH, color: PEN };
    if (first) repaint(); // the "start here" hint goes at the first stroke
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
    gen.current++;
    busy.current = false;
    finish();
    stopSpeaking();
    if (idle.current) clearTimeout(idle.current);
    page.clear();
    transcript.current = [];
    lastSig.current = '';
    lastCheck.current = null;
    if (next) qRef.current = next;
    repaint();
    setCanTeach(false);
    setStuck(false);
    setStatus('ready');
    setMessage('Write your working on the page, then pause.');
    if (next) setQ(next);
  };
  // "Check my work": check now instead of waiting for the pause. A blank page is
  // answered locally, and a page that has not changed since its last check gets
  // that reply again; neither spends a check.
  const checkNow = () => {
    if (busy.current || !readyRef.current) return;
    finish();
    const sig = page.signature();
    lastSig.current = sig;
    if (!page.items.some((it) => it.kind !== 'tutor')) {
      setStatus('watching');
      setMessage(nudge(q));
      return;
    }
    const last = lastCheck.current;
    if (last && last.sig === sig) {
      // Re-showing a cached reply leaves any pending auto-check alone.
      setStatus(last.status);
      setMessage(last.message);
      return;
    }
    if (idle.current) clearTimeout(idle.current);
    void call(undefined, true);
  };
  const undo = () => {
    finish();
    page.pop();
    repaint();
    lastSig.current = page.signature();
  };

  // Forty seconds with nothing written on this question: offer the worked solution.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (!page.items.some((it) => it.kind !== 'tutor')) setStuck(true);
    }, 40_000);
    return () => clearTimeout(t);
  }, [ready, q, page]);

  // Work written before the session arrived is checked as soon as it does.
  useEffect(() => {
    if (ready && page.studentWorkSinceLastMark() && page.signature() !== lastSig.current) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    setupCanvas(inkRef.current!);
    setupCanvas(overlayRef.current!);
    repaint();
    warmVoices();
    // The band's minimum text size follows the sheet's on-screen width.
    const ro = new ResizeObserver(() => {
      if (!live.current) repaint();
    });
    ro.observe(inkRef.current!);
    return () => {
      ro.disconnect();
      cancelInk.current?.(false);
      stopSpeaking();
    };
  }, [repaint]);

  if (fallback)
    return (
      <div className="tryit">
        <HeroDemo note={fallback} />
        <SolutionHook key={q.id} q={q} highlight />
      </div>
    );

  return (
    <div className="tryit">
      <div className="tabs" role="tablist" aria-label="Pick a question">
        {DEMO_QUESTIONS.map((d) => (
          <button key={d.id} role="tab" aria-selected={d.id === q.id} onClick={() => reset(d)}>{d.topic}</button>
        ))}
      </div>
      <p className="question"><QuestionMath q={q} /></p>
      <div className="demo-bar">
        <p className="demo-msg" role="status" aria-live="polite" data-status={status}>{ready ? message : 'Getting the tutor ready…'}</p>
        <div className="demo-actions">
          <button className="check" onClick={checkNow} disabled={!ready || status === 'thinking'} aria-label="Check my work">Check<span className="wide-only"> my work</span></button>
          {canTeach && <button className="primary" onClick={() => void call('Teach me this step: explain the step you marked, then let me try it again.')} aria-label="Teach me this step">Teach me<span className="wide-only"> this step</span></button>}
          <button onClick={undo}>Undo</button>
          <button onClick={() => reset()}>Clear</button>
          <button onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-pressed={muted}>{muted ? 'Voice off' : 'Voice on'}</button>
        </div>
      </div>
      <div className={`sheet${status === 'thinking' ? ' thinking' : ''}`}>
        <canvas ref={inkRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label={`Your page. The question at the top: ${q.text} Write your working below it.`} />
        <canvas ref={overlayRef} className="overlay" aria-hidden="true" />
      </div>
      <SolutionHook key={q.id} q={q} highlight={stuck} />
    </div>
  );
}
