'use client';

import { useEffect, useState } from 'react';

// Phones only (CSS hides it on wider screens): the sign-up button pinned to the
// bottom, hidden while the hero button, the live demo or the sign-up form is on
// screen, so it never covers the sheet someone is writing on.
const WATCH = ['hero-cta', 'try', 'waitlist'];

export default function StickyCta({ label }: { label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const seen = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
      setShow(seen.size === 0);
    });
    for (const id of WATCH) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return (
    <div className={`sticky-cta${show ? ' show' : ''}`} aria-hidden={!show}>
      <a className="pill pill-red" href="#waitlist" tabIndex={show ? 0 : -1}>{label}</a>
    </div>
  );
}
