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
