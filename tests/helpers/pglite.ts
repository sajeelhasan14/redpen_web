import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { Query } from '@/lib/db';

export async function freshDb(): Promise<Query> {
  const db = new PGlite();
  await db.exec(readFileSync('db/schema.sql', 'utf8'));
  return async (text, params = []) => (await db.query(text, params as unknown[])).rows as Record<string, unknown>[];
}
