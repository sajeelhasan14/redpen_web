'use client';

import { useEffect, useRef, useState } from 'react';
import { drawInk, renderInk, type Measure } from '@/lib/ink';
import { PEN } from '@/lib/page';
import { HERO_SPEECH, HERO_STUDENT, buildHeroMarks } from '@/content/hero-script';
import { useSessionReady } from './HumanGate';

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
  const [reduced, setReduced] = useState(false);
  const [muted, setMuted] = useState(true); // browsers block sound on autoplay; the visitor opts in
  // Held until the human gate passes, so the loop never runs (or plays) under the overlay.
  const ready = useSessionReady();

  useEffect(() => {
    if (!ready) return;
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
      setReduced(true);
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
  }, [ready]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    a.muted = !muted;
    if (muted) {
      a.currentTime = 0;
      void a.play().catch(() => {});
    } else a.pause();
    setMuted(!muted);
  };

  return (
    <figure className="hero-demo">
      <div className="sheet" role="img" aria-label="A student's working for the integral of 6x sin(x²) dx from 0 to √π, marked in red: 6 du is crossed out to 3 du, and the value that follows from it is ringed.">
        <canvas ref={studentRef} />
        <canvas ref={penRef} className="overlay" />
      </div>
      <audio ref={audio} src="/audio/hero.mp3" preload="none" muted />
      <figcaption>
        <span>{note ?? `“${HERO_SPEECH}”`}</span>
        {!reduced && <button type="button" onClick={toggle} aria-pressed={!muted}>{muted ? 'Hear it' : 'Mute'}</button>}
      </figcaption>
    </figure>
  );
}
