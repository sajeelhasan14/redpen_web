import type { Counter } from './counter';

const TWO_DAYS = 2 * 24 * 3600;

export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const keys = (now: Date, ipHash: string) => {
  const day = dayKey(now);
  return { rate: `rl:${day}:${ipHash}`, visitor: `vb:${day}:${ipHash}`, spend: `spend:${day}` };
};

/**
 * Enforces the per-visitor daily check limit, the per-visitor daily pence
 * budget and the global daily spend cap, charging each as it goes.
 *
 * Every charge is an atomic increment that is checked AFTER it lands: if the
 * new value is over the limit, the increment (and any earlier ones for this
 * call) is taken back and the call is refused. So concurrent calls can never
 * leave recorded spend above the cap, and refused calls are never charged.
 * A burst at the boundary may refuse a call that would just have fitted; that
 * is accepted.
 */
export async function checkAndCharge(
  counter: Counter,
  o: {
    ipHash: string;
    costPence: number;
    countsTowardRate: boolean;
    perVisitor: number;
    perVisitorPence: number;
    dailyCapPence: number;
    now: Date;
  },
): Promise<{ ok: true } | { ok: false; reason: 'rate' | 'cap' }> {
  const k = keys(o.now, o.ipHash);
  const undo: [string, number][] = [];
  const refund = async () => {
    for (const [key, n] of undo) await counter.incrBy(key, -n, TWO_DAYS);
  };
  const charge = async (key: string, n: number, limit: number) => {
    const v = await counter.incrBy(key, n, TWO_DAYS);
    undo.push([key, n]);
    return v <= limit;
  };

  if (o.countsTowardRate && !(await charge(k.rate, 1, o.perVisitor))) {
    await refund();
    return { ok: false, reason: 'rate' };
  }
  if (!(await charge(k.visitor, o.costPence, o.perVisitorPence))) {
    await refund();
    return { ok: false, reason: 'rate' };
  }
  if (!(await charge(k.spend, o.costPence, o.dailyCapPence))) {
    await refund();
    return { ok: false, reason: 'cap' };
  }
  return { ok: true };
}

/**
 * Records spend beyond a call's up-front estimate (the true-up from real token
 * usage) against both the global spend and the visitor's budget. Never refuses:
 * the call already happened. Later calls see the higher totals.
 */
export async function addSpend(counter: Counter, o: { ipHash: string; pence: number; now: Date }): Promise<void> {
  if (!(o.pence > 0)) return;
  const k = keys(o.now, o.ipHash);
  await counter.incrBy(k.spend, o.pence, TWO_DAYS);
  await counter.incrBy(k.visitor, o.pence, TWO_DAYS);
}
