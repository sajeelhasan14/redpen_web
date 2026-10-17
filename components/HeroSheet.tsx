'use client';

import { useState } from 'react';
import MarkedScrap from '@/components/desk/MarkedScrap';
import QuestionMath from '@/components/QuestionMath';
import { getDemoQuestion } from '@/content/demo-questions';

const CHALLENGE = getDemoQuestion('q-challenge')!;

// The hero's right-hand side: the challenge as printed, a wrong attempt at it
// marked in red on a loop, and the grader's stamps once the pen has finished.
export default function HeroSheet({ label, caption }: { label: string; caption: string }) {
  const [marked, setMarked] = useState(false);
  return (
    <figure className={`hero-sheet${marked ? ' marked' : ''}`}>
      <div className="hero-sheet-q"><QuestionMath q={CHALLENGE} /></div>
      <div className="hero-sheet-work">
        <MarkedScrap label={label} onMarked={setMarked} />
        <span className="stamp minus" aria-hidden="true">−1</span>
        <span className="stamp carried" aria-hidden="true">carried ✓</span>
      </div>
      <span className="stamp score" aria-hidden="true">3/4</span>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
