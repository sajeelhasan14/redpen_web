// Applies db/schema.sql to DATABASE_URL. Idempotent (CREATE TABLE IF NOT EXISTS).
// Runs as Railway's preDeployCommand, so every deploy applies the schema first.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

function sslFor(u) {
  const host = new URL(u).hostname;
  return host.endsWith('.railway.internal') || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
    ? undefined
    : { rejectUnauthorized: false };
}

const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
await client.connect();
try {
  // No params, so pg uses the simple query protocol and accepts the whole multi-statement file.
  await client.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  console.log('schema applied');
} finally {
  await client.end();
}
