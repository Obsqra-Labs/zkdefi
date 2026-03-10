"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAccount } from "@starknet-react/core";
import { ArrowDownUp, RefreshCw, ExternalLink, Search, X } from "lucide-react";
import { toastSuccess, toastError } from "@/lib/toast";
import { ConnectButton } from "./ConnectButton";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

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
}

export function DexPanel() {
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
        fetch(`${API_BASE}/v1/zkdefi/dex/pairs?min_tvl_usd=0`),
        fetch(`${API_BASE}/v1/zkdefi/dex/tokens?page_size=500`).catch(() => null),
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

  const pairTvl = (row: PairRow) =>
    parseFloat(row.tvl0_total ?? "0") + parseFloat(row.tvl1_total ?? "0");
  const pairVolume = (row: PairRow) =>
    parseFloat(row.volume0_24h ?? "0") + parseFloat(row.volume1_24h ?? "0");

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
      const res = await fetch(`${API_BASE}/v1/zkdefi/dex/quote`, {
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
      const calldataRes = await fetch(`${API_BASE}/v1/zkdefi/dex/swap-calldata`, {
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
      const amount = BigInt(swapAmountIn);
      const u256Mask = (BigInt(1) << BigInt(128)) - BigInt(1);
      const amountLow = (amount & u256Mask).toString();
      const amountHigh = (amount >> BigInt(128)).toString();
      const result = await account.execute([
        { contractAddress: tokenInAddress, entrypoint: "approve", calldata: [routerAddress, amountLow, amountHigh] },
        { contractAddress: routerAddress, entrypoint: calldataData.entrypoint as string, calldata: swapCalldata },
      ]);
      setTxHash(result.transaction_hash);
      setSwapStep("done");
      toastSuccess("Swap submitted!", {
        action: {
          label: "View on Starkscan",
          onClick: () => window.open(sepoliaStarkscanTxUrl(result.transaction_hash), "_blank"),
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
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
                    <th className="py-3 px-4 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedPairs.slice(0, 20).map((row, i) => (
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
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => selectPairForSwap(row)}
                          className="text-xs text-emerald-500 hover:text-emerald-400"
                        >
                          Swap
                        </button>
                      </td>
                    </tr>
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
                href={sepoliaStarkscanTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
              >
                View transaction on Starkscan <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
