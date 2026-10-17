import Redis from 'ioredis';

/** An atomic counter store. Redis in production, a Map in tests. */
export interface Counter {
  incrBy(key: string, n: number, ttlSec: number): Promise<number>;
  get(key: string): Promise<number>;
}

export class MemoryCounter implements Counter {
  private m = new Map<string, number>();
  async incrBy(key: string, n: number) {
    const v = (this.m.get(key) ?? 0) + n;
    this.m.set(key, v);
    return v;
  }
  async get(key: string) {
    return this.m.get(key) ?? 0;
  }
}

/** The slice of ioredis the counter uses, so tests can fake it. */
export interface RedisLike {
  multi(): RedisMulti;
  get(key: string): Promise<string | null>;
}
export interface RedisMulti {
  incrby(key: string, n: number): RedisMulti;
  expire(key: string, ttlSec: number, mode: 'NX'): RedisMulti;
  exec(): Promise<[Error | null, unknown][] | null>;
}

export function makeRedisCounter(client: RedisLike): Counter {
  return {
    async incrBy(key, n, ttlSec) {
      // INCRBY and EXPIRE NX in one MULTI: the TTL is set only if the key has none (the first
      // write of the day), and it cannot be missed if the process dies between two round trips.
      // EXPIRE NX needs Redis 7+.
      const res = await client.multi().incrby(key, n).expire(key, ttlSec, 'NX').exec();
      if (!res) throw new Error('redis: transaction aborted');
      for (const [err] of res) if (err) throw err;
      return Number(res[0][1]);
    },
    async get(key) {
      return Number((await client.get(key)) ?? 0);
    },
  };
}

/**
 * Production counter over one ioredis client. The client is created on the first command, not
 * when this is called, so importing a route at build time never opens a connection.
 * The default offline queue stays on so commands issued while connecting wait instead of failing;
 * maxRetriesPerRequest bounds how long they can wait.
 */
let shared: RedisLike | null = null;
const defaultMake = (u: string): RedisLike =>
  (shared ??= new Redis(u, { maxRetriesPerRequest: 2 }).on('error', () => {}) as unknown as RedisLike);

export function redisCounter(url = process.env.REDIS_URL, make: (url: string) => RedisLike = defaultMake): Counter {
  let inner: Counter | null = null;
  const get = () => {
    if (!inner) {
      if (!url) throw new Error('REDIS_URL is not set');
      inner = makeRedisCounter(make(url));
    }
    return inner;
  };
  const c: Counter = { incrBy: (k, n, t) => get().incrBy(k, n, t), get: (k) => get().get(k) };
  return c;
}
