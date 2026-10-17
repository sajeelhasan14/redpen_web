'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { COPY } from '@/content/copy';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void };
  }
}

/** `ready` is true once the visitor holds a valid rp_session cookie (always true inside the gate). */
export const SessionContext = createContext({ ready: false });
export const useSessionReady = () => useContext(SessionContext).ready;

type Phase = 'checking' | 'challenge' | 'failed' | 'passed';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Cloudflare Turnstile check before the page opens. A visitor with a valid session
 * cookie goes straight through; everyone else proves they are human once and gets the
 * 24 h cookie that the demo and waitlist routes accept.
 *
 * The children are always rendered (server-side too, so crawlers and link previews see
 * the landing copy). Until the check passes they sit hidden, inert and aria-hidden under
 * an opaque full-screen overlay, and the session context stays not-ready so nothing
 * underneath calls an API or starts animating.
 */
export default function HumanGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const exchange = useCallback(async (token: string) => {
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    setPhase(r?.ok ? 'passed' : 'failed');
  }, []);

  // 1. Already verified? Skip the challenge.
  useEffect(() => {
    let live = true;
    fetch('/api/session', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ ok?: boolean }>)
      .then((j) => live && setPhase(j.ok ? 'passed' : 'challenge'))
      .catch(() => live && setPhase('challenge'));
    return () => { live = false; };
  }, []);

  // 2. Challenge: render the Turnstile widget in the card (or, in local dev without a site key, post an empty token).
  useEffect(() => {
    if (phase !== 'challenge') return;
    if (!siteKey) {
      void exchange('');
      return;
    }
    if (widget.current !== undefined || !box.current) return;
    const render = () => {
      if (!box.current || widget.current !== undefined) return;
      widget.current = window.turnstile?.render(box.current, {
        sitekey: siteKey,
        appearance: 'always',
        size: 'flexible', // fills the card (min 300px) instead of a fixed 300px box
        callback: (t: string) => void exchange(t),
        'error-callback': () => setPhase('failed'),
        'expired-callback': () => window.turnstile?.reset(widget.current),
      });
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = SCRIPT;
      s.async = true;
      s.onload = render;
      s.onerror = () => setPhase('failed');
      document.head.appendChild(s);
    }
  }, [phase, siteKey, exchange]);

  // The page did not exist when the browser tried to follow a #hash (e.g. the waitlist
  // confirm redirect to /#waitlist), so jump there once it renders.
  useEffect(() => {
    if (phase !== 'passed' || !window.location.hash) return;
    try {
      document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
    } catch {
      // A malformed hash (e.g. #%E0%A4%A) is just ignored.
    }
  }, [phase]);

  const retry = () => {
    setPhase('challenge');
    if (!siteKey) return; // the effect re-posts the empty token
    if (widget.current !== undefined) window.turnstile?.reset(widget.current);
    else window.location.reload(); // the script itself failed to load
  };

  const passed = phase === 'passed';
  return (
    <SessionContext.Provider value={{ ready: passed }}>
      <div className={passed ? undefined : 'gated'} inert={!passed} aria-hidden={passed ? undefined : true}>
        {children}
      </div>
      {!passed && (
        <div className="gate">
          <div className="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title" aria-live="polite">
            <strong className="logo gate-logo">{COPY.brand}</strong>
            <p id="gate-title" className="gate-msg">
              {phase === 'failed' ? "Couldn't verify — please refresh" : 'Checking you\u2019re human…'}
            </p>
            {/* Kept mounted across failed/challenge so turnstile.reset can reuse the widget. */}
            <div ref={box} className="gate-widget" hidden={phase === 'checking'} />
            {phase === 'failed' && <button className="btn primary" onClick={retry}>Retry</button>}
            <p className="gate-note">Protected by Cloudflare</p>
          </div>
        </div>
      )}
    </SessionContext.Provider>
  );
}
