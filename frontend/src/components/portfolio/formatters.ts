import type { SupportedAsset, RecommendationDriftStatus } from "./types";

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
