import type { SupportedAsset, RecommendationDriftStatus } from "./types";

/**
 * Parse a human-readable token amount (e.g. "1.14") into a wei string
 * using pure string manipulation — no floating-point precision loss.
 *
 * Examples:
 *   parseAmountWei("1.14", 18)  → "1140000000000000000"
 *   parseAmountWei("0.5", 6)    → "500000"
 *   parseAmountWei("100", 18)   → "100000000000000000000"
 */
export function parseAmountWei(amount: string, decimals: number): string {
  const s = amount.trim();
  if (!s || s === "0") return "0";

  // Split on decimal point
  const dotIdx = s.indexOf(".");
  let intPart: string;
  let fracPart: string;
  if (dotIdx === -1) {
    intPart = s;
    fracPart = "";
  } else {
    intPart = s.slice(0, dotIdx);
    fracPart = s.slice(dotIdx + 1);
  }

  // Pad or truncate fractional part to exactly `decimals` digits
  if (fracPart.length < decimals) {
    fracPart = fracPart.padEnd(decimals, "0");
  } else if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  }

  // Concatenate and strip leading zeros
  const raw = (intPart + fracPart).replace(/^0+/, "") || "0";
  return raw;
}

export function formatUsd(value: number): string {
  const fractionDigits = value >= 1000 ? 0 : value >= 1 ? 2 : value > 0 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: value >= 1000 ? 0 : value > 0 && value < 1 ? Math.min(4, fractionDigits) : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatPercent(value: number, digits = 0): string {
  return `${Number.isFinite(value) ? value.toFixed(digits) : "0"}%`;
}

export function formatAssetAmount(value: number, asset: SupportedAsset): string {
  if (!Number.isFinite(value) || value <= 0) return `0 ${asset}`;
  if (value >= 1000) {
    return `${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value)} ${asset}`;
  }
  const decimals = asset === "USDC" ? 4 : asset === "WBTC" ? 6 : value < 0.01 ? 6 : 4;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })} ${asset}`;
}

export function formatEditableAmount(value: number, asset: SupportedAsset): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const decimals = asset === "USDC" ? 4 : asset === "WBTC" ? 8 : 6;
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

export function assetAccentClasses(asset: SupportedAsset): string {
  switch (asset) {
    case "ETH":
      return "bg-cyan-300";
    case "STRK":
      return "bg-emerald-300";
    case "USDC":
      return "bg-amber-300";
    case "WBTC":
      return "bg-orange-400";
    default:
      return "bg-zinc-300";
  }
}

export function driftTone(status: RecommendationDriftStatus | undefined): string {
  if (status === "rebalance") return "border-rose-500/20 bg-rose-500/10 text-rose-300";
  if (status === "watch") return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
}
