import { passesLeft } from '@/lib/orders/handler';
import { pgQuery } from '@/lib/db';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cap = config().passCap;
    return Response.json({ left: await passesLeft(pgQuery(), cap), cap }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ left: null }, { status: 503 });
  }
}
