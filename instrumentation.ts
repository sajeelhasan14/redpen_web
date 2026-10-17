// Runs once when a server instance starts, before it handles any request.
export async function register() {
  const { assertProdEnv } = await import('./lib/env');
  assertProdEnv();
}
