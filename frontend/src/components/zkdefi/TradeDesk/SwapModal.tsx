"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { X, ArrowDownLeft, Loader2, Zap, ExternalLink, CheckCircle } from "lucide-react";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";
import { tradeDeskApi } from "@/services/TradeDeskApiService";
import { toastSuccess, toastError } from "@/lib/toast";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";

interface SwapModalProps {
  open: boolean;
  onClose: () => void;
  /** All swap-type opportunities (used for pair list and execute) */
  swapOpportunities: UnifiedOpportunity[];
  userAddress: string | null;
  onExecute: (prepared: unknown) => void;
  /** When opening from a swap card, pre-select this pair (e.g. "ETH/USDC") */
  preselectedPair?: string | null;
}

const SLIPPAGE_OPTIONS = [0.5, 1, 2];

function formatUsd(n: number | unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0.00";
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

export function SwapModal({
  open,
  onClose,
  swapOpportunities,
  userAddress,
  onExecute,
  preselectedPair = null,
}: SwapModalProps) {
  const { account } = useAccount();
  const [selectedPair, setSelectedPair] = useState<string>(preselectedPair ?? "");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [simulation, setSimulation] = useState<{
    estimatedYield: number;
    priceImpact: number;
    gasEstimate: number;
    fees: number;
    netResult: number;
  } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const pairs = useMemo(() => {
    const set = new Set(swapOpportunities.map((o) => o.pair).filter(Boolean));
    return Array.from(set).sort();
  }, [swapOpportunities]);

  const selectedOpportunity = useMemo(
    () => swapOpportunities.find((o) => o.pair === selectedPair) ?? null,
    [swapOpportunities, selectedPair],
  );

  const resetForm = useCallback(() => {
    setAmount("");
    setSimulation(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  useEffect(() => {
    if (open && preselectedPair && pairs.includes(preselectedPair)) {
      setSelectedPair(preselectedPair);
    }
  }, [open, preselectedPair, pairs]);

  const handleSimulate = useCallback(async () => {
    if (!userAddress || !amount || !selectedOpportunity) return;
    setSimulating(true);
    setError(null);
    setSimulation(null);
    try {
      const result = await tradeDeskApi.simulate({
        opportunityId: selectedOpportunity.id,
        amount: parseFloat(amount),
        userAddress,
      });
      setSimulation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }, [userAddress, amount, selectedOpportunity]);

  const handleExecute = useCallback(async () => {
    if (!account || !userAddress || !amount || !selectedOpportunity) return;
    setExecuting(true);
    setError(null);
    setTxHash(null);
    try {
      // 1. Get prepared calldata from backend
      const prepared = await tradeDeskApi.prepare({
        opportunityId: selectedOpportunity.id,
        amount: parseFloat(amount),
        params: { slippage_bps: slippage * 100 },
        userAddress,
      });

      // 2. Build multicall with approve + execute via wallet
      const contractAddress = (prepared as any).contractAddress as `0x${string}`;
      const calldata = ((prepared as any).calldata as string[]).map((c: string) => c);
      const entryPoint = (prepared as any).entryPoint as string;

      if (!contractAddress || !calldata.length) {
        throw new Error("Backend returned empty calldata — swap may not be supported for this pair yet");
      }

      // Build approve call for the input token
      // Parse pair to get input token address from opportunity metadata
      const tokenIn = selectedOpportunity.metadata?.tokenIn || selectedOpportunity.pair?.split("/")[0];
      const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18));
      const u256Mask = (BigInt(1) << BigInt(128)) - BigInt(1);
      const amountLow = (amountWei & u256Mask).toString();
      const amountHigh = (amountWei >> BigInt(128)).toString();

      // If we have a token address for approval, do approve + swap multicall
      // Otherwise just do the single call
      const calls: { contractAddress: string; entrypoint: string; calldata: string[] }[] = [];

      const tokenInStr = typeof tokenIn === "string" ? tokenIn : undefined;
      if (tokenInStr && tokenInStr.startsWith("0x")) {
        calls.push({
          contractAddress: tokenIn as `0x${string}`,
          entrypoint: "approve",
          calldata: [contractAddress, amountLow, amountHigh],
        });
      }

      calls.push({
        contractAddress,
        entrypoint: entryPoint || "swap",
        calldata,
      });

      // 3. Sign + submit via wallet
      const result = await account.execute(calls);
      const hash = result.transaction_hash;
      setTxHash(hash);

      toastSuccess("Swap submitted!", {
        action: {
          label: "View on Starkscan",
          onClick: () => window.open(sepoliaStarkscanTxUrl(hash), "_blank"),
        },
      });

      // Notify parent
      onExecute({ txHash: hash, type: "swap", pair: selectedPair, amount: parseFloat(amount) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Swap failed";
      setError(msg);
      toastError(msg);
    } finally {
      setExecuting(false);
    }
  }, [account, userAddress, amount, slippage, selectedOpportunity, selectedPair, onExecute]);

  if (!open) return null;

  const amountNum = parseFloat(amount);
  const isValidAmount = !isNaN(amountNum) && amountNum > 0;
  const canExecute = isValidAmount && selectedOpportunity && account && userAddress && !executing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden
      />
      <div
        className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 id="swap-modal-title" className="text-lg font-semibold text-slate-100">
            Swap
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Success state */}
          {txHash && (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
              <h3 className="text-lg font-semibold text-emerald-400">Swap Submitted</h3>
              <a
                href={sepoliaStarkscanTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                View on Starkscan <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <p className="text-xs text-slate-500 font-mono break-all px-4">{txHash}</p>
              <button
                type="button"
                onClick={() => { setTxHash(null); resetForm(); }}
                className="mt-2 px-4 py-2 rounded-lg text-sm bg-slate-700 hover:bg-slate-600 transition-colors"
              >
                New Swap
              </button>
            </div>
          )}

          {!txHash && (
            <>
          {/* Token pair selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Token pair
            </label>
            <select
              value={selectedPair}
              onChange={(e) => {
                setSelectedPair(e.target.value);
                setSimulation(null);
                setError(null);
              }}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">Select pair</option>
              {pairs.map((pair) => (
                <option key={pair} value={pair}>
                  {pair}
                </option>
              ))}
            </select>
            {selectedOpportunity && (
              <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                <span>TVL {formatUsd(selectedOpportunity.tvlUsd)}</span>
                <span>·</span>
                <span>{selectedOpportunity.protocol}</span>
              </div>
            )}
          </div>

          {/* Amount in */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Amount in
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setSimulation(null);
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-600 bg-slate-800 text-slate-100 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              {selectedPair && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  {selectedPair.split("/")[0]}
                </span>
              )}
            </div>
          </div>

          {/* Estimated out (simplified: show simulation summary if available) */}
          {simulation && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 space-y-1 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Price impact</span>
                <span className="text-amber-400">{Number(simulation.priceImpact).toFixed(3)}%</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Est. gas</span>
                <span>{formatUsd(simulation.gasEstimate)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Fees</span>
                <span>{formatUsd(simulation.fees)}</span>
              </div>
              <div className="flex justify-between text-slate-300 font-medium pt-1 border-t border-slate-700">
                <span>Net result</span>
                <span className={simulation.netResult >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {simulation.netResult >= 0 ? "+" : ""}{formatUsd(simulation.netResult)}
                </span>
              </div>
            </div>
          )}

          {/* Slippage */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Slippage tolerance
            </label>
            <div className="flex gap-2">
              {SLIPPAGE_OPTIONS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setSlippage(pct)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    slippage === pct
                      ? "bg-cyan-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-600"
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded-lg border border-red-800">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleSimulate}
              disabled={!isValidAmount || !selectedOpportunity || simulating}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-slate-200"
            >
              {simulating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowDownLeft className="w-4 h-4" />
              )}
              Simulate
            </button>
            <button
              type="button"
              onClick={handleExecute}
              disabled={!canExecute}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
            >
              {executing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {!account ? "Connect Wallet" : "Swap"}
            </button>
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
