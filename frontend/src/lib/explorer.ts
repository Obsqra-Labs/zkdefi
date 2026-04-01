/**
 * Starknet explorers – single source of truth for tx/contract links.
 * Mainnet Voyager used for the demo dashboard reporting.
 * Sepolia Starkscan kept for testnet tx references.
 */

// ── Mainnet Voyager (primary for demo) ──
export const VOYAGER_BASE = "https://voyager.online";

export function voyagerTxUrl(txHash: string): string {
  const hash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${VOYAGER_BASE}/tx/${hash}`;
}

export function voyagerContractUrl(address: string): string {
  const addr = address.startsWith("0x") ? address : `0x${address}`;
  return `${VOYAGER_BASE}/contract/${addr}`;
}

export function voyagerClassUrl(classHash: string): string {
  const hash = classHash.startsWith("0x") ? classHash : `0x${classHash}`;
  return `${VOYAGER_BASE}/class/${hash}`;
}

export function voyagerBlockUrl(block: number | string): string {
  return `${VOYAGER_BASE}/block/${block}`;
}

// ── Sepolia (testnet) ──
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

export function sepoliaVoyagerContractUrl(address: string): string {
  const addr = address.startsWith("0x") ? address : `0x${address}`;
  return `${SEPOLIA_VOYAGER_BASE}/contract/${addr}`;
}

export function sepoliaVoyagerClassUrl(classHash: string): string {
  const hash = classHash.startsWith("0x") ? classHash : `0x${classHash}`;
  return `${SEPOLIA_VOYAGER_BASE}/class/${hash}`;
}

// ── Receipt-aware URL (auto-detect Sepolia vs mainnet) ──
const KNOWN_SEPOLIA_CONTRACTS = new Set([
  "0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff", // ReceiptRegistry (Sepolia)
  "0x076f1e28238b1ce4640632be6df94fcf3ac8b85ba9ad1fac00ef2142f10a1054", // ReceiptArchive (Sepolia)
]);

function isSepoliaContract(addr?: string | null): boolean {
  if (!addr) return false; // default to mainnet (current deployment)
  const normalized = addr.toLowerCase();
  for (const known of KNOWN_SEPOLIA_CONTRACTS) {
    if (normalized.startsWith(known)) return true;
  }
  return false;
}

/** Smart receipt tx URL — uses Sepolia Voyager for known Sepolia contracts, mainnet otherwise. */
export function receiptVoyagerTxUrl(
  txHash: string,
  contractAddress?: string | null,
): string {
  return isSepoliaContract(contractAddress)
    ? sepoliaVoyagerTxUrl(txHash)
    : voyagerTxUrl(txHash);
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
