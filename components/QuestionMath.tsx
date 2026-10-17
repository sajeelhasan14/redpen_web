// components/QuestionMath.tsx: the demo question set the way an exam prints it.
// The visual is aria-hidden; the plain question text goes to screen readers.
import type { DemoQuestion } from '@/content/demo-questions';

const Frac = ({ top, bottom }: { top: React.ReactNode; bottom: React.ReactNode }) => (
  <span className="qm-frac"><span>{top}</span><span>{bottom}</span></span>
);
const Sqrt = ({ children }: { children: React.ReactNode }) => (
  <span className="qm-sqrt">√<span>{children}</span></span>
);

function Typeset({ id }: { id: DemoQuestion['id'] }) {
  if (id === 'q-challenge')
    return (
      <>
        Evaluate{' '}
        <span className="qm-int">
          <span className="qm-sign">∫</span>
          <span className="qm-lims"><span>√π</span><span>0</span></span>
        </span>
        <i>6x</i> sin(<i>x</i>²) <i>dx</i>
      </>
    );
  if (id === 'q-implicit')
    return (
      <>
        <i>x</i>² + <i>y</i>² = 25. Find <Frac top={<i>dy</i>} bottom={<i>dx</i>} /> at (3, 4).
      </>
    );
  return (
    <>
      Find{' '}
      <span className="qm-lim"><span>lim</span><span><i>x</i>→3</span></span>
      <Frac top={<><Sqrt><i>x</i> + 1</Sqrt> − 2</>} bottom={<><i>x</i> − 3</>} />
    </>
  );
}

export default function QuestionMath({ q }: { q: DemoQuestion }) {
  return (
    <>
      <span className="sr-only">{q.text}</span>
      <span className="qm" aria-hidden="true"><Typeset id={q.id} /></span>
    </>
  );
}
