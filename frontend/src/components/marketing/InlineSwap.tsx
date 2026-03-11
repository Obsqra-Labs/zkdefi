"use client";

import { useState, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import {
  ArrowDownUp,
  ArrowRightLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ExternalLink,
} from "lucide-react";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { toastSuccess, toastError } from "@/lib/toast";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";
import { API_BASE } from "@/lib/api/client";

/* ── tokens ── */
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

/* ═══════════════════ component ═══════════════════ */

interface InlineSwapProps {
  /** Venue routing preference from the brain panel */
  venuePref?: VenuePref;
}

export function InlineSwap({ venuePref: parentVenue = "best" }: InlineSwapProps) {
  const { address, account, isConnected } = useAccount();

  const [tokenIn, setTokenIn] = useState(TOKENS[0]);
  const [tokenOut, setTokenOut] = useState(TOKENS[1]);
  const [amountIn, setAmountIn] = useState("0.1");
  const [slippageBps] = useState(50);
  const [venue, setVenue] = useState<VenuePref>(parentVenue);

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [ekuboQuote, setEkuboQuote] = useState<PreflightResult | null>(null);
  const [avnuQuote, setAvnuQuote] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);

  const [swapStep, setSwapStep] = useState<"idle" | "building" | "signing" | "done">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  const amountInWei = useCallback(() => {
    try {
      const n = parseFloat(amountIn);
      if (!Number.isFinite(n) || n <= 0) return "0";
      return BigInt(Math.round(n * 10 ** tokenIn.decimals)).toString();
    } catch {
      return "0";
    }
  }, [amountIn, tokenIn]);

  const flipTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setPreflight(null);
    setEkuboQuote(null);
    setAvnuQuote(null);
  };

  const fetchPreflight = useCallback(
    async (v: VenuePref) => {
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
            venue_pref: v,
            user_address: address ?? "0xdemo",
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) return (await res.json()) as PreflightResult;
      } catch {
        /* fallthrough */
      }
      return null;
    },
    [amountInWei, tokenIn, tokenOut, slippageBps, address],
  );

  const handleQuote = async () => {
    setLoading(true);
    setPreflight(null);
    setEkuboQuote(null);
    setAvnuQuote(null);
    setTxHash(null);
    setSwapStep("idle");
    try {
      const main = await fetchPreflight(venue);
      setPreflight(main);
      setComparing(true);
      const [ek, av] = await Promise.all([fetchPreflight("ekubo"), fetchPreflight("avnu")]);
      setEkuboQuote(ek);
      setAvnuQuote(av);
    } finally {
      setLoading(false);
      setComparing(false);
    }
  };

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
      toastSuccess("Swap submitted!");
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
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <ArrowRightLeft className="h-3 w-3" />
          Quick Swap
        </div>
        <div className="flex gap-0.5 rounded-md border border-zinc-800 overflow-hidden">
          {(["best", "ekubo", "avnu"] as VenuePref[]).map((v) => (
            <button
              key={v}
              onClick={() => setVenue(v)}
              className={`px-2 py-0.5 text-[9px] font-medium transition-colors ${
                venue === v ? "bg-cyan-600/20 text-cyan-300" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {v === "best" ? "Best" : v === "ekubo" ? "Ekubo" : "AVNU"}
            </button>
          ))}
        </div>
      </div>

      {/* Swap row */}
      <div className="flex items-center gap-2">
        <select
          value={tokenIn.symbol}
          onChange={(e) => {
            const t = TOKENS.find((tk) => tk.symbol === e.target.value);
            if (t) setTokenIn(t);
          }}
          className="w-20 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] font-medium text-white focus:border-emerald-500/50 focus:outline-none"
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
          className="w-20 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-right text-[11px] font-mono text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
        />
        <button
          onClick={flipTokens}
          className="rounded-full border border-zinc-700 bg-zinc-800 p-1 text-zinc-500 transition-all hover:text-white hover:rotate-180"
        >
          <ArrowDownUp className="h-3 w-3" />
        </button>
        <select
          value={tokenOut.symbol}
          onChange={(e) => {
            const t = TOKENS.find((tk) => tk.symbol === e.target.value);
            if (t) setTokenOut(t);
          }}
          className="w-20 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] font-medium text-white focus:border-emerald-500/50 focus:outline-none"
        >
          {TOKENS.map((t) => (
            <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
          ))}
        </select>
        <div className="flex-1 text-right font-mono text-[11px] text-zinc-400">
          {preflight ? `$${preflight.expected_out_usd.toFixed(4)}` : "—"}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleQuote}
          disabled={loading || !amountIn || parseFloat(amountIn) <= 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-700 px-3 py-2 text-[10px] font-medium text-white transition-colors hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {loading ? "Quoting…" : "Quote"}
        </button>
        {isConnected ? (
          <button
            onClick={handleSwap}
            disabled={swapStep !== "idle" || !preflight?.can_submit}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 px-3 py-2 text-[10px] font-semibold text-white transition-all hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {swapStep === "building" || swapStep === "signing" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {swapStep === "signing" ? "Sign…" : "Build…"}
              </>
            ) : swapStep === "done" ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Done
              </>
            ) : (
              <>
                <Zap className="h-3 w-3" />
                Swap
              </>
            )}
          </button>
        ) : (
          <div className="flex-1">
            <ConnectButton />
          </div>
        )}
      </div>

      {/* Venue comparison (compact) */}
      {(preflight || comparing) && (
        <div className="grid grid-cols-2 gap-2">
          <VenueCard
            label="Ekubo"
            quote={ekuboQuote}
            isBest={sourceLabel(preflight) === "EKUBO" && venue === "best"}
            loading={comparing && !ekuboQuote}
            color="text-cyan-400"
          />
          <VenueCard
            label="AVNU"
            quote={avnuQuote}
            isBest={sourceLabel(preflight) === "AVNU" && venue === "best"}
            loading={comparing && !avnuQuote}
            color="text-violet-400"
          />
        </div>
      )}

      {/* Tx link */}
      {txHash && (
        <a
          href={sepoliaStarkscanTxUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-[10px] text-emerald-400 hover:text-emerald-300"
        >
          View on Starkscan <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/* ── Venue card ── */

function VenueCard({
  label,
  quote,
  isBest,
  loading,
  color,
}: {
  label: string;
  quote: PreflightResult | null;
  isBest: boolean;
  loading: boolean;
  color: string;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 space-y-1 ${
        isBest ? "border-emerald-500/30 bg-emerald-950/10" : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold ${color}`}>{label}</span>
        {isBest && (
          <span className="rounded-full bg-emerald-500/15 px-1 py-0.5 text-[8px] font-bold text-emerald-400">
            BEST
          </span>
        )}
      </div>
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
      ) : quote ? (
        <>
          <div className="font-mono text-[11px] font-semibold text-white">
            ${quote.expected_out_usd.toFixed(4)}
          </div>
          <div className="flex items-center gap-2 text-[9px] text-zinc-500">
            <span>
              Impact:{" "}
              <span className={quote.impact_bps > 100 ? "text-amber-400" : "text-emerald-400"}>
                {(quote.impact_bps / 100).toFixed(2)}%
              </span>
            </span>
            {quote.can_submit ? (
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-2.5 w-2.5 text-rose-500" />
            )}
          </div>
        </>
      ) : (
        <span className="text-[10px] text-zinc-600">—</span>
      )}
    </div>
  );
}
