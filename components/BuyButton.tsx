'use client';

import { useEffect, useState } from 'react';
import { COPY } from '@/content/copy';
import { BOARDS } from '@/lib/boards';
import { paymentsEnabled } from '@/lib/payments-flag';

// The checkout for the paused UK early-bird pass. The page no longer renders it;
// it keeps its own wording so the site copy can change without touching it.
const PASS = {
  buy: 'Get the early-bird pass',
  price: '£49',
  adultOnly: "I'm the parent or guardian and I'm 18 or over",
  openingSoon: 'Early-bird passes open soon. Join the waitlist to be first in line.',
  soldOut: 'Early-bird passes have gone. Join the waitlist for launch pricing.',
};

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (e: string) => void };
      Initialize: (o: { token: string; eventCallback?: (e: { name: string; data?: { transaction_id?: string } }) => void }) => void;
      Checkout: { open: (o: Record<string, unknown>) => void };
    };
  }
}

let paddleReady: Promise<void> | null = null;
function loadPaddle() {
  paddleReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = () => {
      try {
      if (process.env.NEXT_PUBLIC_PADDLE_ENV !== 'production') window.Paddle!.Environment.set('sandbox');
      window.Paddle!.Initialize({
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? '',
        eventCallback: (e) => {
          if (e.name === 'checkout.completed' && e.data?.transaction_id) window.location.href = `/thanks?txn=${encodeURIComponent(e.data.transaction_id)}`;
        },
      });
      resolve();
      } catch (e) {
        reject(e);
      }
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  // Allow a retry after a failure instead of caching the rejected promise.
  paddleReady.catch(() => { paddleReady = null; });
  return paddleReady;
}

export default function BuyButton() {
  if (!paymentsEnabled()) {
    return (
      <div className="buy opening-soon">
        <p>{PASS.openingSoon}</p>
        <a className="btn" href="#waitlist">{COPY.waitlist.button}</a>
      </div>
    );
  }
  return <PaidBuyButton />;
}

function PaidBuyButton() {
  const [left, setLeft] = useState<number | null>(null);
  const [cap, setCap] = useState(200);
  const [agreed, setAgreed] = useState(false);
  const [board, setBoard] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/passes-left').then((r) => r.json()).then((j: { left: number | null; cap?: number }) => { setLeft(j.left); if (j.cap) setCap(j.cap); }).catch(() => {});
  }, []);

  const buy = async () => {
    setErr('');
    // Re-check on click: the page may have been open while the last passes sold.
    const j = (await fetch('/api/passes-left').then((r) => r.json()).catch(() => ({ left: null }))) as { left: number | null; cap?: number };
    setLeft(j.left);
    if (j.cap) setCap(j.cap);
    if (j.left === 0) return;
    try {
      await loadPaddle();
      window.Paddle!.Checkout.open({
        items: [{ priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID, quantity: 1 }],
        customData: { ...(board ? { board } : {}), parent_confirmed: true },
        settings: { displayMode: 'overlay', locale: 'en' },
      });
    } catch {
      setErr('Checkout could not open. Please try again in a moment.');
    }
  };

  if (left === 0) {
    return (
      <div className="buy sold-out">
        <p>{PASS.soldOut}</p>
        <a className="btn" href="#waitlist">{COPY.waitlist.button}</a>
      </div>
    );
  }

  return (
    <div className="buy">
      <label className="board">
        Exam board (optional)
        <select value={board} onChange={(e) => setBoard(e.target.value)}>
          <option value="">Choose…</option>
          {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        {PASS.adultOnly}
      </label>
      <button className="btn primary" disabled={!agreed} onClick={() => void buy()}>
        {PASS.buy}: {PASS.price}
      </button>
      {left !== null && left > 0 && <p className="left">{left} of {cap} early-bird passes left</p>}
      {err && <p role="alert">{err}</p>}
    </div>
  );
}
