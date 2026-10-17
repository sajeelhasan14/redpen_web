'use client';

import { useEffect, useState } from 'react';
import { BOARDS } from '@/lib/boards';
import HumanGate from '@/components/HumanGate';

type State = 'confirming' | 'completed' | 'refunded' | 'slow' | 'bad';

export default function ThanksPage() {
  return <HumanGate><Thanks /></HumanGate>;
}

function Thanks() {
  const [state, setState] = useState<State>('confirming');
  const [txn, setTxn] = useState('');
  const [board, setBoard] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('txn') ?? '';
    setTxn(t);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const r = await fetch(`/api/order?txn=${encodeURIComponent(t)}`).catch(() => null);
      if (r?.status === 400) return setState('bad');
      if (r?.status === 200) {
        const j = (await r.json()) as { status: 'completed' | 'refunded'; board: string | null };
        setBoard(j.board);
        return setState(j.status);
      }
      // 202 pending: Paddle's webhook has not landed yet.
      if (++tries >= 20) return setState('slow');
      timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => clearTimeout(timer);
  }, []);

  const saveBoard = async (b: string) => {
    const r = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txnId: txn, board: b }) });
    if (r.ok) { setBoard(b); setSaved(true); }
  };

  return (
    <main className="wrap thanks">
      {state === 'confirming' && <><h1>Confirming your payment…</h1><p>This usually takes a few seconds.</p></>}
      {state === 'completed' && (
        <>
          <h1>You're in. Thank you!</h1>
          <p>Your Early-bird Season Pass 2027 is confirmed. Paddle has emailed your receipt.</p>
          <p>What happens next: a short email each month on how the build is going, then a login invite when RedPen Maths opens in January 2027. You can get a full refund any time before launch; just reply to any of our emails.</p>
          {!board && (
            <div className="board-ask">
              <p>Which exam board is your child on? (optional)</p>
              <div className="cta">{BOARDS.map((b) => <button key={b} className="btn" onClick={() => void saveBoard(b)}>{b}</button>)}</div>
            </div>
          )}
          {saved && <p role="status">Thanks, noted.</p>}
        </>
      )}
      {state === 'refunded' && <><h1>This order was refunded</h1><p>If that's a surprise, reply to your Paddle receipt and we'll sort it out.</p></>}
      {state === 'slow' && <><h1>Payment received</h1><p>Our confirmation is taking longer than usual. Your Paddle receipt is your proof of purchase, and we'll email you shortly.</p></>}
      {state === 'bad' && <><h1>We couldn't find that order</h1><p>Please check the link in your receipt email.</p></>}
      <p><a href="/">Back to RedPen Maths</a></p>
    </main>
  );
}
