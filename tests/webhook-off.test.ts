import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '@/app/api/paddle/webhook/route';

test('webhook returns 503 without touching the DB when payments are off', async () => {
  delete process.env.NEXT_PUBLIC_PAYMENTS_ENABLED;
  const res = await POST(new Request('http://x/api/paddle/webhook', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'payments not enabled' });
});
