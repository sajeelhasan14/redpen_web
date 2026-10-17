// One switch for the whole payments surface. NEXT_PUBLIC_ vars are inlined at build time,
// so this is safe in client and server code, and changing it needs a redeploy.
export function paymentsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === '1';
}
