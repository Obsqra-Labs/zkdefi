"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAccount } from "@starknet-react/core";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, RefreshCw, ExternalLink, Search, X, Brain } from "lucide-react";
import { toastSuccess, toastError } from "@/lib/toast";
import { ConnectButton } from "./ConnectButton";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";

import { API_BASE } from "@/lib/api/client";
const MIN_HEALTHY_TVL_USD = Number(process.env.NEXT_PUBLIC_MIN_HEALTHY_TVL_USD ?? "5000");
const MIN_HEALTHY_VOL_USD = Number(process.env.NEXT_PUBLIC_MIN_HEALTHY_VOL_USD ?? "1000");
const RECOMMENDED_TVL_MULTIPLIER = Number(process.env.NEXT_PUBLIC_LP_SEED_TARGET_MULTIPLIER ?? "1.25");
const TOKEN_DECIMALS_FALLBACK: Record<string, number> = {
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": 18, // STRK
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": 18, // ETH
  "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": 6,  // USDC
  "0x0714c3f541490e1847b77d799499ef01af7937ed0182f3b27a5b6226d993ab55": 18, // strkBTC
};

// Format large wei-style numbers for display (assume 18 decimals for display scaling)
function formatCompact(weiStr: string | number, decimals = 2): string {
  const n = typeof weiStr === "string" ? parseFloat(weiStr) : weiStr;
  if (!Number.isFinite(n) || n === 0) return "0";
  const v = n / 1e18;
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(decimals) + "T";
  if (abs >= 1e9) return (v / 1e9).toFixed(decimals) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(decimals) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(decimals) + "K";
  return v.toFixed(decimals);
}

function shortAddress(addr: string, head = 6, tail = 4): string {
  const s = String(addr);
  if (!s.startsWith("0x") || s.length <= head + tail + 2) return s;
  return `${s.slice(0, head + 2)}…${s.slice(-tail)}`;
}

function formatUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toRawFromUnits(units: number, decimals: number): string {
  if (!Number.isFinite(units) || units <= 0) return "0";
  const safeDecimals = Math.max(0, Math.min(18, Math.floor(decimals)));
  const fixed = units.toFixed(Math.min(8, safeDecimals));
  const [wholeRaw, fracRaw = ""] = fixed.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(safeDecimals)).slice(0, safeDecimals);
  const scale = BigInt(10) ** BigInt(safeDecimals);
  const raw = BigInt(whole) * scale + BigInt(frac || "0");
  return raw.toString();
}

interface PairRow {
  chain_id?: string;
  token0: string;
  token1: string;
  volume0_24h?: string;
  volume1_24h?: string;
  tvl0_total?: string;
  tvl1_total?: string;
}

interface TokenInfo {
  address: string;
  symbol?: string;
  name?: string;
  usd_price?: number | null;
  decimals?: number | string;
}

interface BrainProcessorResult {
  processor_id: string;
  passed: boolean;
  score?: number | null;
  threshold?: number | null;
  has_proof: boolean;
  execution_time_ms: number;
  error?: string | null;
}

interface DexBrainCheckResponse {
  should_execute: boolean;
  decision_logic: string;
  processors_run: string[];
  skipped_processors: string[];
  processor_results: BrainProcessorResult[];
  total_time_ms: number;
  constraints: Record<string, number>;
  portfolio_summary: Record<string, unknown>;
}

interface DexBrainRunState {
  mode: "fast" | "full";
  ranAtMs: number;
  result: DexBrainCheckResponse;
}

interface PairHealth {
  score: number;
  status: "healthy" | "watch" | "thin";
  turnoverPct: number;
  recommendedMaxSwapUsd: number;
  warnings: string[];
}

interface DexPanelProps {
  researchOnly?: boolean;
}

export function DexPanel({ researchOnly = false }: DexPanelProps) {
  const searchParams = useSearchParams();
  const { address, account, isConnected } = useAccount();
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"volume" | "tvl">("volume");
  const [selectedPair, setSelectedPair] = useState<PairRow | null>(null);
  const swapSectionRef = useRef<HTMLDivElement>(null);
  const [swapTokenIn, setSwapTokenIn] = useState("");
  const [swapTokenOut, setSwapTokenOut] = useState("");
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<{ amount_out: string; amount_out_min: string } | null>(null);
  const [swapStep, setSwapStep] = useState<"idle" | "quoting" | "building" | "signing" | "done">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [brainRuns, setBrainRuns] = useState<Record<string, DexBrainRunState>>({});
  const [brainLoadingPairKey, setBrainLoadingPairKey] = useState<string | null>(null);
  const [seedTargetTvlUsd, setSeedTargetTvlUsd] = useState("0");
  const [seedFeeTier, setSeedFeeTier] = useState(3000);
  const [seedRiskProfile, setSeedRiskProfile] = useState<"conservative" | "neutral" | "aggressive">("neutral");

  const symbolByAddress = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of tokens) {
      const addr = t.address?.toLowerCase?.() ?? t.address;
      if (addr && (t.symbol ?? t.name)) m[addr] = t.symbol ?? t.name ?? addr;
    }
    return m;
  }, [tokens]);

  const usdPriceByAddress = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tokens) {
      const addr = t.address?.toLowerCase?.() ?? t.address;
      const p = t.usd_price;
      if (addr && typeof p === "number" && p > 0) m[addr] = p;
    }
    return m;
  }, [tokens]);

  const decimalsByAddress = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tokens) {
      const addr = t.address?.toLowerCase?.() ?? t.address;
      if (!addr) continue;
      const raw =
        typeof t.decimals === "number"
          ? t.decimals
          : typeof t.decimals === "string"
            ? Number(t.decimals)
            : TOKEN_DECIMALS_FALLBACK[addr];
      if (Number.isFinite(raw) && raw >= 0) m[addr] = Math.floor(raw);
    }
    for (const [addr, dec] of Object.entries(TOKEN_DECIMALS_FALLBACK)) {
      if (typeof m[addr] !== "number") m[addr] = dec;
    }
    return m;
  }, [tokens]);

  const normalizePair = (row: Record<string, unknown>): PairRow => ({
    token0: String(row.token0 ?? row.token_0 ?? ""),
    token1: String(row.token1 ?? row.token_1 ?? ""),
    volume0_24h: String((row as Record<string, unknown>).volume0_24h ?? "0"),
    volume1_24h: String((row as Record<string, unknown>).volume1_24h ?? "0"),
    tvl0_total: String(row.tvl0_total ?? row.tvl0Total ?? row.tvl_0_total ?? "0"),
    tvl1_total: String(row.tvl1_total ?? row.tvl1Total ?? row.tvl_1_total ?? "0"),
  });

  const fetchDexData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [pairsRes, tokensRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/zkdefi/dex/pairs?min_tvl_usd=0`),
        fetch(`${API_BASE}/api/v1/zkdefi/dex/tokens?page_size=500`).catch(() => null),
      ]);
      if (pairsRes.ok) {
        const data = await pairsRes.json();
        const list = data?.topPairs ?? data?.pairs ?? (Array.isArray(data) ? data : []);
        setPairs(
          list.map((r: Record<string, unknown>) => normalizePair(r))
        );
      } else {
        setPairs([]);
        const err = await pairsRes.json().catch(() => ({}));
        const raw = err?.detail;
        const msg = Array.isArray(raw) ? (raw[0] ?? raw.join(" ")) : (typeof raw === "string" ? raw : null);
        setError(msg ?? "DEX API unavailable. Set EKUBO_CHAIN_ID for pair/price endpoints.");
      }
      if (tokensRes?.ok) {
        const tokData = await tokensRes.json();
        const list = tokData?.tokens ?? (Array.isArray(tokData) ? tokData : []);
        setTokens(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load DEX data");
      setPairs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDexData();
  }, [fetchDexData]);

  useEffect(() => {
    if (prefillApplied) return;
    const tokenIn = searchParams.get("token_in");
    const tokenOut = searchParams.get("token_out");
    const amountIn = searchParams.get("amount_in");
    const hasAnyPrefill = Boolean(tokenIn || tokenOut || amountIn);
    if (!hasAnyPrefill) return;
    if (tokenIn) setSwapTokenIn(tokenIn);
    if (tokenOut) setSwapTokenOut(tokenOut);
    if (amountIn) setSwapAmountIn(amountIn);
    setPrefillApplied(true);
    window.setTimeout(() => {
      swapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, [prefillApplied, searchParams]);

  const pairTvl = (row: PairRow) =>
    parseFloat(row.tvl0_total ?? "0") + parseFloat(row.tvl1_total ?? "0");
  const pairVolume = (row: PairRow) =>
    parseFloat(row.volume0_24h ?? "0") + parseFloat(row.volume1_24h ?? "0");
  const pairKey = (row: PairRow) => `${(row.token0 ?? "").toLowerCase()}::${(row.token1 ?? "").toLowerCase()}`;

  const evaluatePairHealth = useCallback(
    (row: PairRow): PairHealth => {
      const tvl = pairTvl(row);
      const volume = pairVolume(row);
      const turnoverPct = tvl > 0 ? (volume / tvl) * 100 : 0;
      const tvlScore = clamp(Math.log10(Math.max(1, tvl)) * 18, 0, 55);
      const volumeScore = clamp(Math.log10(Math.max(1, volume)) * 16, 0, 30);
      const turnoverScore = clamp(turnoverPct, 0, 15);
      const score = Math.floor(clamp(tvlScore + volumeScore + turnoverScore, 0, 100));
      const recommendedMaxSwapUsd = clamp(Math.min(tvl * 0.004, Math.max(1, volume * 0.015)), 0.5, 250);
      const warnings: string[] = [];
      if (tvl < MIN_HEALTHY_TVL_USD) warnings.push(`TVL below healthy target (${formatUsd(MIN_HEALTHY_TVL_USD)}).`);
      if (volume < MIN_HEALTHY_VOL_USD) warnings.push(`24h volume below healthy target (${formatUsd(MIN_HEALTHY_VOL_USD)}).`);
      if (turnoverPct < 0.2) warnings.push("Low turnover: routing can degrade quickly at larger sizes.");
      const status: PairHealth["status"] =
        score >= 70 && tvl >= MIN_HEALTHY_TVL_USD ? "healthy" : score >= 45 ? "watch" : "thin";
      return {
        score,
        status,
        turnoverPct,
        recommendedMaxSwapUsd,
        warnings,
      };
    },
    [],
  );

  /** Price of token1 in units of token0 (e.g. how many token1 per 1 token0). From token usd_price or TVL ratio. */
  const pairPrice = (row: PairRow): string => {
    const addr0 = row.token0?.toLowerCase();
    const addr1 = row.token1?.toLowerCase();
    const p0 = addr0 ? usdPriceByAddress[addr0] : undefined;
    const p1 = addr1 ? usdPriceByAddress[addr1] : undefined;
    if (typeof p0 === "number" && p0 > 0 && typeof p1 === "number" && p1 > 0) {
      const ratio = p0 / p1;
      if (ratio >= 1e6) return (ratio / 1e6).toFixed(2) + "M";
      if (ratio >= 1e3) return (ratio / 1e3).toFixed(2) + "K";
      if (ratio >= 1) return ratio.toFixed(4);
      if (ratio >= 0.0001) return ratio.toFixed(6);
      return ratio.toExponential(2);
    }
    const tvl0 = parseFloat(row.tvl0_total ?? "0");
    const tvl1 = parseFloat(row.tvl1_total ?? "0");
    if (tvl0 > 0 && tvl1 >= 0) {
      const ratio = tvl1 / tvl0;
      if (ratio >= 1e6) return (ratio / 1e6).toFixed(2) + "M";
      if (ratio >= 1e3) return (ratio / 1e3).toFixed(2) + "K";
      if (ratio >= 1 || ratio < 0.0001) return ratio.toExponential(2);
      return ratio.toFixed(4);
    }
    return "—";
  };

  const filteredAndSortedPairs = useMemo(() => {
    let list = [...pairs];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (row) =>
          (symbolByAddress[row.token0?.toLowerCase()] ?? "").toLowerCase().includes(q) ||
          (symbolByAddress[row.token1?.toLowerCase()] ?? "").toLowerCase().includes(q) ||
          row.token0?.toLowerCase().includes(q) ||
          row.token1?.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) =>
      sortBy === "tvl"
        ? pairTvl(b) - pairTvl(a)
        : pairVolume(b) - pairVolume(a)
    );
    return list;
  }, [pairs, search, sortBy, symbolByAddress]);

  const totalTvl = useMemo(
    () => pairs.reduce((acc, row) => acc + pairTvl(row), 0),
    [pairs]
  );
  const totalVolume24h = useMemo(
    () => pairs.reduce((acc, row) => acc + pairVolume(row), 0),
    [pairs]
  );

  const displayPair = (row: PairRow) => {
    const s0 = symbolByAddress[row.token0?.toLowerCase()] ?? shortAddress(row.token0);
    const s1 = symbolByAddress[row.token1?.toLowerCase()] ?? shortAddress(row.token1);
    return `${s0} / ${s1}`;
  };

  const handleQuote = async () => {
    if (!swapTokenIn || !swapTokenOut || !swapAmountIn) {
      toastError("Select pair and enter amount");
      return;
    }
    setSwapStep("quoting");
    setQuote(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/dex/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: swapTokenIn,
          token_out: swapTokenOut,
          amount_in: swapAmountIn,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setQuote({ amount_out: data.amount_out, amount_out_min: data.amount_out_min });
      } else {
        toastError(data.detail ?? "Quote failed");
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Quote failed");
    } finally {
      setSwapStep("idle");
    }
  };

  const handleSwap = async () => {
    if (!account || !swapTokenIn || !swapTokenOut || !swapAmountIn) {
      toastError("Connect wallet and enter swap details");
      return;
    }
    setSwapStep("building");
    try {
      const calldataRes = await fetch(`${API_BASE}/api/v1/zkdefi/dex/swap-calldata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: swapTokenIn,
          token_out: swapTokenOut,
          amount_in: swapAmountIn,
          slippage_bps: slippageBps,
          user_address: address,
        }),
      });
      const calldataData = await calldataRes.json();
      if (!calldataRes.ok) {
        toastError(calldataData.detail ?? "Failed to build swap calldata");
        setSwapStep("idle");
        return;
      }
      setSwapStep("signing");
      const routerAddress = calldataData.contract_address as `0x${string}`;
      const swapCalldata = (calldataData.calldata as string[]).map((c: string) => c);
      const tokenInAddress = swapTokenIn.startsWith("0x") ? swapTokenIn as `0x${string}` : `0x${swapTokenIn}`;
      const tokenOutAddress = swapTokenOut.startsWith("0x") ? swapTokenOut as `0x${string}` : `0x${swapTokenOut}`;
      const amount = BigInt(swapAmountIn);
      const u256Mask = (BigInt(1) << BigInt(128)) - BigInt(1);
      const amountLow = (amount & u256Mask).toString();
      const amountHigh = (amount >> BigInt(128)).toString();
      const result = await account.execute([
        { contractAddress: tokenInAddress, entrypoint: "transfer", calldata: [routerAddress, amountLow, amountHigh] },
        { contractAddress: routerAddress, entrypoint: calldataData.entrypoint as string, calldata: swapCalldata },
        { contractAddress: routerAddress, entrypoint: "clear", calldata: [tokenOutAddress] },
        { contractAddress: routerAddress, entrypoint: "clear", calldata: [tokenInAddress] },
      ]);
      setTxHash(result.transaction_hash);
      setSwapStep("done");
      toastSuccess("Swap submitted!", {
        action: {
          label: "View on Explorer",
          onClick: () => window.open(sepoliaVoyagerTxUrl(result.transaction_hash), "_blank"),
        },
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Swap failed");
      setSwapStep("idle");
    }
  };

  const selectPairForSwap = (row: PairRow) => {
    setSelectedPair(row);
    setSwapTokenIn(row.token0);
    setSwapTokenOut(row.token1);
  };

  const usePairInSwap = () => {
    if (selectedPair) {
      setSwapTokenIn(selectedPair.token0);
      setSwapTokenOut(selectedPair.token1);
      swapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const runBrainChecks = async (row: PairRow, mode: "fast" | "full" = "fast") => {
    const key = pairKey(row);
    setBrainLoadingPairKey(key);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/dex/brain-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address || "0x1",
          token0: row.token0,
          token1: row.token1,
          tvl0_total: row.tvl0_total ?? "0",
          tvl1_total: row.tvl1_total ?? "0",
          volume0_24h: row.volume0_24h ?? "0",
          volume1_24h: row.volume1_24h ?? "0",
          decision_logic: "AND",
          include_slow_models: mode === "full",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data?.detail ?? "Brain checks failed");
        return;
      }
      setBrainRuns((prev) => ({
        ...prev,
        [key]: {
          mode,
          ranAtMs: Date.now(),
          result: data as DexBrainCheckResponse,
        },
      }));
      if (!selectedPair || pairKey(selectedPair) !== key) {
        setSelectedPair(row);
      }
      const summary = (data as DexBrainCheckResponse).should_execute ? "PASS" : "HOLD";
      toastSuccess(`Brain checks complete (${summary})`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Brain checks failed");
    } finally {
      setBrainLoadingPairKey(null);
    }
  };

  const selectedBrain = selectedPair ? brainRuns[pairKey(selectedPair)] : null;
  const selectedHealth = selectedPair ? evaluatePairHealth(selectedPair) : null;

  useEffect(() => {
    if (!selectedPair) return;
    const current = pairTvl(selectedPair);
    const suggestedTarget = Math.max(current * RECOMMENDED_TVL_MULTIPLIER, MIN_HEALTHY_TVL_USD);
    setSeedTargetTvlUsd(Math.ceil(suggestedTarget).toString());
  }, [selectedPair]);

  const selectedSeedPlan = useMemo(() => {
    if (!selectedPair) return null;
    const currentTvl = pairTvl(selectedPair);
    const targetTvl = Number(seedTargetTvlUsd || "0");
    const seedUsd = Math.max(0, targetTvl - currentTvl);
    const tvl0 = Math.max(0, parseFloat(selectedPair.tvl0_total ?? "0"));
    const tvl1 = Math.max(0, parseFloat(selectedPair.tvl1_total ?? "0"));
    const ratio0 = tvl0 + tvl1 > 0 ? tvl0 / (tvl0 + tvl1) : 0.5;
    const ratio1 = 1 - ratio0;
    const token0Addr = selectedPair.token0.toLowerCase();
    const token1Addr = selectedPair.token1.toLowerCase();
    const p0 = usdPriceByAddress[token0Addr];
    const p1 = usdPriceByAddress[token1Addr];
    const d0 = decimalsByAddress[token0Addr] ?? 18;
    const d1 = decimalsByAddress[token1Addr] ?? 18;

    const seedUsd0 = seedUsd * ratio0;
    const seedUsd1 = seedUsd * ratio1;
    const units0 = p0 && p0 > 0 ? seedUsd0 / p0 : null;
    const units1 = p1 && p1 > 0 ? seedUsd1 / p1 : null;

    const raw0 = units0 !== null ? toRawFromUnits(units0, d0) : null;
    const raw1 = units1 !== null ? toRawFromUnits(units1, d1) : null;

    const warnings: string[] = [];
    if (seedUsd <= 0) warnings.push("Pair already meets target TVL. No additional seeding required.");
    if (!p0) warnings.push(`Missing USD price feed for ${symbolByAddress[token0Addr] ?? shortAddress(selectedPair.token0)}.`);
    if (!p1) warnings.push(`Missing USD price feed for ${symbolByAddress[token1Addr] ?? shortAddress(selectedPair.token1)}.`);

    return {
      currentTvlUsd: currentTvl,
      targetTvlUsd: targetTvl,
      additionalSeedUsd: seedUsd,
      ratio0,
      ratio1,
      seedUsd0,
      seedUsd1,
      units0,
      units1,
      raw0,
      raw1,
      warnings,
    };
  }, [decimalsByAddress, seedTargetTvlUsd, selectedPair, symbolByAddress, usdPriceByAddress]);

  const sendToVaultSwap = () => {
    const tokenIn = swapTokenIn || selectedPair?.token0;
    const tokenOut = swapTokenOut || selectedPair?.token1;
    const amountIn = swapAmountIn || "";
    const q = new URLSearchParams();
    q.set("tab", "vault");
    if (tokenIn) q.set("token_in", tokenIn);
    if (tokenOut) q.set("token_out", tokenOut);
    if (amountIn) q.set("amount_in", amountIn);
    window.location.href = `/agent?${q.toString()}`;
  };

  const copySeedPlan = async () => {
    if (!selectedPair || !selectedSeedPlan) return;
    const payload = {
      token0: selectedPair.token0,
      token1: selectedPair.token1,
      fee_tier: seedFeeTier,
      risk_profile: seedRiskProfile,
      amount0: selectedSeedPlan.raw0 ?? "0",
      amount1: selectedSeedPlan.raw1 ?? "0",
      note: "Generated from DEX LP Seeding Assistant",
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toastSuccess("Seed plan copied");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to copy seed plan");
    }
  };

  const openLpWithSeedPlan = () => {
    if (!selectedPair || !selectedSeedPlan || !selectedSeedPlan.raw0 || !selectedSeedPlan.raw1) {
      toastError("Seed plan requires token price feeds for both tokens.");
      return;
    }
    const payload = {
      token0: selectedPair.token0,
      token1: selectedPair.token1,
      amount0: selectedSeedPlan.raw0,
      amount1: selectedSeedPlan.raw1,
      fee_tier: seedFeeTier,
      risk_profile: seedRiskProfile,
      generated_at: Date.now(),
    };
    window.localStorage.setItem("zkdefi_lp_seed_prefill", JSON.stringify(payload));
    window.location.href = "/agent?tab=dashboard";
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <ArrowDownUp className="w-5 h-5 text-emerald-400" />
            Ekubo Sepolia
          </h3>
          <button
            type="button"
            onClick={fetchDexData}
            disabled={loading}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {loading && !pairs.length && (
          <div className="text-zinc-500 py-8 text-center">Loading markets…</div>
        )}
        {error && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 text-sm text-amber-200 mb-4">
            {error}
          </div>
        )}
        {!loading && pairs.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Pairs</p>
                <p className="text-xl font-semibold tabular-nums">{pairs.length}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total TVL</p>
                <p className="text-xl font-semibold tabular-nums text-emerald-400/90">
                  {formatCompact(String(totalTvl))}
                </p>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">24h Volume</p>
                <p className="text-xl font-semibold tabular-nums text-violet-400/90">
                  {formatCompact(String(totalVolume24h))}
                </p>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Network</p>
                <p className="text-sm font-medium">Sepolia</p>
              </div>
            </div>

            {selectedPair && (
              <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Selected pair</p>
                    <p className="text-lg font-semibold text-white mb-1">{displayPair(selectedPair)}</p>
                    <p className="text-xs text-zinc-500 font-mono">
                      {shortAddress(selectedPair.token0)} / {shortAddress(selectedPair.token1)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm">
                      <span className="text-zinc-400">
                        TVL <span className="font-medium text-emerald-400/90 tabular-nums">{formatCompact(String(pairTvl(selectedPair)))}</span>
                      </span>
                      <span className="text-zinc-400">
                        24h Vol <span className="font-medium text-violet-400/90 tabular-nums">{formatCompact(String(pairVolume(selectedPair)))}</span>
                      </span>
                      {selectedHealth && (
                        <span className="text-zinc-400">
                          Health{" "}
                          <span
                            className={`font-medium ${
                              selectedHealth.status === "healthy"
                                ? "text-emerald-300"
                                : selectedHealth.status === "watch"
                                  ? "text-amber-300"
                                  : "text-rose-300"
                            }`}
                          >
                            {selectedHealth.status.toUpperCase()} ({selectedHealth.score})
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => runBrainChecks(selectedPair, "fast")}
                      disabled={brainLoadingPairKey === pairKey(selectedPair)}
                      className="px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white font-medium text-sm transition-colors disabled:opacity-50"
                    >
                      {brainLoadingPairKey === pairKey(selectedPair) ? "Running…" : "Run Brain Checks"}
                    </button>
                    <button
                      type="button"
                      onClick={() => runBrainChecks(selectedPair, "full")}
                      disabled={brainLoadingPairKey === pairKey(selectedPair)}
                      className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-sm transition-colors disabled:opacity-50"
                    >
                      Full Marketplace
                    </button>
                    <button
                      type="button"
                      onClick={usePairInSwap}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors"
                    >
                      Use in swap
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPair(null)}
                      className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                      title="Clear selection"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {selectedPair && selectedHealth && (
              <div className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900/40 p-5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-sm font-medium text-zinc-200">Pool Health Monitor</p>
                  <span
                    className={`px-2 py-1 rounded text-[11px] border ${
                      selectedHealth.status === "healthy"
                        ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                        : selectedHealth.status === "watch"
                          ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                          : "text-rose-300 border-rose-500/30 bg-rose-500/10"
                    }`}
                  >
                    {selectedHealth.status.toUpperCase()} • {selectedHealth.score}/100
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span>
                    Turnover: <span className="text-zinc-200">{selectedHealth.turnoverPct.toFixed(2)}%</span>
                  </span>
                  <span>
                    Suggested max manual swap:{" "}
                    <span className="text-zinc-200">{formatUsd(selectedHealth.recommendedMaxSwapUsd, 2)}</span>
                  </span>
                  <span>
                    Healthy target:{" "}
                    <span className="text-zinc-200">
                      {formatUsd(MIN_HEALTHY_TVL_USD)} TVL / {formatUsd(MIN_HEALTHY_VOL_USD)} 24h volume
                    </span>
                  </span>
                </div>
                {selectedHealth.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-amber-300 space-y-1">
                    {selectedHealth.warnings.map((warning) => (
                      <p key={warning}>• {warning}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedPair && selectedSeedPlan && (
              <div className="mb-6 rounded-xl border border-cyan-600/30 bg-cyan-950/10 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <p className="text-sm font-medium text-cyan-200">LP Seeding Assistant</p>
                  <span className="text-xs text-zinc-400">Goal: raise pair depth without changing style flow</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Target TVL (USD)</label>
                    <input
                      type="number"
                      min={0}
                      value={seedTargetTvlUsd}
                      onChange={(e) => setSeedTargetTvlUsd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Risk profile</label>
                    <select
                      value={seedRiskProfile}
                      onChange={(e) => setSeedRiskProfile(e.target.value as "conservative" | "neutral" | "aggressive")}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                    >
                      <option value="conservative">Conservative</option>
                      <option value="neutral">Neutral</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Fee tier</label>
                    <select
                      value={seedFeeTier}
                      onChange={(e) => setSeedFeeTier(Number(e.target.value) || 3000)}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                    >
                      <option value={500}>500 (0.05%)</option>
                      <option value={3000}>3000 (0.30%)</option>
                      <option value={10000}>10000 (1.00%)</option>
                    </select>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-3 text-xs text-zinc-300">
                  <p>
                    Current TVL: <span className="text-zinc-100">{formatUsd(selectedSeedPlan.currentTvlUsd)}</span> • Target TVL:{" "}
                    <span className="text-zinc-100">{formatUsd(selectedSeedPlan.targetTvlUsd)}</span>
                  </p>
                  <p>
                    Suggested additional seed:{" "}
                    <span className="text-cyan-200">{formatUsd(selectedSeedPlan.additionalSeedUsd)}</span>
                  </p>
                  <p>
                    Split:{" "}
                    <span className="text-zinc-100">
                      {(selectedSeedPlan.ratio0 * 100).toFixed(1)}% / {(selectedSeedPlan.ratio1 * 100).toFixed(1)}%
                    </span>{" "}
                    (token0/token1)
                  </p>
                  <p>
                    Token0 add:{" "}
                    <span className="text-zinc-100">
                      {selectedSeedPlan.units0 !== null
                        ? `${selectedSeedPlan.units0.toFixed(6)} (${selectedSeedPlan.raw0})`
                        : `${formatUsd(selectedSeedPlan.seedUsd0)} (price feed missing)`}
                    </span>
                  </p>
                  <p>
                    Token1 add:{" "}
                    <span className="text-zinc-100">
                      {selectedSeedPlan.units1 !== null
                        ? `${selectedSeedPlan.units1.toFixed(6)} (${selectedSeedPlan.raw1})`
                        : `${formatUsd(selectedSeedPlan.seedUsd1)} (price feed missing)`}
                    </span>
                  </p>
                </div>
                {selectedSeedPlan.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-amber-300 space-y-1">
                    {selectedSeedPlan.warnings.map((warning) => (
                      <p key={warning}>• {warning}</p>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copySeedPlan()}
                    className="px-3 py-1.5 rounded-lg border border-cyan-600/50 text-cyan-200 hover:bg-cyan-600/20 text-sm"
                  >
                    Copy Seed Payload
                  </button>
                  <button
                    type="button"
                    onClick={openLpWithSeedPlan}
                    className="px-3 py-1.5 rounded-lg border border-emerald-600/50 text-emerald-200 hover:bg-emerald-600/20 text-sm"
                  >
                    Open LP Tab with Prefill
                  </button>
                </div>
              </div>
            )}

            {selectedPair && selectedBrain && (
              <div className="mb-6 rounded-xl border border-cyan-500/30 bg-cyan-950/10 p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-cyan-300" />
                    <p className="text-sm font-medium text-cyan-200">
                      Brain checks ({selectedBrain.mode === "full" ? "full marketplace" : "fast relevant"})
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs border ${
                      selectedBrain.result.should_execute
                        ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                        : "text-amber-300 border-amber-500/30 bg-amber-500/10"
                    }`}
                  >
                    {selectedBrain.result.should_execute ? "PASS" : "HOLD"}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mb-3">
                  Decision logic: {selectedBrain.result.decision_logic} • models run {selectedBrain.result.processors_run.length}
                  {selectedBrain.result.skipped_processors.length > 0
                    ? ` • skipped ${selectedBrain.result.skipped_processors.join(", ")}`
                    : ""}{" "}
                  • {selectedBrain.result.total_time_ms}ms
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {selectedBrain.result.processor_results.map((row) => (
                    <div
                      key={row.processor_id}
                      className={`rounded-lg border p-3 text-xs ${
                        row.passed
                          ? "border-emerald-600/30 bg-emerald-500/5"
                          : "border-amber-600/30 bg-amber-500/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-zinc-200 font-medium">{row.processor_id}</span>
                        <span className={row.passed ? "text-emerald-300" : "text-amber-300"}>
                          {row.passed ? "pass" : "hold"}
                        </span>
                      </div>
                      <p className="text-zinc-400">
                        score {row.score ?? "--"} / threshold {row.threshold ?? "--"} • {row.execution_time_ms}ms
                      </p>
                      <p className="text-zinc-500">{row.has_proof ? "proof available" : "no proof output"}</p>
                      {row.error && <p className="text-amber-300 mt-1">{row.error}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by token or address…"
                  className="w-full sm:w-64 pl-9 pr-4 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSortBy("volume")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    sortBy === "volume"
                      ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-300"
                  }`}
                >
                  By volume
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy("tvl")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    sortBy === "tvl"
                      ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-300"
                  }`}
                >
                  By TVL
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
                    <th className="py-3 px-4 font-medium">Pair</th>
                    <th className="py-3 px-4 font-medium text-right">Price</th>
                    <th className="py-3 px-4 font-medium text-right">TVL</th>
                    <th className="py-3 px-4 font-medium text-right">24h Volume</th>
                    <th className="py-3 px-4 font-medium text-right">Health</th>
                    <th className="py-3 px-4 font-medium text-right">Brain</th>
                    <th className="py-3 px-4 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedPairs.slice(0, 20).map((row, i) => (
                    (() => {
                      const health = evaluatePairHealth(row);
                      return (
                    <tr
                      key={`${row.token0}-${row.token1}-${i}`}
                      onClick={() => selectPairForSwap(row)}
                      className={`border-b border-zinc-800/80 hover:bg-zinc-800/30 transition-colors cursor-pointer ${selectedPair && selectedPair.token0 === row.token0 && selectedPair.token1 === row.token1 ? "bg-emerald-950/20 border-l-2 border-l-emerald-500/50" : ""}`}
                    >
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => selectPairForSwap(row)}
                          className="text-left font-medium text-white hover:text-emerald-400 transition-colors flex items-center gap-1"
                          title={`Use ${displayPair(row)} for swap`}
                        >
                          {displayPair(row)}
                        </button>
                        <p className="text-xs text-zinc-500 font-mono mt-0.5">
                          {shortAddress(row.token0)} / {shortAddress(row.token1)}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-zinc-400" title="Token1 per Token0">
                        {pairPrice(row)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-zinc-300">
                        {formatCompact(String(pairTvl(row)))}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-zinc-400">
                        {formatCompact(String(pairVolume(row)))}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`text-[11px] px-2 py-1 rounded border ${
                            health.status === "healthy"
                              ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                              : health.status === "watch"
                                ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                                : "text-rose-300 border-rose-500/30 bg-rose-500/10"
                          }`}
                          title={`Turnover ${health.turnoverPct.toFixed(2)}% • suggested max ${formatUsd(health.recommendedMaxSwapUsd)}`}
                        >
                          {health.status.toUpperCase()} {health.score}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {brainRuns[pairKey(row)] ? (
                          <span
                            className={`text-[11px] px-2 py-1 rounded border ${
                              brainRuns[pairKey(row)].result.should_execute
                                ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                                : "text-amber-300 border-amber-500/30 bg-amber-500/10"
                            }`}
                          >
                            {brainRuns[pairKey(row)].result.should_execute ? "PASS" : "HOLD"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void runBrainChecks(row, "fast");
                            }}
                            disabled={brainLoadingPairKey === pairKey(row)}
                            className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                          >
                            {brainLoadingPairKey === pairKey(row) ? "Running…" : "Run"}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => selectPairForSwap(row)}
                          className="text-xs text-emerald-500 hover:text-emerald-400"
                        >
                          {researchOnly ? "Use pair" : "Swap"}
                        </button>
                      </td>
                    </tr>
                      );
                    })()
                  ))}
                </tbody>
              </table>
            </div>
            {filteredAndSortedPairs.length > 20 && (
              <p className="text-xs text-zinc-500 mt-2">
                Showing top 20 by {sortBy}. Use search to narrow.
              </p>
            )}
          </>
        )}
      </div>

      {researchOnly ? (
        <div ref={swapSectionRef} className="glass rounded-xl border border-zinc-800 p-6">
          <h3 className="font-semibold mb-3">Markets to Vault handoff</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Markets view is research-first. Select a pair, run checks, then hand off to Vault for execution.
          </p>
          <button
            type="button"
            onClick={sendToVaultSwap}
            disabled={!selectedPair && (!swapTokenIn || !swapTokenOut)}
            className="px-4 py-2 rounded-lg border border-emerald-600/50 text-emerald-300 hover:bg-emerald-600/10 disabled:opacity-50"
          >
            Send to Vault Swap
          </button>
        </div>
      ) : (
        <div ref={swapSectionRef} className="glass rounded-xl border border-zinc-800 p-6">
          <h3 className="font-semibold mb-4">Swap</h3>
          {!isConnected ? (
            <div className="text-center py-6">
              <p className="text-zinc-400 mb-4">Connect wallet to swap on Ekubo Sepolia</p>
              <ConnectButton />
            </div>
          ) : (
            <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Token In (address)</label>
              <input
                type="text"
                value={swapTokenIn}
                onChange={(e) => setSwapTokenIn(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white font-mono text-sm focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Token Out (address)</label>
              <input
                type="text"
                value={swapTokenOut}
                onChange={(e) => setSwapTokenOut(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white font-mono text-sm focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Amount In (wei)</label>
              <input
                type="text"
                value={swapAmountIn}
                onChange={(e) => setSwapAmountIn(e.target.value)}
                placeholder="1000000000000000000"
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white font-mono text-sm focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Slippage (bps, e.g. 50 = 0.5%)</label>
              <input
                type="number"
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value) || 0)}
                min={0}
                max={10000}
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white focus:border-emerald-500/50 focus:outline-none"
              />
            </div>
            {quote && (
              <div className="rounded-lg bg-zinc-800/50 p-4 border border-zinc-700 text-sm">
                <p className="text-zinc-400">
                  Expected out: <span className="text-white font-mono">{formatCompact(quote.amount_out)}</span>
                </p>
                <p className="text-zinc-400">
                  Min out (slippage): <span className="text-white font-mono">{formatCompact(quote.amount_out_min)}</span>
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleQuote}
                disabled={swapStep !== "idle" || !swapTokenIn || !swapTokenOut || !swapAmountIn}
                className="flex-1 px-4 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white font-medium disabled:opacity-50 transition-colors"
              >
                Get Quote
              </button>
              <button
                type="button"
                onClick={handleSwap}
                disabled={swapStep === "quoting" || swapStep === "building" || swapStep === "signing" || !swapTokenIn || !swapTokenOut || !swapAmountIn}
                className="flex-1 px-4 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50 transition-colors"
              >
                {swapStep === "building" || swapStep === "signing" ? "Submitting…" : "Swap"}
              </button>
            </div>
            {txHash && (
              <a
                href={sepoliaVoyagerTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
              >
                View transaction on Explorer <ExternalLink className="w-4 h-4" />
              </a>
            )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
