import TryIt from '@/components/TryIt';
import WaitlistForm from '@/components/WaitlistForm';
import Faq from '@/components/Faq';
import PointsExample from '@/components/PointsExample';
import ExamReport from '@/components/ExamReport';
import HumanGate from '@/components/HumanGate';
import StickyCta from '@/components/StickyCta';
import AnimatedLogo from '@/components/AnimatedLogo';
import { StepFix, StepMarked, StepQuestion, Tick } from '@/components/desk/Marks';
import { COPY } from '@/content/copy';

const P = COPY.page;
const STEP_ART = [StepQuestion, StepMarked, StepFix];

/** Red handwriting in the grader's margin. Decorative on phones (hidden), so never the only copy of anything. */
const Note = ({ text, className = '' }: { text: string; className?: string }) => (
  <span className={`margin-note ${className}`} aria-hidden="true">{text}</span>
);

export default function Home() {
  return (
    <HumanGate>
      <main className="exam">
        <header className="exam-nav">
          <AnimatedLogo />
          <nav className="nav-links" aria-label="Sections">
            <a className="nav-link" href="#how">{P.navHow}</a>
            <a className="nav-link" href="#pricing">{P.navPricing}</a>
            <a className="pill pill-red nav-cta" href="#waitlist">{P.navCta}</a>
          </nav>
        </header>

        {/* The hero: the pitch beside a live board (trying it is optional), then the hook line under both. */}
        <section id="top" className="hero" aria-labelledby="hero-title">
          <div className="booklet" aria-hidden="true">
            <span className="booklet-course">{P.bookletCourse}</span>
            <span className="booklet-name">{P.bookletName} <span className="booklet-blank" /></span>
            <span className="booklet-problem">{P.bookletProblem}</span>
          </div>
          <div className="hero-grid">
            <div className="hero-pitch">
              <Note text={P.heroMargin} className="trap" />
              <h1 id="hero-title">{COPY.hero.title} <span className="red-ink">{COPY.hero.titleRed}</span></h1>
              <p className="lead">{COPY.hero.sub}</p>
              <div className="hero-cta" id="hero-cta">
                <a className="pill pill-red" href="#waitlist">{COPY.hero.cta}</a>
                <a className="hero-try" href="#try">{COPY.hero.try} <span aria-hidden="true">↓</span></a>
              </div>
              <ul className="hero-ticks">
                {COPY.hero.ticks.map((t) => <li key={t}><Tick className="hero-tick" width={10} />{t}</li>)}
              </ul>
            </div>
            <div id="try" className="try-demo">
              <TryIt />
              <p className="after-demo">{P.after}</p>
            </div>
          </div>
          <div className="hero-hook">
            <span className="hero-hook-stamp" aria-hidden="true">−1</span>
            <div className="hero-hook-text">
              <p className="hero-hook-kicker">{COPY.hook.lineKicker}</p>
              <p className="hero-hook-title">{COPY.hook.lineTitle} <span>{COPY.hook.lineTitleRed}</span></p>
              <p className="hero-hook-sub">{COPY.hook.lineSub}</p>
            </div>
            <div className="hero-hook-cta">
              <a className="pill pill-red" href="#waitlist">{COPY.hook.lineCta} <span aria-hidden="true">→</span></a>
              <small>{COPY.hook.lineNote}</small>
            </div>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title">
          <h2 id="how-title">{P.howTitle}</h2>
          <ol className="how-steps">
            {COPY.how.steps.map((s, i) => {
              const Art = STEP_ART[i];
              return (
                <li key={s.t}>
                  <Note text={String(i + 1)} />
                  <div className="step-art-wrap"><Art className="step-art" /></div>
                  <div>
                    <h3>{s.t}</h3>
                    <p>{s.d}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <h3 className="report-title">{COPY.report.title}</h3>
          <ExamReport />
        </section>

        <section id="scoring" aria-labelledby="scoring-title">
          <h2 id="scoring-title">{COPY.scoring.title}</h2>
          <p className="lead">{COPY.scoring.sub}</p>
          <PointsExample />
        </section>

        <section id="compare" aria-labelledby="compare-title">
          <h2 id="compare-title">{P.compareTitle}</h2>
          <table className="compare">
            <thead><tr><th scope="col">{COPY.compare.them}</th><th scope="col">{COPY.compare.us}</th></tr></thead>
            <tbody>{COPY.compare.rows.map(([a, b]) => <tr key={b}><td>{a}</td><td><Tick className="compare-tick" width={9} />{b}</td></tr>)}</tbody>
          </table>
        </section>

        {/* A course syllabus: the whole calculus sequence, each unit folded to its name. */}
        <section id="coverage" aria-labelledby="coverage-title">
          <h2 id="coverage-title">{P.coverageTitle}</h2>
          <p className="lead">{COPY.coverage.sub}</p>
          {COPY.coverage.courses.map((c) => (
            <div key={c.course} className="course">
              <h3 className="course-name">{c.course}</h3>
              <div className="units">
                {c.units.map((u) => (
                  <details key={u.name} className="unit">
                    <summary>
                      <span className="unit-name">{u.name}</span>
                      <span className="unit-note">{u.note}</span>
                      <span className="unit-count" aria-hidden="true" />
                    </summary>
                    <ul>{u.topics.map((t) => <li key={t}>{t}</li>)}</ul>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section id="trust" aria-labelledby="trust-title">
          <h2 id="trust-title">{P.trustTitle}</h2>
          <ul className="trust">
            {COPY.trust.points.map((p) => (
              <li key={p}><Tick className="trust-tick" width={9} />{p}</li>
            ))}
          </ul>
        </section>

        <section id="pricing" className="pricing" aria-labelledby="pricing-title">
          <Note text={P.pricingMargin} />
          <h2 id="pricing-title">{COPY.pricing.free}</h2>
          <p className="price-then">{COPY.pricing.then}</p>
          <p className="price-line">{COPY.pricing.pass}<small>{COPY.pricing.passLabel}</small></p>
          <p className="price-week">{COPY.pricing.perWeek}</p>
          <p className="price-alt">or <strong>{COPY.pricing.monthly}</strong> {COPY.pricing.monthlyLabel}</p>
          <p className="price-note">{COPY.pricing.note}</p>
          <a className="pill pill-red" href="#waitlist">{COPY.pricing.cta}</a>
        </section>

        <section id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title">{P.faqTitle}</h2>
          <Faq />
        </section>

        <section id="waitlist" className="signup" aria-labelledby="signup-title">
          <Note text={P.signupMargin} />
          <div className="signup-box">
            <h2 id="signup-title">{P.signupTitle}</h2>
            <p>{COPY.waitlist.sub}</p>
            <WaitlistForm />
          </div>
        </section>

        <footer className="exam-foot">
          <p>{COPY.footer}</p>
          <nav aria-label="Legal"><a href="/refunds">Refunds</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></nav>
        </footer>
      </main>
      <StickyCta label={COPY.hook.stickyCta} />
    </HumanGate>
  );
}
