/**
 * Starknet Sepolia explorer helpers.
 * Keep URLs normalized so history links are valid across Starkscan/Voyager.
 */
export const SEPOLIA_STARKSCAN_BASE = "https://sepolia.starkscan.co";
export const SEPOLIA_VOYAGER_BASE = "https://sepolia.voyager.online";
export const MAINNET_STARKSCAN_BASE = "https://starkscan.co";
export const MAINNET_VOYAGER_BASE = "https://voyager.online";

function cleanHex(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!withoutPrefix || /[^0-9a-fA-F]/.test(withoutPrefix)) return null;
  return `0x${withoutPrefix.toLowerCase()}`;
}

export function normalizeStarknetHex(input: string): `0x${string}` | null {
  const normalized = cleanHex(input);
  if (!normalized) return null;
  return normalized as `0x${string}`;
}

function normalizeOrFallback(input: string): string {
  return normalizeStarknetHex(input) ?? input;
}

/** Starknet Sepolia chain id (hex). */
export const STARKNET_SEPOLIA_CHAIN_ID = "0x534e5f5345504f4c4941";
/** Starknet mainnet chain id (hex). */
export const STARKNET_MAINNET_CHAIN_ID = "0x534e5f4d41494f";

export function isSepoliaChain(chainId: string | null | undefined): boolean {
  if (!chainId) return true;
  const n = (chainId + "").trim().toLowerCase();
  return n === STARKNET_SEPOLIA_CHAIN_ID.toLowerCase() || n === "sepolia";
}

export function starkscanBaseUrl(chainId?: string | null): string {
  return isSepoliaChain(chainId) ? SEPOLIA_STARKSCAN_BASE : MAINNET_STARKSCAN_BASE;
}

export function voyagerBaseUrl(chainId?: string | null): string {
  return isSepoliaChain(chainId) ? SEPOLIA_VOYAGER_BASE : MAINNET_VOYAGER_BASE;
}

export function sepoliaStarkscanTxUrl(txHash: string): string {
  return `${SEPOLIA_STARKSCAN_BASE}/tx/${normalizeOrFallback(txHash)}`;
}

export function sepoliaVoyagerTxUrl(txHash: string): string {
  return `${SEPOLIA_VOYAGER_BASE}/tx/${normalizeOrFallback(txHash)}`;
}

export function starkscanTxUrl(txHash: string, chainId?: string | null): string {
  return `${starkscanBaseUrl(chainId)}/tx/${normalizeOrFallback(txHash)}`;
}

export function voyagerTxUrl(txHash: string, chainId?: string | null): string {
  return `${voyagerBaseUrl(chainId)}/tx/${normalizeOrFallback(txHash)}`;
}

export function sepoliaStarkscanContractUrl(address: string): string {
  return `${SEPOLIA_STARKSCAN_BASE}/contract/${normalizeOrFallback(address)}`;
}

export function sepoliaVoyagerContractUrl(address: string): string {
  return `${SEPOLIA_VOYAGER_BASE}/contract/${normalizeOrFallback(address)}`;
}

export function sepoliaTxExplorerLinks(txHash: string): Array<{ label: string; url: string }> {
  return [
    { label: "Starkscan", url: sepoliaStarkscanTxUrl(txHash) },
    { label: "Voyager", url: sepoliaVoyagerTxUrl(txHash) },
  ];
}

export function txExplorerLinks(txHash: string, chainId?: string | null): Array<{ label: string; url: string }> {
  const base = starkscanBaseUrl(chainId);
  const vBase = voyagerBaseUrl(chainId);
  const normalized = normalizeOrFallback(txHash);
  return [
    { label: "Starkscan", url: `${base}/tx/${normalized}` },
    { label: "Voyager", url: `${vBase}/tx/${normalized}` },
  ];
}
