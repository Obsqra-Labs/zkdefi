/**
 * Canonical token resolution for the zkDeFi frontend.
 *
 * ALL components should import from here instead of maintaining local maps.
 * Handles leading-zero variants (0x0… vs 0x…) and case-insensitive lookup.
 */

export const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  // ETH
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": { symbol: "ETH", decimals: 18 },
  "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7":  { symbol: "ETH", decimals: 18 },
  // STRK
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": { symbol: "STRK", decimals: 18 },
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d":  { symbol: "STRK", decimals: 18 },
  // USDC (Starknet bridged)
  "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": { symbol: "USDC", decimals: 6 },
  // USDC (alternate / mainnet)
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": { symbol: "USDC", decimals: 6 },
  // fUSDC (faucet USDC on Sepolia)
  "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": { symbol: "fUSDC", decimals: 6 },
  "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23":  { symbol: "fUSDC", decimals: 6 },
  // USDT
  "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8": { symbol: "USDT", decimals: 6 },
  // zkdETH (zkDeFi wrapped ETH)
  "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121": { symbol: "zkdETH", decimals: 18 },
  "0x9b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121":   { symbol: "zkdETH", decimals: 18 },
  // zkdAI (zkDeFi AI token)
  "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637": { symbol: "zkdAI", decimals: 18 },
  "0x50974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637":  { symbol: "zkdAI", decimals: 18 },
};

/** Normalize an address for map lookup. */
function normalize(addr: string): string {
  return (addr || "").toLowerCase().replace(/\.+$/g, "");
}

/** Strip ALL leading zeros after 0x prefix (0x00abc → 0xabc). */
function stripLeadingZeros(hex: string): string {
  if (!hex.startsWith("0x")) return hex;
  const stripped = hex.slice(2).replace(/^0+/, "");
  return "0x" + (stripped || "0");
}

/**
 * Resolve a Starknet token address to its human-readable symbol.
 * Falls back to a truncated hex string if unknown.
 */
export function resolveTokenSymbol(addr: string): string {
  const clean = normalize(addr);
  if (KNOWN_TOKENS[clean]) return KNOWN_TOKENS[clean].symbol;
  const stripped = stripLeadingZeros(clean);
  if (KNOWN_TOKENS[stripped]) return KNOWN_TOKENS[stripped].symbol;
  // Prefix match for truncated addresses
  for (const [full, info] of Object.entries(KNOWN_TOKENS)) {
    if (full.startsWith(clean) && clean.length >= 6) return info.symbol;
  }
  return clean.length > 14 ? `${clean.slice(0, 6)}…${clean.slice(-4)}` : clean;
}

/**
 * Resolve a Starknet token address to its decimals.
 * Defaults to 18 if unknown.
 */
export function resolveTokenDecimals(addr: string): number {
  const clean = normalize(addr);
  if (KNOWN_TOKENS[clean]) return KNOWN_TOKENS[clean].decimals;
  const stripped = stripLeadingZeros(clean);
  if (KNOWN_TOKENS[stripped]) return KNOWN_TOKENS[stripped].decimals;
  return 18;
}

/**
 * Resolve a Starknet token address to both symbol and decimals.
 */
export function resolveToken(addr: string): { symbol: string; decimals: number } {
  const clean = normalize(addr);
  if (KNOWN_TOKENS[clean]) return KNOWN_TOKENS[clean];
  const stripped = stripLeadingZeros(clean);
  if (KNOWN_TOKENS[stripped]) return KNOWN_TOKENS[stripped];
  return {
    symbol: clean.length > 14 ? `${clean.slice(0, 6)}…${clean.slice(-4)}` : clean,
    decimals: 18,
  };
}

// ── Shared formatting utilities ─────────────────────────────────────────

/**
 * Format a fee tier integer to a human-readable percentage string.
 * Handles both raw and basis-point representations from Ekubo.
 */
export function feeTierLabel(tier: number): string {
  if (tier === 500 || tier === 5) return "0.05%";
  if (tier === 3000 || tier === 30) return "0.30%";
  if (tier === 10000 || tier === 100) return "1.00%";
  if (tier > 0 && tier < 10000) return `${(tier / 10000).toFixed(2)}%`;
  return `${tier}`;
}

/**
 * Format a raw on-chain integer (as string) to a human-readable decimal.
 * Shows up to 4 decimal places; shows "<0.0001" for dust amounts.
 */
export function formatRawAmount(rawStr: string, decimals: number): string {
  try {
    const v = BigInt(rawStr || "0");
    const scale = BigInt(10) ** BigInt(decimals);
    const whole = v / scale;
    const frac = v % scale;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    const r = fracStr ? `${whole}.${fracStr}` : whole.toString();
    return r === "0" && v > BigInt(0) ? "<0.0001" : r;
  } catch {
    return "0";
  }
}
