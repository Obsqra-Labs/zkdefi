/**
 * Shared StarkNet / DeFi utility functions.
 *
 * Extracted from EkuboLpPanel and UnifiedWithdrawCard to eliminate
 * duplication and reduce monolith file sizes.
 */

// ---------------------------------------------------------------------------
// Address / hex helpers
// ---------------------------------------------------------------------------

/** Ensure a string has an 0x prefix and is typed as `0x${string}`. */
export function ensureHex(input: string): `0x${string}` {
  return (input.startsWith("0x") ? input : `0x${input}`) as `0x${string}`;
}

/**
 * Normalize a StarkNet address to lowercase 0x-prefixed form with
 * leading zeros stripped (e.g. "0x04…" → "0x4…").
 */
export function normalizeAddressKey(input: string): string {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return "";
  const withoutPrefix = raw.startsWith("0x") ? raw.slice(2) : raw;
  const stripped = withoutPrefix.replace(/^0+/, "");
  return `0x${stripped || "0"}`;
}

/** Shorten a hex address/hash for display: "0xabcd…ef01" */
export function shortAddress(addr: string): string {
  if (!addr || !addr.startsWith("0x")) return addr;
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

/** Shorten any long hash/hex string for display. */
export function shortenHash(value: string): string {
  const text = String(value || "");
  if (!text) return "";
  return text.length > 20 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

// ---------------------------------------------------------------------------
// BigInt / U256 helpers
// ---------------------------------------------------------------------------

const U128_MASK = (BigInt(1) << BigInt(128)) - BigInt(1);

/** Split a bigint into [low128, high128] for Cairo U256 calldata. */
export function toU256(value: bigint): [string, string] {
  return [(value & U128_MASK).toString(), (value >> BigInt(128)).toString()];
}

/** Parse an unknown value to bigint or null. Handles hex and decimal strings. */
export function parseBigIntLike(input: unknown): bigint | null {
  const text = String(input ?? "").trim();
  if (!text) return null;
  try {
    if (text.startsWith("0x") || text.startsWith("0X")) return BigInt(text);
    if (/^-?\d+$/.test(text)) return BigInt(text);
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a U256 from starknet.js callContract return value.
 * Handles both `string[]` and `{ result: string[] }` shapes.
 */
export function parseU256FromCallResult(raw: unknown): bigint {
  let arr: Array<string | bigint>;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
    const inner = (raw as Record<string, unknown>).result;
    arr = Array.isArray(inner) ? inner : [];
  } else {
    return BigInt(0);
  }
  if (arr.length === 0) return BigInt(0);
  if (arr.length === 1) return BigInt(arr[0]);
  const low = BigInt(arr[0]);
  const high = BigInt(arr[1]);
  return low + (high << BigInt(128));
}

// ---------------------------------------------------------------------------
// Numeric formatting
// ---------------------------------------------------------------------------

/** Format a raw bigint balance with given decimals, truncated to 4 frac digits. */
export function formatBalance(raw: bigint, decimals: number): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/** Format a raw bigint balance with given decimals, full fractional precision. */
export function formatBalanceFull(raw: bigint, decimals: number): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/** Format a raw wei string (18 decimals) to human-readable, truncated to 4 frac digits. */
export function formatWei18(wei: string): string {
  try {
    const raw = BigInt(wei || "0");
    const base = BigInt(10) ** BigInt(18);
    const whole = raw / base;
    const frac = raw % base;
    const fracText = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return fracText ? `${whole.toString()}.${fracText}` : whole.toString();
  } catch {
    return "0";
  }
}

/** Convert human-readable amount (e.g. "0.06") to raw integer string for on-chain use. */
export function parseHumanToRaw(human: string, decimals: number): string {
  const trimmed = (human || "0").trim();
  if (!trimmed || trimmed === "0" || trimmed === ".") return "0";
  const parts = trimmed.split(".");
  const wholePart = parts[0] || "0";
  const fracPart = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
  const raw = wholePart + fracPart;
  return raw.replace(/^0+/, "") || "0";
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** Sanitize decimal input: allow digits and at most one decimal point. */
export function sanitizeDecimalInput(value: string): string {
  let result = value.replace(/[^0-9.]/g, "");
  const dotIndex = result.indexOf(".");
  if (dotIndex !== -1) {
    result = result.slice(0, dotIndex + 1) + result.slice(dotIndex + 1).replace(/\./g, "");
  }
  return result;
}

/** Check if a string is a positive integer (no leading zeros, > 0). */
export function isPositiveIntegerText(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) > BigInt(0);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Promise-based delay (browser setTimeout wrapper). */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });
}
