/**
 * @obsqra/sepolia-mm-client — thin HTTP wrapper for market-maker-sim.
 *
 *   import { createClient } from '@obsqra/sepolia-mm-client';
 *   const api = createClient({ baseUrl: 'http://localhost:8099' });
 *   const state = await api.publicState();
 */

const DEFAULT_BASE = "http://127.0.0.1:8099";

/** @param {{ baseUrl?: string, fetch?: typeof fetch }} [opts] */
export function createClient(opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const fetchFn = opts.fetch || globalThis.fetch;

  async function j(path) {
    const r = await fetchFn(`${baseUrl}${path}`);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`sepolia-mm ${r.status}: ${t || r.statusText}`);
    }
    return r.json();
  }

  return {
    baseUrl,
    health: () => j("/health"),
    publicState: () => j("/public/state"),
    publicPools: () => j("/public/pools"),
    publicEvents: (limit = 50) => j(`/public/events?limit=${limit}`),
    publicContracts: () => j("/public/contracts"),
    publicApy: () => j("/public/apy"),
    publicPositions: () => j("/public/positions"),
  };
}
