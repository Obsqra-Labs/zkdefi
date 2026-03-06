/**
 * Starknet Sepolia explorer – single source of truth for tx/contract links.
 * Working base: https://sepolia.starkscan.co
 */
export const SEPOLIA_STARKSCAN_BASE = "https://sepolia.starkscan.co";

export function sepoliaStarkscanTxUrl(txHash: string): string {
  const hash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${SEPOLIA_STARKSCAN_BASE}/tx/${hash}`;
}

export function sepoliaStarkscanContractUrl(address: string): string {
  const addr = address.startsWith("0x") ? address : `0x${address}`;
  return `${SEPOLIA_STARKSCAN_BASE}/contract/${addr}`;
}

export const SEPOLIA_VOYAGER_BASE = "https://sepolia.voyager.online";

export function sepoliaVoyagerTxUrl(txHash: string): string {
  const hash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${SEPOLIA_VOYAGER_BASE}/tx/${hash}`;
}

// ── Obsqra Proof Chain (L3) ──
export const L3_FORGE_BASE = "https://starknet.obsqra.fi/forge";

export function l3ExplorerUrl(): string {
  return `${L3_FORGE_BASE}/explorer`;
}

export function l3FactUrl(factHash: string): string {
  const hash = factHash.startsWith("0x") ? factHash : `0x${factHash}`;
  return `${L3_FORGE_BASE}/explorer?fact=${hash}`;
}
