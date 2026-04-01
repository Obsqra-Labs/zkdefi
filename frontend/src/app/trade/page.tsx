"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import {
  ArrowDownUp,
  ArrowRightLeft,
  RefreshCw,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { toastSuccess, toastError } from "@/lib/toast";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";
import { API_BASE } from "@/lib/api/client";

/* ── popular tokens ── */
interface Token {
  symbol: string;
  address: string;
  decimals: number;
}

const TOKENS: Token[] = [
  { symbol: "ETH", address: "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", decimals: 18 },
  { symbol: "STRK", address: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", decimals: 18 },
  { symbol: "zkdAI", address: "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637", decimals: 18 },
  { symbol: "zkdETH", address: "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121", decimals: 18 },
];

type VenuePref = "best" | "ekubo" | "avnu";

interface PreflightResult {
  can_submit: boolean;
  max_safe_input_raw: string;
  expected_out_usd: number;
  impact_bps: number;
  warnings: string[];
  blocking_reasons: string[];
  liquidity_depth_usd: number | null;
}

function formatWei(wei: string | number, decimals = 18, display = 4): string {
  const n = typeof wei === "string" ? parseFloat(wei) : wei;
  if (!Number.isFinite(n) || n === 0) return "0";
  return (n / 10 ** decimals).toFixed(display);
}

export default function TradePage() {
  const { address, account, isConnected } = useAccount();

  const [tokenIn, setTokenIn] = useState(TOKENS[0]);
  const [tokenOut, setTokenOut] = useState(TOKENS[1]);
  const [amountIn, setAmountIn] = useState("0.1");
  const [slippageBps, setSlippageBps] = useState(50);
  const [venuePref, setVenuePref] = useState<VenuePref>("best");

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const [ekuboQuote, setEkuboQuote] = useState<PreflightResult | null>(null);
  const [avnuQuote, setAvnuQuote] = useState<PreflightResult | null>(null);
  const [comparingVenues, setComparingVenues] = useState(false);

  const [swapStep, setSwapStep] = useState<"idle" | "building" | "signing" | "done">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  /* convert human amount to wei */
  const amountInWei = useCallback(() => {
    try {
      const n = parseFloat(amountIn);
      if (!Number.isFinite(n) || n <= 0) return "0";
      return BigInt(Math.round(n * 10 ** tokenIn.decimals)).toString();
    } catch {
      return "0";
    }
  }, [amountIn, tokenIn]);

  /* swap token direction */
  const flipTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setPreflight(null);
    setEkuboQuote(null);
    setAvnuQuote(null);
  };

  /* get execution preflight */
  const fetchPreflight = useCallback(async (venue: VenuePref = venuePref) => {
    const wei = amountInWei();
    if (wei === "0") return null;
    try {
      const res = await fetch(`${API_BASE}/v1/zkdefi/state/execution/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: tokenIn.address,
          token_out: tokenOut.address,
          amount_in: wei,
          slippage_bps: slippageBps,
          venue_pref: venue,
          user_address: address ?? "0xdemo",
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return (await res.json()) as PreflightResult;
    } catch { /* fallthrough */ }
    return null;
  }, [amountInWei, tokenIn, tokenOut, slippageBps, venuePref, address]);

  /* quote with venue comparison */
  const handleQuote = async () => {
    setPreflightLoading(true);
    setPreflight(null);
    setEkuboQuote(null);
    setAvnuQuote(null);
    setTxHash(null);
    setSwapStep("idle");

    try {
      const mainResult = await fetchPreflight(venuePref);
      setPreflight(mainResult);

      /* compare both venues in parallel */
      setComparingVenues(true);
      const [ekubo, avnu] = await Promise.all([
        fetchPreflight("ekubo"),
        fetchPreflight("avnu"),
      ]);
      setEkuboQuote(ekubo);
      setAvnuQuote(avnu);
    } finally {
      setPreflightLoading(false);
      setComparingVenues(false);
    }
  };

  /* execute swap */
  const handleSwap = async () => {
    if (!account || !preflight?.can_submit) return;
    const wei = amountInWei();
    if (wei === "0") return;

    setSwapStep("building");
    try {
      const calldataRes = await fetch(`${API_BASE}/v1/zkdefi/dex/swap-calldata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: tokenIn.address,
          token_out: tokenOut.address,
          amount_in: wei,
          slippage_bps: slippageBps,
          user_address: address,
        }),
      });
      const data = await calldataRes.json();
      if (!calldataRes.ok) {
        toastError(data.detail ?? "Failed to build calldata");
        setSwapStep("idle");
        return;
      }

      setSwapStep("signing");
      const routerAddress = data.contract_address as `0x${string}`;
      const calldata = (data.calldata as string[]).slice();
      const amount = BigInt(wei);
      const u256Mask = (BigInt(1) << BigInt(128)) - BigInt(1);
      const amountLow = (amount & u256Mask).toString();
      const amountHigh = (amount >> BigInt(128)).toString();

      const result = await account.execute([
        { contractAddress: tokenIn.address as `0x${string}`, entrypoint: "approve", calldata: [routerAddress, amountLow, amountHigh] },
        { contractAddress: routerAddress, entrypoint: data.entrypoint as string, calldata },
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

  const sourceLabel = (pf: PreflightResult | null) => {
    if (!pf) return "—";
    const w = pf.warnings.find((w) => w.startsWith("Preflight source:"));
    return w?.match(/source: (\w+)/)?.[1] ?? "—";
  };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <AppNavbar />
      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Swap</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Trade privately on your favorite protocols · Ekubo + AVNU smart routing
            </p>
          </div>

          {/* Swap card */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-5">
            {/* Token In */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">You Pay</label>
              <div className="flex gap-3">
                <select
                  value={tokenIn.symbol}
                  onChange={(e) => {
                    const t = TOKENS.find((t) => t.symbol === e.target.value);
                    if (t) setTokenIn(t);
                  }}
                  className="w-28 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm font-medium text-white focus:border-emerald-500/50 focus:outline-none"
                >
                  {TOKENS.map((t) => (
                    <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={amountIn}
                  onChange={(e) => setAmountIn(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-right text-lg font-mono text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </div>
            </div>

            {/* Flip */}
            <div className="flex justify-center">
              <button
                onClick={flipTokens}
                className="rounded-full border border-zinc-700 bg-zinc-800 p-2 text-zinc-400 transition-all hover:border-zinc-600 hover:text-white hover:rotate-180"
              >
                <ArrowDownUp className="h-4 w-4" />
              </button>
            </div>

            {/* Token Out */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">You Receive</label>
              <div className="flex gap-3">
                <select
                  value={tokenOut.symbol}
                  onChange={(e) => {
                    const t = TOKENS.find((t) => t.symbol === e.target.value);
                    if (t) setTokenOut(t);
                  }}
                  className="w-28 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm font-medium text-white focus:border-emerald-500/50 focus:outline-none"
                >
                  {TOKENS.map((t) => (
                    <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                  ))}
                </select>
                <div className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-right text-lg font-mono text-zinc-400">
                  {preflight ? `$${preflight.expected_out_usd.toFixed(4)}` : "—"}
                </div>
              </div>
            </div>

            {/* Venue routing selector */}
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <ArrowRightLeft className="h-3 w-3" />
                Swap Routing
              </label>
              <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
                {(["best", "ekubo", "avnu"] as VenuePref[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVenuePref(v)}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      venuePref === v
                        ? "bg-cyan-600/20 text-cyan-300 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    {v === "best" ? "Best Route" : v === "ekubo" ? "Ekubo Direct" : "AVNU Aggregator"}
                  </button>
                ))}
              </div>
            </div>

            {/* Slippage */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Slippage tolerance</span>
              <div className="flex items-center gap-1">
                {[30, 50, 100, 300].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => setSlippageBps(bps)}
                    className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                      slippageBps === bps
                        ? "bg-zinc-700 text-white"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleQuote}
                disabled={preflightLoading || !amountIn || parseFloat(amountIn) <= 0}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-zinc-700 px-4 py-3 font-medium text-white transition-colors hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {preflightLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Quoting…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Get Quote
                  </>
                )}
              </button>
              {isConnected ? (
                <button
                  onClick={handleSwap}
                  disabled={swapStep !== "idle" || !preflight?.can_submit}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-3 font-semibold text-white transition-all hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {swapStep === "building" || swapStep === "signing" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {swapStep === "signing" ? "Sign in wallet…" : "Building…"}
                    </>
                  ) : swapStep === "done" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Done
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Swap
                    </>
                  )}
                </button>
              ) : (
                <ConnectButton />
              )}
            </div>

            {txHash && (
              <div className="flex items-center justify-center gap-4">
                <a
                  href={sepoliaStarkscanTxUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
                >
                  View on Starkscan <ExternalLink className="h-4 w-4" />
                </a>
                <a
                  href="/archive"
                  className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300"
                >
                  Receipt Archive <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            )}
          </div>

          {/* Venue comparison card */}
          {(preflight || comparingVenues) && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                <ArrowRightLeft className="h-4 w-4 text-cyan-400" />
                Route Comparison
                {comparingVenues && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Ekubo */}
                <div className={`rounded-xl border p-4 space-y-2 ${
                  sourceLabel(preflight) === "EKUBO" && venuePref === "best"
                    ? "border-emerald-500/30 bg-emerald-950/10"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-cyan-400">Ekubo</span>
                    {sourceLabel(preflight) === "EKUBO" && venuePref === "best" && (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">BEST</span>
                    )}
                  </div>
                  {ekuboQuote ? (
                    <>
                      <div className="text-lg font-mono font-semibold text-white">
                        ${ekuboQuote.expected_out_usd.toFixed(4)}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                        <span>Impact: <span className={ekuboQuote.impact_bps > 100 ? "text-amber-400" : "text-emerald-400"}>{(ekuboQuote.impact_bps / 100).toFixed(2)}%</span></span>
                        <span>{ekuboQuote.can_submit ? <CheckCircle2 className="inline h-3 w-3 text-emerald-500" /> : <AlertTriangle className="inline h-3 w-3 text-rose-500" />}</span>
                      </div>
                      {ekuboQuote.liquidity_depth_usd != null && (
                        <div className="text-[10px] text-zinc-600">Depth: ${ekuboQuote.liquidity_depth_usd.toFixed(2)}</div>
                      )}
                    </>
                  ) : comparingVenues ? (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                  ) : (
                    <span className="text-xs text-zinc-600">No quote</span>
                  )}
                </div>

                {/* AVNU */}
                <div className={`rounded-xl border p-4 space-y-2 ${
                  sourceLabel(preflight) === "AVNU" && venuePref === "best"
                    ? "border-emerald-500/30 bg-emerald-950/10"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-violet-400">AVNU</span>
                    {sourceLabel(preflight) === "AVNU" && venuePref === "best" && (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">BEST</span>
                    )}
                  </div>
                  {avnuQuote ? (
                    <>
                      <div className="text-lg font-mono font-semibold text-white">
                        ${avnuQuote.expected_out_usd.toFixed(4)}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                        <span>Impact: <span className={avnuQuote.impact_bps > 100 ? "text-amber-400" : "text-emerald-400"}>{(avnuQuote.impact_bps / 100).toFixed(2)}%</span></span>
                        <span>{avnuQuote.can_submit ? <CheckCircle2 className="inline h-3 w-3 text-emerald-500" /> : <AlertTriangle className="inline h-3 w-3 text-rose-500" />}</span>
                      </div>
                      {avnuQuote.liquidity_depth_usd != null && (
                        <div className="text-[10px] text-zinc-600">Depth: ${avnuQuote.liquidity_depth_usd.toFixed(2)}</div>
                      )}
                    </>
                  ) : comparingVenues ? (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                  ) : (
                    <span className="text-xs text-zinc-600">No quote</span>
                  )}
                </div>
              </div>

              {/* Preflight details */}
              {preflight && (
                <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Selected Route</span>
                    <span className="font-medium text-cyan-400">{sourceLabel(preflight)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Expected Out (USD)</span>
                    <span className="font-mono text-white">${preflight.expected_out_usd.toFixed(6)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Price Impact</span>
                    <span className={`font-mono ${preflight.impact_bps > 100 ? "text-amber-400" : "text-emerald-400"}`}>
                      {(preflight.impact_bps / 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Max Safe Input</span>
                    <span className="font-mono text-zinc-300">{formatWei(preflight.max_safe_input_raw, tokenIn.decimals, 6)} {tokenIn.symbol}</span>
                  </div>
                  {preflight.warnings.filter((w) => !w.startsWith("Preflight source:")).map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-500/80">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {w}
                    </div>
                  ))}
                  {preflight.blocking_reasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-rose-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {r}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Info */}
          <div className="text-center text-[10px] text-zinc-600 space-y-1">
            <p>Sepolia Testnet · Ekubo Router V3.0.13 + AVNU Aggregator</p>
            <p>zkde.fi by Obsqra Labs · Infra by Obsqra</p>
          </div>
        </div>
      </main>
    </div>
  );
}
