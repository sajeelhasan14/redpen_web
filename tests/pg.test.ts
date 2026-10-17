import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sslFor } from '@/lib/db';

test('sslFor: no TLS on Railway private network or localhost, TLS elsewhere', () => {
  assert.equal(sslFor('postgresql://u:p@postgres.railway.internal:5432/railway'), undefined);
  assert.equal(sslFor('postgresql://u:p@localhost:5432/x'), undefined);
  assert.deepEqual(sslFor('postgresql://u:p@roundhouse.proxy.rlwy.net:1234/railway'), { rejectUnauthorized: false });
});
