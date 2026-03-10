/**
 * Safe number formatting for API-driven values.
 * Avoids "x.toFixed is not a function" when values are undefined, null, or string.
 */

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Format as decimal with fixed digits; returns "0" for non-numbers. */
export function toFixed(value: unknown, digits: number): string {
  return toNumber(value).toFixed(digits);
}

/** Format as USD; safe for undefined/string. */
export function formatUsdSafe(value: unknown): string {
  const x = toNumber(value);
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

/** Format as percent; safe for undefined/string. */
export function formatPercentSafe(value: unknown, digits = 1): string {
  return `${toFixed(value, digits)}%`;
}
