/**
 * Safely convert any value to BigInt, handling scientific notation strings
 * like "2.61245e+21" which BigInt() cannot parse natively.
 *
 * Handles: integers, strings, scientific notation, floats, null/undefined.
 */
export function safeBigInt(v: string | number | bigint | undefined | null): bigint {
  if (v == null || v === "") return BigInt(0);
  if (typeof v === "bigint") return v;
  try {
    return BigInt(v);
  } catch {
    // Scientific notation string ("2.61e+21") or float → Number → BigInt
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return BigInt(0);
    try {
      return BigInt(Math.round(n));
    } catch {
      return BigInt(0);
    }
  }
}
