'use client';

import { useEffect, useRef } from 'react';
import { drawInk, renderInk, type Measure } from '@/lib/ink';
import { PEN } from '@/lib/page';
import { HERO_STUDENT, buildHeroMarks } from '@/content/hero-script';

// The scripted hero marking: a wrong attempt at the challenge, marked in red.
// Same script and ink engine as HeroDemo, cropped to the part of the 900x620
// page that has writing on it, looping silently. onMarked reports when the red
// marks are on the page (true) and when the loop wipes them (false).

const CROP = { x: 50, y: 70, w: 760, h: 420 };
const SCALE = 0.5; // backing-store units per page unit, before devicePixelRatio

function setup(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const k = SCALE * dpr;
  c.width = Math.round(CROP.w * k);
  c.height = Math.round(CROP.h * k);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -CROP.x * k, -CROP.y * k);
  return ctx;
}

function wipe(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export default function MarkedScrap({ label, onMarked }: { label: string; onMarked?: (marked: boolean) => void }) {
  const studentRef = useRef<HTMLCanvasElement>(null);
  const penRef = useRef<HTMLCanvasElement>(null);
  // Held in a ref so a new callback from the parent never restarts the loop.
  const marked = useRef(onMarked);
  marked.current = onMarked;

  useEffect(() => {
    const student = setup(studentRef.current!);
    const pen = setup(penRef.current!);
    const measure: Measure = (t, f) => ((pen.font = f), pen.measureText(t).width);
    const marks = buildHeroMarks(measure);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      renderInk(student, HERO_STUDENT, PEN);
      renderInk(pen, marks);
      marked.current?.(true);
      return;
    }

    // The loop runs only while the scrap is on screen and the tab is visible; when it
    // goes out of sight the ink in progress is finished at once and the loop parks.
    let alive = true;
    let onScreen = true;
    let parked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancels: ((finish?: boolean) => void)[] = [];
    let penDown = false; // the red marks are being drawn
    const visible = () => onScreen && !document.hidden;
    const park = () => {
      if (parked) return;
      parked = true;
      clearTimeout(timer);
      cancels.forEach((c) => c(true));
      cancels = [];
      // Finishing the ink skips its onDone: if the pen was mid-mark, the marks are now complete.
      if (penDown) marked.current?.(true);
      penDown = false;
    };
    const loop = () => {
      if (!alive) return;
      if (!visible()) return park();
      wipe(student);
      wipe(pen);
      marked.current?.(false);
      cancels = [
        drawInk(student, HERO_STUDENT, () => {
          timer = setTimeout(() => {
            if (!alive) return;
            penDown = true;
            cancels.push(
              drawInk(pen, marks, () => {
                penDown = false;
                marked.current?.(true);
                timer = setTimeout(loop, 4500);
              }),
            );
          }, 700);
        }, PEN),
      ];
    };
    const update = () => {
      if (!alive) return;
      if (!visible()) park();
      else if (parked) {
        parked = false;
        loop();
      }
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      update();
    });
    io.observe(studentRef.current!);
    document.addEventListener('visibilitychange', update);
    // Let the desk settle before the pen starts.
    timer = setTimeout(loop, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
      cancels.forEach((c) => c(false));
    };
  }, []);

  return (
    <div className="hero-demo scrap-sheet" role="img" aria-label={label}>
      <canvas ref={studentRef} />
      <canvas ref={penRef} className="overlay" />
    </div>
  );
}
