// components/Faq.tsx
import { COPY } from '@/content/copy';

export default function Faq() {
  return (
    <div className="faq">
      {COPY.faq.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
