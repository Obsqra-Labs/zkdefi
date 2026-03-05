"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useProvider } from "@starknet-react/core";
import { ArrowDownUp, ChevronDown, RefreshCw, AlertTriangle, ExternalLink, Info } from "lucide-react";
import {
  buildAvnuSwapTx,
  buildSwapTx,
  getDexTokens,
  quoteAggregatedDexSwap,
  quoteAvnuSwap,
  quoteDexSwap,
  quoteSwap,
} from "@/lib/api/ekubo";
import { advisoryActionCheck, runActionGate } from "@/lib/api/gating";
import { formatAdvisoryElevatedRisk, formatAdvisoryPass, formatGateDenied } from "@/lib/gateCopy";
import {
  DexQuoteResponse,
  DexVenue,
  EkuboCapabilities,
  MarketOpportunity,
  SwapQuoteResponse,
  TokenInfo,
} from "@/types/ekubo";
import { toastError, toastSuccess } from "@/lib/toast";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { resolveExecutionPolicy } from "@/lib/executionPolicy";
import { executeCalls } from "@/lib/tx/executeCalls";
import { buildTxDebugInfo } from "@/lib/txDebug";
import { executionPreflight } from "@/lib/api/state";
import { TokenSelectorModal, normalizeAddr } from "./TokenSelectorModal";

export interface OperateHubEvent {
  type: "trade" | "lp";
  text: string;
  details?: string;
  txHash?: string;
  status?: "pending" | "confirmed" | "failed";
}

interface EkuboSwapPanelProps {
  tokenIn: string;
  tokenOut: string;
  onTokenChange: (tokenIn: string, tokenOut: string) => void;
  capabilities: EkuboCapabilities | null;
  pairMarketHint?: MarketOpportunity | null;
  gateConfig: {
    gateMode: "balanced" | "stress";
    sessionId?: string;
    passportScore?: number | null;
    manualWalletOverrideEnabled?: boolean;
    manualOverrideMinPassportScore?: number;
  };
  onEvent: (event: OperateHubEvent) => void;
}

const QUOTE_STALE_MS = 20_000;
const SEPOLIA_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const SEPOLIA_USDC = "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080";
const SEPOLIA_FUSDC = "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23";
const SEPOLIA_ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const CANONICAL_SWAP_TOKENS = [SEPOLIA_STRK, SEPOLIA_ETH, SEPOLIA_FUSDC, SEPOLIA_USDC];

const MIN_PAIR_TVL_USD = Number(process.env.NEXT_PUBLIC_SWAP_MIN_PAIR_TVL_USD ?? "5000");
const MIN_USDC_OUT = Number(process.env.NEXT_PUBLIC_SWAP_MIN_USDC_OUT ?? "0.1");
const MIN_ETH_USDC_RATE = Number(process.env.NEXT_PUBLIC_SWAP_MIN_ETH_USDC_RATE ?? "100");
const MAX_ETH_USDC_RATE = Number(process.env.NEXT_PUBLIC_SWAP_MAX_ETH_USDC_RATE ?? "100000");
const MIN_STRK_USDC_RATE = Number(process.env.NEXT_PUBLIC_SWAP_MIN_STRK_USDC_RATE ?? "0.05");
const MAX_STRK_USDC_RATE = Number(process.env.NEXT_PUBLIC_SWAP_MAX_STRK_USDC_RATE ?? "1000");
const DUST_ROUTE_MIN_USD = Number(process.env.NEXT_PUBLIC_SWAP_DUST_ROUTE_MIN_USD ?? "0.01");
const SAFE_VOL_SHARE = Number(process.env.NEXT_PUBLIC_SWAP_SAFE_VOL_SHARE ?? "0.005");
const SAFE_USD_MIN = Number(process.env.NEXT_PUBLIC_SWAP_SAFE_USD_MIN ?? "0.5");
const SAFE_USD_CAP = Number(process.env.NEXT_PUBLIC_SWAP_SAFE_USD_CAP ?? "25");
const AUTO_SPLIT_MAX_CHUNKS = Number(process.env.NEXT_PUBLIC_SWAP_AUTO_SPLIT_MAX_CHUNKS ?? "24");
const ADAPTIVE_SPLIT_MIN_CHUNK_UNITS = process.env.NEXT_PUBLIC_SWAP_ADAPTIVE_MIN_CHUNK_UNITS ?? "0.0001";
const ADAPTIVE_SPLIT_MAX_EXTRA_CHUNKS = Number(process.env.NEXT_PUBLIC_SWAP_ADAPTIVE_MAX_EXTRA_CHUNKS ?? "48");
const ROUTE_QUALITY_FLOOR = Number(process.env.NEXT_PUBLIC_SWAP_ROUTE_QUALITY_FLOOR ?? "35");

type TokenMeta = {
  symbol: string;
  decimals: number;
};

function normalizeAddressKey(input: string): string {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return "";
  const withoutPrefix = raw.startsWith("0x") ? raw.slice(2) : raw;
  const stripped = withoutPrefix.replace(/^0+/, "");
  return `0x${stripped || "0"}`;
}

function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalizeAddressKey(a) === normalizeAddressKey(b);
}

const KNOWN_TOKENS: Record<string, TokenMeta> = {
  [normalizeAddressKey(SEPOLIA_STRK)]: { symbol: "STRK", decimals: 18 },
  [normalizeAddressKey(SEPOLIA_USDC)]: { symbol: "USDC", decimals: 6 },
  [normalizeAddressKey(SEPOLIA_FUSDC)]: { symbol: "fUSDC", decimals: 6 },
  [normalizeAddressKey(SEPOLIA_ETH)]: { symbol: "ETH", decimals: 18 },
};

function isUsdStableToken(address: string): boolean {
  return sameAddress(address, SEPOLIA_USDC) || sameAddress(address, SEPOLIA_FUSDC);
}

function ensureHex(input: string): `0x${string}` {
  return (input.startsWith("0x") ? input : `0x${input}`) as `0x${string}`;
}

function toU256(value: bigint): [string, string] {
  const mask = (BigInt(1) << BigInt(128)) - BigInt(1);
  const low = (value & mask).toString();
  const high = (value >> BigInt(128)).toString();
  return [low, high];
}

function shortAddress(addr: string): string {
  if (!addr || !addr.startsWith("0x")) return addr;
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

function parseU256Result(result: Array<string | bigint>): bigint {
  if (!Array.isArray(result) || result.length === 0) return BigInt(0);
  if (result.length === 1) return BigInt(result[0]);
  const low = BigInt(result[0]);
  const high = BigInt(result[1]);
  return low + (high << BigInt(128));
}

function formatAmount(raw: bigint | string, decimals: number, maxFrac = 6): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const frac = value % scale;
  if (decimals === 0) return whole.toString();
  const padded = frac.toString().padStart(decimals, "0");
  const shown = padded.slice(0, Math.min(maxFrac, decimals)).replace(/0+$/, "");
  return shown ? `${whole.toString()}.${shown}` : whole.toString();
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

function formatUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function amountToFloat(raw: string, decimals: number): number {
  const parsed = Number(formatAmount(raw, decimals, decimals));
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function parseAmountToRaw(input: string, decimals: number): string | null {
  const text = input.trim();
  if (!text) return null;
  if (!/^\d*\.?\d*$/.test(text)) return null;
  const [wholeRaw, fracRaw = ""] = text.split(".");
  if (fracRaw.length > decimals) return null;
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals) || "0";
  const scale = BigInt(10) ** BigInt(decimals);
  const value = BigInt(whole) * scale + BigInt(frac);
  return value.toString();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function splitAmountRaw(total: bigint, maxChunk: bigint, maxChunks: number): bigint[] {
  if (total <= BigInt(0)) return [];
  if (maxChunk <= BigInt(0) || total <= maxChunk) return [total];

  let chunk = maxChunk;
  let chunks = Number((total + chunk - BigInt(1)) / chunk);
  const cappedChunks = Math.max(1, maxChunks);
  if (chunks > cappedChunks) {
    chunk = (total + BigInt(cappedChunks) - BigInt(1)) / BigInt(cappedChunks);
    chunks = Number((total + chunk - BigInt(1)) / chunk);
  }

  const out: bigint[] = [];
  let remaining = total;
  while (remaining > BigInt(0)) {
    const next = remaining > chunk ? chunk : remaining;
    out.push(next);
    remaining -= next;
  }
  return out;
}

class AdaptiveSwapRecoveryPolicy {
  constructor(
    private readonly minChunkRaw: bigint,
    private readonly maxExtraChunks: number,
  ) {}

  static from(tokenDecimals: number): AdaptiveSwapRecoveryPolicy {
    const minRaw = parseAmountToRaw(ADAPTIVE_SPLIT_MIN_CHUNK_UNITS, tokenDecimals) ?? "1";
    const minChunkRaw = BigInt(minRaw);
    return new AdaptiveSwapRecoveryPolicy(minChunkRaw > BigInt(0) ? minChunkRaw : BigInt(1), ADAPTIVE_SPLIT_MAX_EXTRA_CHUNKS);
  }

  shouldSplit(error: unknown): boolean {
    const text = this.errorText(error).toLowerCase();
    return (
      text.includes("u256_sub") ||
      text.includes("overflow") ||
      text.includes("transferfrom") ||
      text.includes("transaction execution has failed")
    );
  }

  canSplit(chunkRaw: bigint, plannedChunks: number): boolean {
    if (chunkRaw <= this.minChunkRaw * BigInt(2)) return false;
    return plannedChunks < AUTO_SPLIT_MAX_CHUNKS + this.maxExtraChunks;
  }

  split(chunkRaw: bigint): [bigint, bigint] {
    const left = chunkRaw / BigInt(2);
    const right = chunkRaw - left;
    return [left, right];
  }

  private errorText(error: unknown): string {
    if (!error) return "";
    if (error instanceof Error) {
      const anyErr = error as Error & { cause?: unknown };
      return `${error.message} ${this.errorText(anyErr.cause)}`.trim();
    }
    if (typeof error === "string") return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}

function tokenMeta(addr: string, symbolMap: Record<string, string>, tokens: TokenInfo[]): TokenMeta {
  const key = normalizeAddressKey(addr);
  const known = KNOWN_TOKENS[key];
  if (known) return known;
  const token = tokens.find((t) => normalizeAddressKey(t.address) === key);
  const rawDecimals = (token as TokenInfo & { decimals?: number | string })?.decimals;
  const decimals =
    typeof rawDecimals === "number"
      ? rawDecimals
      : typeof rawDecimals === "string"
        ? Number(rawDecimals)
        : 18;
  return {
    symbol: symbolMap[key] ?? shortAddress(addr),
    decimals: Number.isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : 18,
  };
}

function tokenLabel(
  addr: string,
  symbolMap: Record<string, string>,
  tokens: TokenInfo[],
  routerAddress?: string | null,
): string {
  if (!addr) return "";
  if (routerAddress && sameAddress(addr, routerAddress)) {
    return `Ekubo Router (${shortAddress(addr)})`;
  }
  const meta = tokenMeta(addr, symbolMap, tokens);
  if (meta.symbol) return `${meta.symbol} (${shortAddress(addr)})`;
  return shortAddress(addr);
}

function annotateAddressInError(
  message: string,
  symbolMap: Record<string, string>,
  tokens: TokenInfo[],
  routerAddress?: string | null,
): string {
  if (!message) return message;
  return message.replace(/0x[0-9a-fA-F]{40,66}/g, (addr) => tokenLabel(addr, symbolMap, tokens, routerAddress));
}

function extractErrorMessage(error: unknown, fallback = "Swap failed"): string {
  if (error instanceof Error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    const nestedData = (anyErr.data as Record<string, unknown> | undefined) ?? {};
    const nestedCause =
      anyErr.cause && typeof anyErr.cause === "object"
        ? (anyErr.cause as Record<string, unknown>)
        : {};
    const candidates = [
      anyErr.message,
      anyErr.shortMessage,
      anyErr.reason,
      anyErr.details,
      nestedData.message,
      nestedData.reason,
      nestedCause.message,
      nestedCause.reason,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // noop
    }
  }
  return fallback;
}

export function EkuboSwapPanel({
  tokenIn,
  tokenOut,
  onTokenChange,
  capabilities,
  pairMarketHint,
  gateConfig,
  onEvent,
}: EkuboSwapPanelProps) {
  const { account, address, isConnected } = useAccount();
  const { provider } = useProvider();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(9500);
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null);
  const [quoteFetchedAt, setQuoteFetchedAt] = useState<number | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [buildLoading, setBuildLoading] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [allowCustomTokens, setAllowCustomTokens] = useState(true);
  const [autoSplitEnabled, setAutoSplitEnabled] = useState(true);
  const [executionVenue, setExecutionVenue] = useState<"best" | DexVenue>("best");
  const [fallbackQuote, setFallbackQuote] = useState<DexQuoteResponse | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDexTokens(500)
      .then((payload) => {
        if (!cancelled) setTokens(payload.tokens ?? []);
      })
      .catch(() => {
        if (!cancelled) setTokens([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const symbolMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const token of tokens) {
      if (!token.address) continue;
      const key = normalizeAddressKey(token.address);
      out[key] = token.symbol ?? token.name ?? shortAddress(token.address);
    }
    return out;
  }, [tokens]);

  const tokenInMeta = useMemo(() => tokenMeta(tokenIn, symbolMap, tokens), [symbolMap, tokenIn, tokens]);
  const tokenOutMeta = useMemo(() => tokenMeta(tokenOut, symbolMap, tokens), [symbolMap, tokenOut, tokens]);
  const amountInWei = useMemo(() => parseAmountToRaw(amountIn, tokenInMeta.decimals), [amountIn, tokenInMeta.decimals]);
  const canonicalTokenOptions = useMemo(
    () =>
      CANONICAL_SWAP_TOKENS.map((addressValue) => ({
        address: addressValue,
        label: tokenMeta(addressValue, symbolMap, tokens).symbol,
      })),
    [symbolMap, tokens],
  );
  const isCanonicalToken = useCallback(
    (value: string) => CANONICAL_SWAP_TOKENS.some((candidate) => sameAddress(candidate, value)),
    [],
  );

  const canQuote =
    tokenIn.length > 0 &&
    tokenOut.length > 0 &&
    !!amountInWei &&
    (() => {
      try {
        return BigInt(amountInWei) > 0;
      } catch {
        return false;
      }
    })();
  const quoteIsStale = quoteFetchedAt !== null ? clock - quoteFetchedAt > QUOTE_STALE_MS : true;

  const evaluateQuoteGuards = useCallback(
    (activeQuote: SwapQuoteResponse | null, amountRaw: string): string[] => {
      if (!activeQuote) return [];
      const issues: string[] = [];

      if (pairMarketHint && Number.isFinite(pairMarketHint.tvl_usd) && pairMarketHint.tvl_usd < MIN_PAIR_TVL_USD) {
        issues.push(
          `Low liquidity warning: pair TVL is ${formatUsd(pairMarketHint.tvl_usd)} (target >= ${formatUsd(MIN_PAIR_TVL_USD)}).`,
        );
      }

      const amountInUnits = amountToFloat(amountRaw, tokenInMeta.decimals);
      const expectedOutUnits = amountToFloat(activeQuote.expected_out, tokenOutMeta.decimals);

      if (isUsdStableToken(tokenOut)) {
        if (expectedOutUnits < MIN_USDC_OUT) {
          issues.push(
            `Low output warning: expected receive is about ${formatUsd(expectedOutUnits, 6)} ${tokenOutMeta.symbol} (target >= ${formatUsd(MIN_USDC_OUT, 6)}).`,
          );
        }
        if (amountInUnits > 0) {
          const impliedUsdcPerInput = expectedOutUnits / amountInUnits;
          if (sameAddress(tokenIn, SEPOLIA_ETH)) {
            if (impliedUsdcPerInput < MIN_ETH_USDC_RATE) {
              issues.push(
                `Rate warning: implied price is ${formatUsd(impliedUsdcPerInput, 4)} per ETH (floor ${formatUsd(MIN_ETH_USDC_RATE, 4)}).`,
              );
            }
            if (impliedUsdcPerInput > MAX_ETH_USDC_RATE) {
              issues.push(
                `Rate warning: implied price is ${formatUsd(impliedUsdcPerInput, 4)} per ETH (ceiling ${formatUsd(MAX_ETH_USDC_RATE, 4)}).`,
              );
            }
          }
          if (sameAddress(tokenIn, SEPOLIA_STRK)) {
            if (impliedUsdcPerInput < MIN_STRK_USDC_RATE) {
              issues.push(
                `Rate warning: implied price is ${formatUsd(impliedUsdcPerInput, 6)} per STRK (floor ${formatUsd(MIN_STRK_USDC_RATE, 6)}).`,
              );
            }
            if (impliedUsdcPerInput > MAX_STRK_USDC_RATE) {
              issues.push(
                `Rate warning: implied price is ${formatUsd(impliedUsdcPerInput, 6)} per STRK (ceiling ${formatUsd(MAX_STRK_USDC_RATE, 6)}).`,
              );
            }
          }
        }
      }

      if (isUsdStableToken(tokenIn) && amountInUnits > 0 && expectedOutUnits > 0) {
        if (sameAddress(tokenOut, SEPOLIA_ETH)) {
          const impliedUsdcPerEth = amountInUnits / expectedOutUnits;
          if (impliedUsdcPerEth < MIN_ETH_USDC_RATE || impliedUsdcPerEth > MAX_ETH_USDC_RATE) {
            issues.push(
              `Rate warning: implied price is ${formatUsd(impliedUsdcPerEth, 4)} per ETH (expected range ${formatUsd(MIN_ETH_USDC_RATE, 4)}-${formatUsd(MAX_ETH_USDC_RATE, 4)}).`,
            );
          }
        }
        if (sameAddress(tokenOut, SEPOLIA_STRK)) {
          const impliedUsdcPerStrk = amountInUnits / expectedOutUnits;
          if (impliedUsdcPerStrk < MIN_STRK_USDC_RATE || impliedUsdcPerStrk > MAX_STRK_USDC_RATE) {
            issues.push(
              `Rate warning: implied price is ${formatUsd(impliedUsdcPerStrk, 6)} per STRK (expected range ${formatUsd(MIN_STRK_USDC_RATE, 6)}-${formatUsd(MAX_STRK_USDC_RATE, 6)}).`,
            );
          }
        }
      }

      return issues;
    },
    [pairMarketHint, tokenIn, tokenInMeta.decimals, tokenOut, tokenOutMeta.decimals, tokenOutMeta.symbol],
  );
  const quoteGuardIssues = useMemo(
    () => (quote && amountInWei ? evaluateQuoteGuards(quote, amountInWei) : []),
    [amountInWei, evaluateQuoteGuards, quote],
  );
  const quoteWarnings = useMemo(() => {
    const merged = [...(quote?.warnings ?? []), ...quoteGuardIssues].filter((item) => !!item?.trim());
    return Array.from(new Set(merged));
  }, [quote?.warnings, quoteGuardIssues]);

  const amountInUnits = useMemo(() => (amountInWei ? amountToFloat(amountInWei, tokenInMeta.decimals) : 0), [amountInWei, tokenInMeta.decimals]);
  const expectedOutUnits = useMemo(
    () => (quote ? amountToFloat(quote.expected_out, tokenOutMeta.decimals) : 0),
    [quote, tokenOutMeta.decimals],
  );
  const expectedOutUsd = useMemo(() => {
    if (!quote) return null;
    if (isUsdStableToken(tokenOut)) return expectedOutUnits;
    if (isUsdStableToken(tokenIn)) return amountInUnits;
    return null;
  }, [amountInUnits, expectedOutUnits, quote, tokenIn, tokenOut]);
  const estimatedImpactBps = useMemo(() => {
    if (!quote) return null;
    const baseImpact = Number(quote.price_impact_bps || 0);
    const marketSpread = Math.abs(Number(pairMarketHint?.spread_bps || 0));
    return Math.max(baseImpact, marketSpread);
  }, [pairMarketHint?.spread_bps, quote]);

  const safeUsdBudget = useMemo(() => {
    const volume = Number(pairMarketHint?.volume_24h_usd ?? 0);
    if (!Number.isFinite(volume) || volume <= 0) return SAFE_USD_MIN;
    return clamp(volume * SAFE_VOL_SHARE, SAFE_USD_MIN, SAFE_USD_CAP);
  }, [pairMarketHint?.volume_24h_usd]);

  const recommendedMaxInputRaw = useMemo(() => {
    if (!quote || !amountInWei) return null;
    if (amountInUnits <= 0) return null;

    let recommendedInputUnits = amountInUnits;
    if (isUsdStableToken(tokenIn)) {
      // For USDC input, safe budget is already in input units (USD). Never increase user size.
      recommendedInputUnits = Math.min(amountInUnits, safeUsdBudget);
    } else if (expectedOutUsd !== null && expectedOutUsd > 0) {
      // Scale down when current quote output in USD exceeds our safe budget.
      const scaleDown = safeUsdBudget / expectedOutUsd;
      if (Number.isFinite(scaleDown) && scaleDown > 0 && scaleDown < 1) {
        recommendedInputUnits = amountInUnits * scaleDown;
      }
    }

    if (!Number.isFinite(recommendedInputUnits) || recommendedInputUnits <= 0) return null;
    const capped = clamp(Math.min(recommendedInputUnits, amountInUnits), 0.000001, Number.MAX_SAFE_INTEGER / 1000);
    return parseAmountToRaw(capped.toFixed(Math.min(6, tokenInMeta.decimals)), tokenInMeta.decimals);
  }, [amountInUnits, amountInWei, expectedOutUsd, quote, safeUsdBudget, tokenIn, tokenInMeta.decimals]);

  const isDustRoute = useMemo(() => {
    return expectedOutUsd !== null && expectedOutUsd > 0 && expectedOutUsd < DUST_ROUTE_MIN_USD;
  }, [expectedOutUsd]);

  const routeQualityScore = useMemo(() => {
    let score = 100;
    if (quoteWarnings.length > 0) score -= Math.min(40, quoteWarnings.length * 10);
    if (pairMarketHint && Number.isFinite(pairMarketHint.tvl_usd) && pairMarketHint.tvl_usd < MIN_PAIR_TVL_USD) {
      score -= 20;
    }
    if (pairMarketHint && pairMarketHint.best_venue.toLowerCase() !== "ekubo") score -= 15;
    if (estimatedImpactBps !== null) {
      score -= clamp(Math.floor(estimatedImpactBps / 10), 0, 25);
    }
    if (isDustRoute) score = Math.min(score, 5);
    return clamp(Math.floor(score), 0, 100);
  }, [estimatedImpactBps, isDustRoute, pairMarketHint, quoteWarnings.length]);

  const splitPlan = useMemo(() => {
    if (!amountInWei) return [];
    let total: bigint;
    try {
      total = BigInt(amountInWei);
    } catch {
      return [];
    }
    if (total <= BigInt(0)) return [];
    if (!autoSplitEnabled || !isConnected || !account || !recommendedMaxInputRaw) {
      return [total];
    }
    let maxChunk: bigint;
    try {
      maxChunk = BigInt(recommendedMaxInputRaw);
    } catch {
      return [total];
    }
    if (maxChunk <= BigInt(0) || total <= maxChunk) return [total];
    return splitAmountRaw(total, maxChunk, AUTO_SPLIT_MAX_CHUNKS);
  }, [account, amountInWei, autoSplitEnabled, isConnected, recommendedMaxInputRaw]);

  const fallbackPreferredByMarket = useMemo(
    () => Boolean(pairMarketHint && pairMarketHint.best_venue.toLowerCase() !== "ekubo"),
    [pairMarketHint],
  );

  useEffect(() => {
    let cancelled = false;
    const shouldProbeFallback = Boolean(quote && amountInWei && (routeQualityScore < ROUTE_QUALITY_FLOOR || fallbackPreferredByMarket));
    if (!shouldProbeFallback) {
      setFallbackQuote(null);
      setFallbackLoading(false);
      return;
    }

    setFallbackLoading(true);
    quoteDexSwap({
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: amountInWei as string,
    })
      .then((data) => {
        if (!cancelled) setFallbackQuote(data);
      })
      .catch(() => {
        if (!cancelled) setFallbackQuote(null);
      })
      .finally(() => {
        if (!cancelled) setFallbackLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [amountInWei, fallbackPreferredByMarket, quote, routeQualityScore, tokenIn, tokenOut]);

  const fallbackAdvantageBps = useMemo(() => {
    if (!quote || !fallbackQuote) return null;
    try {
      const ekuboOut = BigInt(quote.expected_out || "0");
      const fallbackOut = BigInt(fallbackQuote.amount_out || "0");
      if (ekuboOut <= BigInt(0) || fallbackOut <= BigInt(0)) return null;
      return Number(((fallbackOut - ekuboOut) * BigInt(10_000)) / ekuboOut);
    } catch {
      return null;
    }
  }, [fallbackQuote, quote]);

  const shouldSuggestFallback = useMemo(() => {
    if (fallbackPreferredByMarket) return true;
    return typeof fallbackAdvantageBps === "number" && fallbackAdvantageBps >= 500;
  }, [fallbackAdvantageBps, fallbackPreferredByMarket]);

  const routeQualityLabel = useMemo(() => {
    if (routeQualityScore >= 75) return "Strong";
    if (routeQualityScore >= 45) return "Moderate";
    return "Fragile";
  }, [routeQualityScore]);

  const routeQualityClass = useMemo(() => {
    if (routeQualityScore >= 75) return "text-emerald-300 border-emerald-700/50 bg-emerald-500/10";
    if (routeQualityScore >= 45) return "text-amber-300 border-amber-700/50 bg-amber-500/10";
    return "text-rose-300 border-rose-700/50 bg-rose-500/10";
  }, [routeQualityScore]);

  const fallbackOutUnits = useMemo(
    () => (fallbackQuote ? amountToFloat(fallbackQuote.amount_out, tokenOutMeta.decimals) : 0),
    [fallbackQuote, tokenOutMeta.decimals],
  );

  const fallbackOutUsd = useMemo(() => {
    if (!fallbackQuote) return null;
    if (isUsdStableToken(tokenOut)) return fallbackOutUnits;
    if (isUsdStableToken(tokenIn)) return amountInUnits;
    return null;
  }, [amountInUnits, fallbackOutUnits, fallbackQuote, tokenIn, tokenOut]);

  const openDexRouteFinder = useCallback(() => {
    const params = new URLSearchParams();
    params.set("tab", "dex");
    params.set("token_in", tokenIn);
    params.set("token_out", tokenOut);
    if (amountInWei) params.set("amount_in", amountInWei);
    window.location.href = `/agent?${params.toString()}`;
  }, [amountInWei, tokenIn, tokenOut]);

  const reportSwapBlocked = useCallback(
    (message: string) => {
      onEvent({
        type: "trade",
        text: "Swap not submitted",
        details: message,
        status: "failed",
      });
      toastError(message);
    },
    [onEvent],
  );

  const fetchTokenBalanceOnce = useCallback(
    async (ownerAddress: string, tokenAddress: string): Promise<bigint | null> => {
      const contractAddress = ensureHex(tokenAddress);
      const owner = ensureHex(ownerAddress);
      for (const entrypoint of ["balanceOf", "balance_of"]) {
        try {
          const result = await provider.callContract({
            contractAddress,
            entrypoint,
            calldata: [owner],
          });
          return parseU256Result(result as Array<string | bigint>);
        } catch {
          // Try the next selector variant.
        }
      }
      return null;
    },
    [provider],
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchTokenBalance() {
      if (!tokenIn || !address) {
        if (!cancelled) setBalanceRaw(null);
        return;
      }
      setBalanceLoading(true);
      try {
        const balance = await fetchTokenBalanceOnce(address, tokenIn);
        if (!cancelled) setBalanceRaw(balance);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    }
    void fetchTokenBalance();
    return () => {
      cancelled = true;
    };
  }, [address, fetchTokenBalanceOnce, tokenIn]);

  const fetchQuote = useCallback(async () => {
    if (!canQuote) {
      setQuote(null);
      setQuoteFetchedAt(null);
      return;
    }
    if (!allowCustomTokens && (!isCanonicalToken(tokenIn) || !isCanonicalToken(tokenOut))) {
      setQuote(null);
      setQuoteFetchedAt(null);
      setQuoteError("Canonical token mode is enabled. Use STRK/ETH/USDC or turn on custom token mode.");
      return;
    }
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const amount = amountInWei ?? "0";
      const nextQuote = await quoteSwap({
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amount,
        slippage_bps: slippageBps,
        taker_address: address,
      });
      setQuote(nextQuote);
      setQuoteFetchedAt(Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quote unavailable";
      setQuoteError(message);
      setQuote(null);
      setQuoteFetchedAt(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [address, allowCustomTokens, amountInWei, canQuote, isCanonicalToken, slippageBps, tokenIn, tokenOut]);

  useEffect(() => {
    if (!canQuote) {
      setQuote(null);
      setQuoteFetchedAt(null);
      setQuoteError(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchQuote();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [canQuote, fetchQuote]);

  const executeSwap = async () => {
    if (!canQuote) {
      reportSwapBlocked("Set pair and amount before executing.");
      return;
    }
    if (!allowCustomTokens && (!isCanonicalToken(tokenIn) || !isCanonicalToken(tokenOut))) {
      reportSwapBlocked("Canonical token mode is enabled. Use STRK/ETH/USDC or turn on custom token mode.");
      return;
    }

    let activeQuote = quote;
    const ekuboQuoteRequired = executionVenue === "ekubo";
    if (ekuboQuoteRequired && (!activeQuote || quoteIsStale)) {
      try {
        const amount = amountInWei ?? "0";
        activeQuote = await quoteSwap({
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amount,
          slippage_bps: slippageBps,
          taker_address: address,
        });
        setQuote(activeQuote);
        setQuoteFetchedAt(Date.now());
        setQuoteError(null);
        if (quoteIsStale) {
          onEvent({
            type: "trade",
            text: "Quote auto-refreshed",
            details: "Previous quote was stale; fetched a fresh route before execution.",
            status: "pending",
          });
        }
      } catch (error) {
        const msg = extractErrorMessage(error, "Quote unavailable");
        reportSwapBlocked(`Unable to fetch quote: ${msg}`);
        return;
      }
    }

    setBuildLoading(true);
    let attemptedVenue: DexVenue | "orchestrated" = "ekubo";
    let verifiedBalanceRaw: bigint | null = balanceRaw;
    try {
      const amountWei = amountInWei ?? "0";
      if (BigInt(amountWei) <= 0) {
        reportSwapBlocked("Enter a valid amount.");
        return;
      }
      if (verifiedBalanceRaw === null && address && tokenIn) {
        verifiedBalanceRaw = await fetchTokenBalanceOnce(address, tokenIn);
        setBalanceRaw(verifiedBalanceRaw);
      }
      if (verifiedBalanceRaw !== null && BigInt(amountWei) > verifiedBalanceRaw) {
        reportSwapBlocked(
          `Insufficient ${tokenInMeta.symbol}. Need ${formatAmount(amountWei, tokenInMeta.decimals)}, have ${formatAmount(verifiedBalanceRaw, tokenInMeta.decimals)}.`,
        );
        return;
      }
      if (verifiedBalanceRaw === null) {
        onEvent({
          type: "trade",
          text: "Balance check unavailable",
          details: `Could not verify ${tokenInMeta.symbol} balance pre-submit. Wallet execution may fail if balance is too low.`,
          status: "pending",
        });
      }
      const gateAmount = Math.max(1, Number(amountWei.slice(0, 9) || "1"));
      const executionPolicy = resolveExecutionPolicy({
        intent: "manual_wallet",
        walletConnected: Boolean(isConnected && account),
      });
      const baseFeatures =
        gateConfig.gateMode === "stress"
          ? [120, 95, 80, 85, 20, 10, 90, 80]
          : [50, 30, 20, 20, 60, 30, 10, 20];
      if (activeQuote) {
        baseFeatures[1] = Math.max(baseFeatures[1], Math.floor(activeQuote.price_impact_bps / 100));
      }
      if (typeof gateConfig.passportScore === "number") {
        baseFeatures[2] = Math.max(0, 100 - Math.floor(gateConfig.passportScore));
      }
      baseFeatures[0] = Math.min(200, baseFeatures[0] + Math.floor(gateAmount / 100_000));
      if (executionPolicy.enforceGate) {
        const gate = await runActionGate({
          userAddress: address || "unknown",
          amount: gateAmount,
          reason: `Ekubo swap ${tokenIn.slice(0, 8)} -> ${tokenOut.slice(0, 8)} | mode=${gateConfig.gateMode}`,
          poolId: `ekubo_swap_${tokenIn.slice(2, 8)}_${tokenOut.slice(2, 8)}`,
          portfolioFeatures: baseFeatures,
          fromProtocol: 0,
          toProtocol: 1,
          sessionId: gateConfig.sessionId,
        });

        if (!gate.ok) {
          const message = formatGateDenied(gate.reason);
          onEvent({
            type: "trade",
            text: "Gate denied",
            details: message,
            status: "failed",
          });
          reportSwapBlocked(message);
          return;
        }
        onEvent({
          type: "trade",
          text: "AI suggested",
          details: `Proposal ${gate.proposalId ?? "n/a"}${gate.snapshotHash ? ` • snapshot ${gate.snapshotHash.slice(0, 10)}...` : ""}`,
          status: "pending",
        });
      }

      const amount = amountWei;
      let resolvedVenue: DexVenue = "ekubo";
      let avnuQuoteId = "";
      let avnuRouteSummary = "";
      if (executionVenue === "best") {
        // Always prefer AVNU for "best" mode — AVNU routes through Ekubo pools
        // internally but handles calldata reliably (avoids u256_sub Overflow).
        try {
          const avnuQuote = await quoteAvnuSwap({
            token_in: tokenIn,
            token_out: tokenOut,
            amount_in: amount,
            slippage_bps: slippageBps,
            taker_address: address,
          });
          resolvedVenue = "avnu";
          avnuQuoteId = avnuQuote.quote_id;
          avnuRouteSummary = (avnuQuote.route ?? []).join(" -> ");
        } catch {
          // AVNU quote unavailable — fall back to Ekubo direct as last resort.
          resolvedVenue = "ekubo";
        }
      } else if (executionVenue === "avnu") {
        const avnuQuote = await quoteAvnuSwap({
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: amount,
          slippage_bps: slippageBps,
          taker_address: address,
        });
        resolvedVenue = "avnu";
        avnuQuoteId = avnuQuote.quote_id;
        avnuRouteSummary = (avnuQuote.route ?? []).join(" -> ");
      }
      attemptedVenue = resolvedVenue;

      if (resolvedVenue === "avnu") {
        if (!account || !isConnected || !address) {
          reportSwapBlocked("AVNU execution requires a connected wallet.");
          return;
        }
        if (executionPolicy.enforceGate) {
          try {
            const preflight = await executionPreflight({
              token_in: tokenIn,
              token_out: tokenOut,
              amount_in: amount,
              slippage_bps: slippageBps,
              venue_pref: "avnu",
              user_address: address,
            });
            if (!preflight.can_submit) {
              reportSwapBlocked(preflight.blocking_reasons.join(" ") || "Preflight blocked this AVNU route.");
              return;
            }
          } catch {
            // Keep manual path alive when preflight is unavailable.
          }
        } else {
          void executionPreflight({
            token_in: tokenIn,
            token_out: tokenOut,
            amount_in: amount,
            slippage_bps: slippageBps,
            venue_pref: "avnu",
            user_address: address,
          }).catch(() => {
            // Manual wallet flow: advisory only.
          });
        }

        // AVNU: always single transaction, no chunking.
        // AVNU handles routing/splitting internally — never split on our side.
        // Fresh quote right before build to minimize stale-price risk.
        const effectiveSlippageBps = Math.max(slippageBps, 9500); // floor 95% for Sepolia thin liquidity (pools have phantom quotes)

        let freshQuoteId = avnuQuoteId;
        let freshRouteSummary = avnuRouteSummary;
        try {
          const freshQuote = await quoteAvnuSwap({
            token_in: tokenIn,
            token_out: tokenOut,
            amount_in: amount,
            slippage_bps: effectiveSlippageBps,
            taker_address: address,
          });
          if (freshQuote.quote_id) freshQuoteId = freshQuote.quote_id;
          if (Array.isArray(freshQuote.route) && freshQuote.route.length > 0) {
            freshRouteSummary = freshQuote.route.join(" -> ");
          }
        } catch {
          if (!freshQuoteId) {
            reportSwapBlocked("AVNU quote unavailable. Please retry.");
            return;
          }
        }

        if (!freshQuoteId) {
          reportSwapBlocked("AVNU quote id is missing. Refresh and retry.");
          return;
        }

        const avnuBuild = await buildAvnuSwapTx({
          quote_id: freshQuoteId,
          taker_address: address,
          slippage_bps: effectiveSlippageBps,
          include_approve: true,
        });
        const walletCalls = (avnuBuild.calls ?? []).map((call) => ({
          contractAddress: ensureHex(call.contract_address),
          entrypoint: call.entrypoint,
          calldata: (call.calldata ?? []).map((entry) => String(entry)),
        }));
        if (!walletCalls.length) {
          reportSwapBlocked("AVNU returned empty calldata. Retry with a refreshed quote.");
          return;
        }

        onEvent({
          type: "trade",
          text: `Swap submitted ${tokenInMeta.symbol} -> ${tokenOutMeta.symbol}`,
          details: `Venue: AVNU • slippage ${(effectiveSlippageBps / 100).toFixed(1)}%${freshRouteSummary ? ` • route ${freshRouteSummary}` : ""}`,
          status: "pending",
        });

        const result = await executeCalls({
          account,
          gasMode: "wallet",
          calls: walletCalls as Parameters<typeof account.execute>[0],
        });

        onEvent({
          type: "trade",
          text: `Swap confirmed ${tokenInMeta.symbol} -> ${tokenOutMeta.symbol}`,
          details: `Execution mode: wallet${result.executionPath === "paymaster" ? " (paymaster)" : ""}${result.fallbackUsed ? " • fallback wallet gas" : ""}`,
          txHash: result.transaction_hash,
          status: "confirmed",
        });

        if (executionPolicy.advisoryAfterSubmit) {
          void advisoryActionCheck({
            user_address: address,
            action_type: "swap",
            pool_id: `avnu_swap_${tokenIn.slice(2, 8)}_${tokenOut.slice(2, 8)}`,
            portfolio_features: baseFeatures,
            context: {
              token_in: tokenIn,
              token_out: tokenOut,
              amount,
              venue: "avnu",
              from_protocol: 0,
              to_protocol: 1,
            },
          }).catch(() => {
            // Advisory checks are non-blocking by design.
          });
        }

        toastSuccess("Swap submitted", {
          action: {
            label: "View",
            onClick: () => window.open(sepoliaVoyagerTxUrl(result.transaction_hash), "_blank"),
          },
        });
        return;
      }

      const firstBuild = await buildSwapTx({
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amount,
        slippage_bps: slippageBps,
        taker_address: address,
        user_address: address,
        execution_mode: "wallet",
        wallet_connected: Boolean(isConnected && account),
      });
      if (firstBuild.execution_mode === "wallet") {
        if (!account || !address) {
          reportSwapBlocked("Wallet mode selected but no wallet is connected.");
          return;
        }

        if (executionPolicy.enforceGate) {
          try {
            const preflight = await executionPreflight({
              token_in: tokenIn,
              token_out: tokenOut,
              amount_in: amount,
              slippage_bps: slippageBps,
              venue_pref: resolvedVenue,
              user_address: address,
            });
            if (!preflight.can_submit) {
              reportSwapBlocked(preflight.blocking_reasons.join(" ") || "Preflight blocked this route.");
              return;
            }
          } catch {
            // Keep manual path alive when preflight is unavailable.
          }
        } else {
          void executionPreflight({
            token_in: tokenIn,
            token_out: tokenOut,
            amount_in: amount,
            slippage_bps: slippageBps,
            venue_pref: resolvedVenue,
            user_address: address,
          }).catch(() => {
            // Manual wallet flow: advisory only.
          });
        }

        const routeSummary =
          (activeQuote?.route?.length ?? 0) > 0
            ? (activeQuote?.route ?? [])
                .map((hop) => tokenLabel(hop, symbolMap, tokens, capabilities?.router_address ?? null))
                .join(" -> ")
            : `${tokenInMeta.symbol} -> ${tokenOutMeta.symbol}`;

        const chunkPlan = splitPlan.length > 0 ? splitPlan : [BigInt(amountWei)];
        const adaptiveRecoveryPolicy = AdaptiveSwapRecoveryPolicy.from(tokenInMeta.decimals);
        const pendingChunks = [...chunkPlan];
        let plannedChunks = pendingChunks.length;
        let completedChunks = 0;

        let lastTxHash: string | undefined;
        while (pendingChunks.length > 0) {
          const chunkRaw = pendingChunks.shift() as bigint;
          const chunkAmount = chunkRaw.toString();
          const chunkBuild =
            completedChunks === 0 && chunkPlan.length === 1 && chunkAmount === amount
              ? firstBuild
              : await buildSwapTx({
                  token_in: tokenIn,
                  token_out: tokenOut,
                  amount_in: chunkAmount,
                  slippage_bps: slippageBps,
                  taker_address: address,
                  user_address: address,
                  execution_mode: "wallet",
                  wallet_connected: Boolean(isConnected && account),
                });

          if (chunkBuild.execution_mode !== "wallet") {
            reportSwapBlocked("Chunked swap fell back to orchestration unexpectedly. Retry with smaller amount.");
            return;
          }
          // Keep build warnings in the quote/debug surface instead of spamming history.

          if (!chunkBuild.calls.length) {
            reportSwapBlocked("Swap calldata is missing. Please refresh quote and try again.");
            return;
          }
          if (!chunkBuild.calls.some((call) => (call.calldata ?? []).length > 0)) {
            reportSwapBlocked("Swap calldata is empty. Please refresh quote and try again.");
            return;
          }

          const revokeCalls = (chunkBuild.approvals ?? []).map((approval) => ({
            contractAddress: ensureHex(approval.token),
            entrypoint: "approve",
            calldata: [ensureHex(approval.spender), "0", "0"],
          }));

          const approvalBufferBps = Math.min(200, Math.max(25, slippageBps + 25));

          const walletCalls: Array<{
            contractAddress: `0x${string}`;
            entrypoint: string;
            calldata: Array<string | `0x${string}`>;
          }> = [
            ...(chunkBuild.approvals ?? []).map((approval) => {
              const approvalAmount = BigInt(approval.amount || "0");
              const bufferedApproval =
                approvalAmount +
                ((approvalAmount * BigInt(approvalBufferBps) + BigInt(9_999)) / BigInt(10_000));
              const [approvalLow, approvalHigh] = toU256(bufferedApproval);
              return {
                contractAddress: ensureHex(approval.token),
                entrypoint: "approve",
                calldata: [ensureHex(approval.spender), approvalLow, approvalHigh],
              };
            }),
            ...(chunkBuild.calls ?? []).map((call) => ({
              contractAddress: ensureHex(call.contract_address),
              entrypoint: call.entrypoint,
              calldata: (call.calldata ?? []).map((entry) => String(entry)),
            })),
            ...revokeCalls,
          ];
          if (!walletCalls.length) {
            reportSwapBlocked("No executable wallet calls were built. Refresh quote and try again.");
            return;
          }

          onEvent({
            type: "trade",
            text:
              plannedChunks > 1
                ? `Swap chunk ${completedChunks + 1}/${plannedChunks} submitted ${tokenInMeta.symbol} -> ${tokenOutMeta.symbol}`
                : `Swap submitted ${tokenInMeta.symbol} -> ${tokenOutMeta.symbol}`,
            details:
              plannedChunks > 1
                ? `Chunk amount: ${formatAmount(chunkAmount, tokenInMeta.decimals)} ${tokenInMeta.symbol} • route ${routeSummary}`
                : `Amount in: ${formatAmount(amount, tokenInMeta.decimals)} ${tokenInMeta.symbol} • route ${routeSummary}`,
            status: "pending",
          });

          try {
            const result = await executeCalls({
              account,
              gasMode: "wallet",
              calls: walletCalls as Parameters<typeof account.execute>[0],
            });
            lastTxHash = result.transaction_hash;
            completedChunks += 1;

            onEvent({
              type: "trade",
              text:
                plannedChunks > 1
                  ? `Swap chunk ${completedChunks}/${plannedChunks} confirmed`
                  : `Swap confirmed ${tokenInMeta.symbol} -> ${tokenOutMeta.symbol}`,
              details: `Execution mode: wallet${result.executionPath === "paymaster" ? " (paymaster)" : ""}${result.fallbackUsed ? " • fallback wallet gas" : ""}`,
              txHash: result.transaction_hash,
              status: "confirmed",
            });
          } catch (err) {
            const shouldSplit = adaptiveRecoveryPolicy.shouldSplit(err);
            const canSplitFurther = adaptiveRecoveryPolicy.canSplit(chunkRaw, plannedChunks);
            if (shouldSplit && canSplitFurther) {
              const [left, right] = adaptiveRecoveryPolicy.split(chunkRaw);
              pendingChunks.unshift(right);
              pendingChunks.unshift(left);
              plannedChunks += 1;
              onEvent({
                type: "trade",
                text: `Adaptive split triggered for ${tokenInMeta.symbol}`,
                details: `Chunk overflow detected; retrying with two smaller chunks (${formatAmount(left, tokenInMeta.decimals)} + ${formatAmount(right, tokenInMeta.decimals)} ${tokenInMeta.symbol}).`,
                status: "pending",
              });
              continue;
            }
            throw err;
          }
        }

        if (executionPolicy.advisoryAfterSubmit && address) {
          void advisoryActionCheck({
            user_address: address,
            action_type: "swap",
            pool_id: `ekubo_swap_${tokenIn.slice(2, 8)}_${tokenOut.slice(2, 8)}`,
            portfolio_features: baseFeatures,
            context: {
              token_in: tokenIn,
              token_out: tokenOut,
              amount: amount,
              venue: "ekubo",
              from_protocol: 0,
              to_protocol: 1,
            },
          })
            .then((advisory) => {
              const advisoryDetails = advisory.can_proceed
                ? formatAdvisoryPass(advisory.reason)
                : formatAdvisoryElevatedRisk(advisory.reason);
              onEvent({
                type: "trade",
                text: advisory.can_proceed ? "AI suggested" : "AI suggested (elevated risk)",
                details: advisoryDetails,
                status: "pending",
              });
            })
            .catch(() => {
              // Advisory checks are non-blocking by design.
            });
        }

        toastSuccess(plannedChunks > 1 ? `Swap submitted in ${plannedChunks} chunks` : "Swap submitted", {
          action: {
            label: "View",
            onClick: () => {
              if (lastTxHash) window.open(sepoliaVoyagerTxUrl(lastTxHash), "_blank");
            },
          },
        });
      } else {
        attemptedVenue = "orchestrated";
        onEvent({
          type: "trade",
          text: `Swap orchestration queued ${shortAddress(tokenIn)} -> ${shortAddress(tokenOut)}`,
          details: firstBuild.receipt_id ? `Receipt: ${firstBuild.receipt_id}` : "Receipt pending",
          status: "pending",
        });
        toastSuccess(firstBuild.receipt_id ? `Orchestration receipt ${firstBuild.receipt_id}` : "Swap orchestration queued");
      }
    } catch (error) {
      const messageRaw = extractErrorMessage(error, "Swap failed");
      const message = annotateAddressInError(messageRaw, symbolMap, tokens, capabilities?.router_address ?? null);
      const debug = buildTxDebugInfo(messageRaw);
      const isOverflow = /u256_sub|overflow/i.test(message);
      const isInsufficientReceived = debug.decode.code === "insufficient_tokens_received";
      const slippagePct = (slippageBps / 100).toFixed(2);
      const quoteOutUsd = activeQuote && isUsdStableToken(tokenOut) ? amountToFloat(activeQuote.expected_out, 6) : null;
      const genericMessage = !message.trim() || /^swap failed$/i.test(message.trim());
      const decodedGuidance = `${debug.decode.likelyCause} ${debug.decode.suggestedAction}`.trim();
      const failDetails = isOverflow
        ? verifiedBalanceRaw !== null && amountInWei && BigInt(amountInWei) > verifiedBalanceRaw
          ? `Insufficient ${tokenInMeta.symbol} balance. Need ${formatAmount(amountInWei, tokenInMeta.decimals)}, have ${formatAmount(verifiedBalanceRaw, tokenInMeta.decimals)}.`
          : `Swap failed with token underflow. Liquidity could not satisfy this route/size${
              quoteOutUsd !== null ? ` (quote expected about ${formatUsd(quoteOutUsd, 6)} out)` : ""
            }. If input token is ${tokenInMeta.symbol}, verify wallet balance covers the full input amount and retry.${attemptedVenue === "ekubo" ? " AVNU fallback is recommended for this pair right now." : ""}`
        : isInsufficientReceived
          ? `Output dropped below minimum receive at execution time (slippage ${slippagePct}%). Try smaller size, refresh quote, or switch venue.${executionVenue === "best" ? " If this keeps happening, try Ekubo Only for stability." : ""}`
        : genericMessage
          ? decodedGuidance || "Swap failed during wallet execution."
          : message;
      const failText =
        debug.decode.code === "unknown" ? "Swap failed" : `Swap failed: ${debug.decode.summary}`;

      if (isOverflow && attemptedVenue === "ekubo") {
        setExecutionVenue("avnu");
      }

      onEvent({
        type: "trade",
        text: failText,
        details: genericMessage || isInsufficientReceived ? failDetails : message,
        status: "failed",
      });
      toastError(failDetails);
    } finally {
      setBuildLoading(false);
    }
  };

  /* ── Token selector modals ─── */
  const [selectorSide, setSelectorSide] = useState<"in" | "out" | null>(null);
  const [balanceOutRaw, setBalanceOutRaw] = useState<bigint | null>(null);

  /* Fetch output token balance for display */
  useEffect(() => {
    let cancelled = false;
    async function fetchOutBal() {
      if (!tokenOut || !address) { if (!cancelled) setBalanceOutRaw(null); return; }
      try {
        const bal = await fetchTokenBalanceOnce(address, tokenOut);
        if (!cancelled) setBalanceOutRaw(bal);
      } catch { if (!cancelled) setBalanceOutRaw(null); }
    }
    void fetchOutBal();
    return () => { cancelled = true; };
  }, [address, fetchTokenBalanceOnce, tokenOut]);

  /* Balances map for TokenSelectorModal */
  const balancesMap = useMemo(() => {
    const m: Record<string, bigint> = {};
    if (balanceRaw !== null) m[normalizeAddr(tokenIn)] = balanceRaw;
    if (balanceOutRaw !== null) m[normalizeAddr(tokenOut)] = balanceOutRaw;
    return m;
  }, [balanceRaw, balanceOutRaw, tokenIn, tokenOut]);

  /* Popular pair quick presets */
  const POPULAR_PAIRS = useMemo(() => [
    { label: "STRK → fUSDC", tokenA: SEPOLIA_STRK, tokenB: SEPOLIA_FUSDC },
    { label: "ETH → fUSDC", tokenA: SEPOLIA_ETH, tokenB: SEPOLIA_FUSDC },
    { label: "STRK → USDC", tokenA: SEPOLIA_STRK, tokenB: SEPOLIA_USDC },
    { label: "fUSDC → STRK", tokenA: SEPOLIA_FUSDC, tokenB: SEPOLIA_STRK },
    { label: "ETH → STRK", tokenA: SEPOLIA_ETH, tokenB: SEPOLIA_STRK },
  ], []);

  /* Slippage presets */
  const SLIPPAGE_PRESETS = [
    { label: "5%", value: 500 },
    { label: "10%", value: 1000 },
    { label: "Auto (95%)", value: 9500 },
    { label: "99%", value: 9900 },
  ];
  const [showSlippageCustom, setShowSlippageCustom] = useState(false);
  const isPresetSlippage = SLIPPAGE_PRESETS.some((p) => p.value === slippageBps);

  /* Implied exchange rate */
  const impliedRate = useMemo(() => {
    if (!quote || !amountInWei) return null;
    const inUnits = amountToFloat(amountInWei, tokenInMeta.decimals);
    const outUnits = amountToFloat(quote.expected_out, tokenOutMeta.decimals);
    if (inUnits <= 0) return null;
    return outUnits / inUnits;
  }, [quote, amountInWei, tokenInMeta.decimals, tokenOutMeta.decimals]);

  /* Price impact severity */
  const impactSeverity = useMemo(() => {
    if (!quote) return "none";
    const bps = quote.price_impact_bps;
    if (bps < 50) return "low";
    if (bps < 200) return "medium";
    return "high";
  }, [quote]);

  const impactColor = impactSeverity === "high" ? "text-rose-400" : impactSeverity === "medium" ? "text-amber-400" : "text-zinc-400";

  /* Button label */
  const buttonLabel = useMemo(() => {
    if (buildLoading) return "Swapping...";
    if (!isConnected) return "Connect Wallet";
    if (!amountIn.trim()) return "Enter Amount";
    if (balanceRaw !== null && amountInWei && BigInt(amountInWei) > balanceRaw) return "Insufficient Balance";
    if (quoteLoading) return "Fetching Route...";
    if (quoteError) return "Route Unavailable";
    return `Swap ${tokenInMeta.symbol} → ${tokenOutMeta.symbol}`;
  }, [buildLoading, isConnected, amountIn, balanceRaw, amountInWei, quoteLoading, quoteError, tokenInMeta.symbol, tokenOutMeta.symbol]);

  const buttonDisabled = buildLoading || quoteLoading || !amountIn.trim() ||
    (balanceRaw !== null && amountInWei !== null && BigInt(amountInWei) > balanceRaw);

  return (
    <div className="glass rounded-2xl border border-zinc-800 overflow-hidden">
      {/* ── Header ─── */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Swap</h2>
        <button
          type="button"
          onClick={() => setShowSlippageCustom((p) => !p)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors border border-transparent hover:border-zinc-700"
        >
          <Info className="w-3 h-3" />
          {(slippageBps / 100).toFixed(1)}% slip
        </button>
      </div>

      {/* ── Slippage panel (collapsible) ─── */}
      {showSlippageCustom && (
        <div className="px-5 pb-3">
          <div className="rounded-xl bg-zinc-800/40 border border-zinc-700/50 p-3">
            <p className="text-[11px] text-zinc-500 mb-2">Max price movement you&apos;re willing to accept</p>
            <div className="flex items-center gap-2">
              {SLIPPAGE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => { setSlippageBps(p.value); setShowSlippageCustom(false); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    slippageBps === p.value
                      ? "bg-emerald-600/20 border border-emerald-600/40 text-emerald-300"
                      : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <div className="flex-1">
                <input
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.1}
                  value={!isPresetSlippage ? (slippageBps / 100).toString() : ""}
                  placeholder="Custom %"
                  onChange={(e) => {
                    const pct = parseFloat(e.target.value);
                    if (!isNaN(pct)) setSlippageBps(Math.max(1, Math.min(10000, Math.round(pct * 100))));
                  }}
                  className="w-full px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <span className="text-xs text-zinc-500">%</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Popular pairs ─── */}
      <div className="px-5 pb-2">
        <div className="flex flex-wrap gap-1.5">
          {POPULAR_PAIRS.map((pair) => {
            const active = sameAddress(tokenIn, pair.tokenA) && sameAddress(tokenOut, pair.tokenB);
            return (
              <button
                key={pair.label}
                type="button"
                onClick={() => onTokenChange(pair.tokenA, pair.tokenB)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-emerald-600/20 border border-emerald-600/40 text-emerald-300"
                    : "bg-zinc-800/40 border border-zinc-700/40 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                }`}
              >
                {pair.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-2">
        {/* ═══ YOU PAY ═══ */}
        <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500">You Pay</span>
            <div className="flex items-center gap-1.5">
              {balanceRaw !== null && (
                <span className="text-[11px] text-zinc-500">
                  {formatAmount(balanceRaw, tokenInMeta.decimals)} {tokenInMeta.symbol}
                </span>
              )}
              {balanceRaw !== null && (
                <button
                  type="button"
                  onClick={() => setAmountIn(formatAmount(balanceRaw, tokenInMeta.decimals, tokenInMeta.decimals))}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors font-medium"
                >
                  MAX
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Token selector button */}
            <button
              type="button"
              onClick={() => setSelectorSide("in")}
              className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-700/50 border border-zinc-600/50 hover:bg-zinc-700 hover:border-zinc-500 transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center text-[10px] font-bold text-emerald-300">
                {tokenInMeta.symbol.charAt(0)}
              </div>
              <span className="text-sm font-medium text-zinc-100">{tokenInMeta.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {/* Amount input */}
            <input
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0"
              className="flex-1 text-right text-2xl font-medium bg-transparent text-white placeholder:text-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {/* ═══ FLIP BUTTON ═══ */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            type="button"
            onClick={() => onTokenChange(tokenOut, tokenIn)}
            className="p-2 rounded-xl bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 transition-colors shadow-lg"
          >
            <ArrowDownUp className="w-4 h-4 text-zinc-300" />
          </button>
        </div>

        {/* ═══ YOU RECEIVE ═══ */}
        <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500">You Receive</span>
            {balanceOutRaw !== null && (
              <span className="text-[11px] text-zinc-500">
                {formatAmount(balanceOutRaw, tokenOutMeta.decimals)} {tokenOutMeta.symbol}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Token selector button */}
            <button
              type="button"
              onClick={() => setSelectorSide("out")}
              className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-700/50 border border-zinc-600/50 hover:bg-zinc-700 hover:border-zinc-500 transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center text-[10px] font-bold text-cyan-300">
                {tokenOutMeta.symbol.charAt(0)}
              </div>
              <span className="text-sm font-medium text-zinc-100">{tokenOutMeta.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {/* Quote output */}
            <div className="flex-1 text-right">
              {quoteLoading ? (
                <div className="flex items-center justify-end gap-2">
                  <RefreshCw className="w-4 h-4 text-zinc-500 animate-spin" />
                  <span className="text-lg text-zinc-500">Fetching...</span>
                </div>
              ) : quote ? (
                <span className="text-2xl font-medium text-zinc-100">
                  {formatAmount(quote.expected_out, tokenOutMeta.decimals)}
                </span>
              ) : (
                <span className="text-2xl text-zinc-600">0.0</span>
              )}
            </div>
          </div>
        </div>

        {/* ═══ QUOTE DETAILS ═══ */}
        {quote && !quoteLoading && (
          <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/30 p-3 space-y-2">
            {/* Rate */}
            {impliedRate !== null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Rate</span>
                <span className="text-zinc-300">
                  1 {tokenInMeta.symbol} = {impliedRate < 0.001 ? impliedRate.toExponential(2) : impliedRate < 1 ? impliedRate.toFixed(6) : impliedRate.toFixed(4)} {tokenOutMeta.symbol}
                </span>
              </div>
            )}

            {/* Price Impact */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Price Impact</span>
              <span className={impactColor}>
                {(quote.price_impact_bps / 100).toFixed(2)}%
                {impactSeverity === "high" && " ⚠️"}
              </span>
            </div>

            {/* Minimum received */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Min. Received</span>
              <span className="text-zinc-300">
                {formatAmount(quote.min_out, tokenOutMeta.decimals)} {tokenOutMeta.symbol}
              </span>
            </div>

            {/* Slippage */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Slippage Tolerance</span>
              <span className="text-zinc-400">{(slippageBps / 100).toFixed(1)}%</span>
            </div>

            {/* Route */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Route</span>
              <span className="text-zinc-400 font-mono text-[11px]">
                {quote.route
                  .map((hop) => {
                    const meta = tokenMeta(hop, symbolMap, tokens);
                    return meta.symbol;
                  })
                  .join(" → ")}
              </span>
            </div>

            {/* Route quality (subtle) */}
            {routeQualityScore < 75 && (
              <div className="flex items-center gap-1.5 pt-1">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span className="text-[11px] text-amber-400">
                  {routeQualityScore < 45 ? "Low liquidity route — consider smaller amounts" : "Moderate route quality"}
                </span>
              </div>
            )}

            {/* Stale warning */}
            {quoteIsStale && (
              <div className="flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 text-amber-400" />
                <span className="text-[11px] text-amber-400">Quote expired — will auto-refresh on swap</span>
              </div>
            )}
          </div>
        )}

        {/* ═══ WARNINGS ═══ */}
        {quoteWarnings.length > 0 && (
          <div className="rounded-xl bg-amber-500/5 border border-amber-700/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-300/90 space-y-1">
                {quoteWarnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            </div>
          </div>
        )}

        {/* ═══ QUOTE ERROR ═══ */}
        {quoteError && !quoteLoading && (
          <div className="rounded-xl bg-rose-500/5 border border-rose-700/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-300/90">{quoteError}</p>
            </div>
          </div>
        )}

        {/* ═══ FALLBACK SUGGESTION (subtle) ═══ */}
        {shouldSuggestFallback && fallbackQuote && !quoteLoading && (
          <div className="rounded-xl bg-cyan-500/5 border border-cyan-700/30 p-3 text-xs text-cyan-300/90">
            <p>
              Better rate available via aggregator:{" "}
              <span className="text-cyan-200 font-medium">
                ~{formatAmount(fallbackQuote.amount_out, tokenOutMeta.decimals)} {tokenOutMeta.symbol}
              </span>
              {typeof fallbackAdvantageBps === "number" && (
                <span className="text-emerald-400 ml-1">(+{fallbackAdvantageBps} bps)</span>
              )}
            </p>
          </div>
        )}

        {/* ═══ EXECUTE BUTTON ═══ */}
        <button
          type="button"
          onClick={() => void executeSwap()}
          disabled={buttonDisabled}
          className={`w-full py-3.5 rounded-xl text-sm font-semibold transition-all ${
            buttonDisabled
              ? "bg-zinc-800 border border-zinc-700 text-zinc-500 cursor-not-allowed"
              : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-600/20"
          }`}
        >
          {buildLoading ? (
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {buttonLabel}
            </span>
          ) : (
            buttonLabel
          )}
        </button>

        {/* ═══ NETWORK HINT ═══ */}
        <p className="text-center text-[11px] text-zinc-600">
          Starknet Sepolia · Ekubo Protocol
          {capabilities?.executor_live_submit_enabled && " · Live submit"}
        </p>
      </div>

      {/* ═══ TOKEN SELECTOR MODAL ═══ */}
      <TokenSelectorModal
        open={selectorSide !== null}
        onClose={() => setSelectorSide(null)}
        onSelect={(addr) => {
          if (selectorSide === "in") {
            // If user picks the current output token, flip them
            if (sameAddress(addr, tokenOut)) {
              onTokenChange(tokenOut, tokenIn);
            } else {
              onTokenChange(addr, tokenOut);
            }
          } else {
            if (sameAddress(addr, tokenIn)) {
              onTokenChange(tokenOut, tokenIn);
            } else {
              onTokenChange(tokenIn, addr);
            }
          }
        }}
        tokens={tokens}
        balances={balancesMap}
        excludeAddress={selectorSide === "in" ? tokenOut : selectorSide === "out" ? tokenIn : undefined}
      />
    </div>
  );
}
