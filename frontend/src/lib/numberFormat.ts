export function sanitizeNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

export function clampDisplay(value: unknown, minAbs = 1e-12, maxAbs = 1e12): number | null {
  const num = sanitizeNumber(value);
  if (num == null) return null;
  const abs = Math.abs(num);
  if (abs === 0) return 0;
  if (abs < minAbs || abs > maxAbs) return null;
  return num;
}

export function formatUsd(value: unknown, fallback = "—"): string {
  const num = clampDisplay(value, 1e-12, 1e15);
  if (num == null) return fallback;
  const abs = Math.abs(num);
  if (abs >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

export function formatCompact(value: unknown, fallback = "—"): string {
  const num = clampDisplay(value, 1e-12, 1e15);
  if (num == null) return fallback;
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toFixed(2);
}

export function formatPrice(value: unknown, fallback = "—"): string {
  const num = clampDisplay(value, 1e-12, 1e12);
  if (num == null || num <= 0) return fallback;
  if (num < 0.0001) return num.toExponential(3);
  if (num < 1) return num.toFixed(6);
  if (num < 1000) return num.toFixed(4);
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatPct(value: unknown, digits = 2, fallback = "—"): string {
  const num = clampDisplay(value, 1e-9, 1e4);
  if (num == null) return fallback;
  return `${num.toFixed(digits)}%`;
}
