// components/PointsExample.tsx: a static, clearly-labelled example of point-by-point scoring.
import { COPY } from '@/content/copy';

const S = COPY.scoring;

export default function PointsExample() {
  return (
    <figure className="tally" aria-label="Example of how one problem will be scored">
      <p className="tally-question">{S.question}</p>
      <table>
        <thead><tr>{S.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{S.rows.map((r) => <tr key={r.point}><td>{r.point}</td><td>{r.result}</td><td>{r.why}</td></tr>)}</tbody>
      </table>
      <p className="tally-total">{S.total}</p>
      <p className="tally-contrast">{S.contrast}</p>
      <figcaption className="tally-label">{S.label}</figcaption>
    </figure>
  );
}
