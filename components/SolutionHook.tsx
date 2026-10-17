'use client';

import { useState } from 'react';
import { COPY } from '@/content/copy';
import type { DemoQuestion } from '@/content/demo-questions';

const K = COPY.hook;

// Under the live demo: a small link that opens the worked solution. The pitch is the hero's hook line, not here.
// TryIt renders it with key={q.id}, so switching questions closes it again.
export default function SolutionHook({ q, highlight }: { q: DemoQuestion; highlight: boolean }) {
  const [open, setOpen] = useState(false);
  const total = q.solution.steps.reduce((n, s) => n + s.points, 0);
  return (
    <div className={`hook${highlight && !open ? ' nudge' : ''}`}>
      <button type="button" className="hook-link" aria-expanded={open} aria-controls="worked-solution" onClick={() => setOpen(!open)}>
        {open ? K.hide : <>{K.show} <span aria-hidden="true">→</span></>}
      </button>
      {open && (
        <div id="worked-solution" className="solution">
          <p className="solution-head">{K.heading} <span>· {total} {K.pointsOne}{total === 1 ? '' : 's'}</span></p>
          <ol>
            {q.solution.steps.map((s) => (
              <li key={s.text}><span className="solution-pt">{s.points} {K.pointsOne}</span>{s.text}</li>
            ))}
          </ol>
          <p className="solution-trap"><strong>{K.trap}</strong> {q.solution.trap}</p>
        </div>
      )}
    </div>
  );
}
