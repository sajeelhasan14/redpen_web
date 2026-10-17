import { handleWebhook } from '@/lib/orders/handler';
import { fetchCustomerEmail } from '@/lib/payments';
import { pgQuery } from '@/lib/db';
import { purchaseEmail, resendSender } from '@/lib/email';
import { paymentsEnabled } from '@/lib/payments-flag';
import { toResponse } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!paymentsEnabled()) return Response.json({ error: 'payments not enabled' }, { status: 503 });
  const raw = await req.text(); // raw body: the signature covers the exact bytes
  const result = await handleWebhook(raw, req.headers.get('paddle-signature'), {
    q: pgQuery(),
    secret: process.env.PADDLE_WEBHOOK_SECRET ?? '',
    nowSec: () => Math.floor(Date.now() / 1000),
    emailFor: (id) => fetchCustomerEmail(id),
    sendPurchase: async (email) => {
      const m = purchaseEmail(process.env.SITE_URL ?? 'https://redpenmaths.com');
      await resendSender()(email, m.subject, m.html);
    },
  });
  return toResponse(result);
}
