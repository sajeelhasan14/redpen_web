'use client';

import { useEffect, useRef } from 'react';

// The header logo, with an elastic red mark. On load the line shoots out of its tail and the
// two dashes pop up. Dragging it works like a bowstring: the ends stay pinned, the grabbed
// point follows the pointer, and on release it fires forward and wobbles home. A plain click replays the pop.
// The mark is redrawn as vector (one 3-curve stroke + two dashes) so it can bend; the wordmark is the real PNG.

const REST: [number, number][] = [[22, 190], [55, 150], [85, 95], [112, 100], [140, 105], [118, 170], [134, 186], [150, 200], [172, 168], [300, 52]];
const DASHES = [{ a: [182, 40], b: [198, 70] }, { a: [251, 12], b: [241, 55] }] as const;
const LAST = REST.length - 1;

type Pt = { x: number; y: number; vx: number; vy: number };
type Dash = { s: number; vs: number; r: number; vr: number; dx: number; vdx: number; dy: number; vdy: number; at: number };

// Semi-implicit spring step: pull toward the target, keep some of the velocity.
function spring<T extends Record<string, number>>(o: T, key: keyof T, vkey: keyof T, target: number, k: number, damp: number) {
  (o[vkey] as number) = ((o[vkey] as number) + (target - (o[key] as number)) * k) * damp;
  (o[key] as number) += o[vkey] as number;
}

export default function AnimatedLogo({ label = 'RedPen Maths' }: { label?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const markRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dashRefs = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const svg = svgRef.current!, mark = markRef.current!, path = pathRef.current!;
    const pts: Pt[] = REST.map(([x, y]) => ({ x, y, vx: 0, vy: 0 }));
    const dash: Dash[] = DASHES.map(() => ({ s: 1, vs: 0, r: 0, vr: 0, dx: 0, vdx: 0, dy: 0, vdy: 0, at: 0 }));
    let frame = 0, raf = 0, grab: { i: number; ox: number; oy: number; dx: number; dy: number } | null = null;
    let dragged = false;

    const render = () => {
      const p = pts;
      path.setAttribute('d', `M${p[0].x},${p[0].y} C${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y} C${p[4].x},${p[4].y} ${p[5].x},${p[5].y} ${p[6].x},${p[6].y} C${p[7].x},${p[7].y} ${p[8].x},${p[8].y} ${p[9].x},${p[9].y}`);
      dash.forEach((d, i) => {
        const D = DASHES[i], cx = (D.a[0] + D.b[0]) / 2, cy = (D.a[1] + D.b[1]) / 2;
        dashRefs.current[i]?.setAttribute('transform', `translate(${cx + d.dx} ${cy + d.dy}) rotate(${d.r}) scale(${Math.max(0, d.s)}) translate(${-cx} ${-cy})`);
      });
    };

    // Runs only while something is moving; stops once every spring has settled.
    const tick = () => {
      frame++;
      let moving = !!grab;
      pts.forEach((p, i) => {
        if (grab) return;
        spring(p, 'x', 'vx', REST[i][0], 0.07, 0.86);
        spring(p, 'y', 'vy', REST[i][1], 0.07, 0.86);
        if (Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.x - REST[i][0]) + Math.abs(p.y - REST[i][1]) > 0.05) moving = true;
      });
      dash.forEach((d) => {
        if (frame < d.at) { moving = true; return; }
        spring(d, 's', 'vs', 1, 0.12, 0.78);
        spring(d, 'r', 'vr', 0, 0.1, 0.8);
        spring(d, 'dx', 'vdx', 0, 0.1, 0.8);
        spring(d, 'dy', 'vdy', 0, 0.1, 0.8);
        if (Math.abs(d.vs) + Math.abs(d.vr) + Math.abs(d.vdx) + Math.abs(d.vdy) + Math.abs(1 - d.s) + Math.abs(d.r) > 0.02) moving = true;
      });
      render();
      raf = moving ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

    // The intro: every point squeezed back toward the tail so the line shoots out of it, then the dashes pop.
    const intro = () => {
      const [tx, ty] = REST[0];
      pts.forEach((p, i) => {
        const [rx, ry] = REST[i];
        p.x = tx + (rx - tx) * 0.08; p.y = ty + (ry - ty) * 0.08;
        p.vx = (rx - tx) * 0.06; p.vy = (ry - ty) * 0.06;
      });
      dash.forEach((d, i) => { d.s = 0; d.vs = 0; d.dx = 0; d.dy = 18; d.r = i ? 25 : -25; d.at = frame + 26 + i * 8; });
      wake();
    };
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) intro();
    render();

    const toMark = (e: PointerEvent) => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(mark.getScreenCTM()!.inverse());
    };

    const onDown = (e: PointerEvent) => {
      // Stops the browser starting its own drag of the image, which would steal the pointer.
      e.preventDefault();
      const m = toMark(e);
      let best = 1, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.hypot(p.x - m.x, p.y - m.y); if (d < bd) { bd = d; best = i; } });
      // A bowstring: the ends never move, so a press on one grabs its nearest neighbour.
      grab = { i: Math.min(LAST - 1, Math.max(1, best)), ox: m.x, oy: m.y, dx: 0, dy: 0 };
      dragged = false;
      svg.setPointerCapture(e.pointerId);
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (!grab) return;
      const m = toMark(e);
      let dx = m.x - grab.ox, dy = m.y - grab.oy;
      const len = Math.hypot(dx, dy), MAX = 700;
      if (len > 4) dragged = true;
      if (len > 0) { const s = (MAX * Math.tanh(len / MAX)) / len; dx *= s; dy *= s; }
      grab.dx = dx; grab.dy = dy;
      const gi = grab.i;
      pts.forEach((p, i) => {
        const w = i <= gi ? Math.sin((Math.PI / 2) * (i / gi)) : Math.sin((Math.PI / 2) * ((LAST - i) / (LAST - gi)));
        p.x = REST[i][0] + dx * w; p.y = REST[i][1] + dy * w; p.vx = 0; p.vy = 0;
      });
      // The dashes lean back with the draw, like arrows on the string.
      dash.forEach((d, i) => { d.dx += (dx * 0.3 - d.dx) * 0.2; d.dy += (dy * 0.3 - d.dy) * 0.2; d.r += ((i ? 1 : -1) * Math.hypot(dx, dy) * 0.12 - d.r) * 0.2; });
      render();
    };
    const onUp = () => {
      if (!grab) return;
      // A press without a pull is a click: replay the pop instead of firing the string.
      if (!dragged) { grab = null; intro(); return; }
      // Release: the string fires forward past its rest; the dashes shoot the other way and spring back.
      pts.forEach((p, i) => { if (i === 0 || i === LAST) return; p.vx = -(p.x - REST[i][0]) * 0.32; p.vy = -(p.y - REST[i][1]) * 0.32; });
      const g = grab;
      dash.forEach((d, i) => { d.vdx = -g.dx * 0.28; d.vdy = -g.dy * 0.28; d.vr += (i ? -1 : 1) * 22; d.vs += 0.1; });
      grab = null;
      wake();
    };
    const noDrag = (e: Event) => e.preventDefault();

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('dragstart', noDrag);
    return () => {
      cancelAnimationFrame(raf);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('dragstart', noDrag);
    };
  }, []);

  return (
    <span className="exam-logo" role="img" aria-label={label}>
      <svg ref={svgRef} className="animated-logo" viewBox="0 -20 1380 300" aria-hidden="true">
        <g ref={markRef}>
          <path ref={pathRef} fill="none" stroke="var(--red)" strokeWidth={36} strokeLinecap="round" strokeLinejoin="round"
            d="M22,190 C55,150 85,95 112,100 C140,105 118,170 134,186 C150,200 172,168 300,52" />
          {DASHES.map((d, i) => (
            <g key={i} ref={(n) => { dashRefs.current[i] = n; }}>
              <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} stroke="var(--red)" strokeWidth={22} strokeLinecap="round" />
            </g>
          ))}
        </g>
        <image href="/brand/logo-wordmark.png" x={342} y={62} width={1021} height={195} />
      </svg>
    </span>
  );
}
