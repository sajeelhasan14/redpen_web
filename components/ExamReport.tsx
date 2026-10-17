// components/ExamReport.tsx: a static, clearly-labelled mock of a marked practice exam.
import { COPY } from '@/content/copy';

const R = COPY.report;

export default function ExamReport() {
  return (
    <figure className="report" aria-label="Example of a marked practice exam">
      <div className="report-head">
        <span className="report-exam">{R.exam}</span>
        <span className="report-score">{R.score}</span>
      </div>
      <ol className="report-problems">
        {R.problems.map((p, i) => {
          const [got, out] = p.s.split(' / ');
          return (
            <li key={p.n} className={got === out ? 'full' : undefined}>
              <span>{i + 1}. {p.n}</span><span className="report-pts">{p.s}</span>
            </li>
          );
        })}
      </ol>
      <div className="report-cols">
        <div>
          <p className="report-sub">{R.costlyTitle}</p>
          <ul className="report-costly">{R.costly.map((c) => <li key={c.text}><span className="report-pts">{c.pts}</span>{c.text}</li>)}</ul>
        </div>
        <div>
          <p className="report-sub">{R.fixTitle}</p>
          <ol className="report-fix">{R.fix.map((f) => <li key={f}>{f}</li>)}</ol>
        </div>
      </div>
      <figcaption className="tally-label">{R.label}</figcaption>
    </figure>
  );
}
