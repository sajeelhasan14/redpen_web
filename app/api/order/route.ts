import { handleGetOrder, handleSetBoard } from '@/lib/orders/handler';
import { pgQuery } from '@/lib/db';
import { toResponse } from '@/lib/http';

export const runtime = 'nodejs';

const failed = (e: unknown) => {
  console.error('order route failed', e instanceof Error ? e.message : e);
  return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
};

export async function GET(req: Request) {
  try {
    return toResponse(await handleGetOrder(new URL(req.url).searchParams.get('txn'), pgQuery()));
  } catch (e) {
    return failed(e);
  }
}
export async function POST(req: Request) {
  try {
    return toResponse(await handleSetBoard(await req.json().catch(() => null), pgQuery()));
  } catch (e) {
    return failed(e);
  }
}
