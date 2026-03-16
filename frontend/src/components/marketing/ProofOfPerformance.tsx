"use client";

import { useState, useCallback } from "react";
import {
  ShieldCheck,
  Fingerprint,
  TrendingUp,
  Wallet,
  BarChart3,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

type ProveType = "pnl_positive" | "apy_above" | "capital_preserved";

interface ProofReceipt {
  proof: string;
  claim: string;
  valid: boolean;
  prove_type: string;
  breakdown: Record<string, unknown>;
  public_inputs: string[];
  private_witness_summary: Record<string, unknown>;
  nullifier: string;
  timestamp: number;
}

interface ProofOfPerformanceProps {
  walletAddress: string;
  sessionId: string;
  onProofGenerated?: () => void;
}

/* ─── static config ────────────────────────────────────────────────── */

const PROVE_OPTIONS: { type: ProveType; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "pnl_positive", label: "Positive P&L", desc: "P&L ≥ 0", icon: TrendingUp },
  { type: "apy_above", label: "APY Above", desc: "APY above threshold", icon: BarChart3 },
  { type: "capital_preserved", label: "Capital Preserved", desc: "No capital loss", icon: Wallet },
];

/* ─── component ────────────────────────────────────────────────────── */

export function ProofOfPerformance({
  walletAddress,
  sessionId,
  onProofGenerated,
}: ProofOfPerformanceProps) {
  const [proveType, setProveType] = useState<ProveType>("pnl_positive");
  const [threshold, setThreshold] = useState("");
  const [receipt, setReceipt] = useState<ProofReceipt | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const generate = useCallback(async () => {
    setError(null);
    setIsGenerating(true);
    setReceipt(null);
    try {
      const body: Record<string, unknown> = {
        wallet_address: walletAddress,
        session_id: sessionId,
        prove_type: proveType,
      };
      if (proveType === "apy_above" && threshold) {
        body.threshold = parseFloat(threshold);
      }
      const res = await apiFetch<ProofReceipt>("/api/v1/demo/proof-of-performance", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 15_000,
      });
      setReceipt(res);
      onProofGenerated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Proof generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [walletAddress, sessionId, proveType, threshold, onProofGenerated]);

  const copyHash = () => {
    if (!receipt) return;
    navigator.clipboard.writeText(receipt.proof);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 1500);
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/50">
        <Fingerprint className="h-4 w-4 text-fuchsia-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-fuchsia-400">
          ZK Proof of Performance
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Prove type selector */}
        <div className="grid grid-cols-3 gap-2">
          {PROVE_OPTIONS.map(({ type, label, desc, icon: Icon }) => (
            <button
              key={type}
              onClick={() => { setProveType(type); setReceipt(null); }}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-all ${
                proveType === type
                  ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[10px] font-semibold">{label}</span>
              <span className="text-[8px] opacity-60">{desc}</span>
            </button>
          ))}
        </div>

        {/* Threshold input (only for apy_above) */}
        {proveType === "apy_above" && (
          <div className="flex items-center gap-2">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
              Threshold APY (%)
            </label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="5.0"
              min={0}
              step={0.5}
              className="w-24 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-fuchsia-500/50"
            />
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={generate}
          disabled={isGenerating}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-2.5 text-xs font-semibold text-fuchsia-400 transition-all hover:border-fuchsia-400 hover:bg-fuchsia-500/20 disabled:opacity-50"
        >
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {isGenerating ? "Generating ZK proof…" : "Generate Proof"}
        </button>

        {error && <p className="text-[10px] text-rose-400">{error}</p>}

        {/* Proof receipt */}
        {receipt && (
          <div className="space-y-2 rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-3">
            {/* Validity badge */}
            <div className="flex items-center gap-2">
              {receipt.valid ? (
                <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Verified
                </div>
              ) : (
                <div className="flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-semibold text-rose-400">
                  <XCircle className="h-3 w-3" />
                  Invalid
                </div>
              )}
              <span className="text-[10px] text-zinc-500">{receipt.claim}</span>
            </div>

            {/* Proof hash */}
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600 mb-0.5">Proof Hash</p>
              <div className="flex items-center gap-1">
                <span className="font-mono text-[9px] text-zinc-500 break-all leading-relaxed">
                  {receipt.proof?.slice(0, 42) ?? "—"}…
                </span>
                <button onClick={copyHash} className="text-zinc-600 hover:text-zinc-400 shrink-0">
                  {copiedHash ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                </button>
              </div>
            </div>

            {/* Public inputs */}
            {receipt.public_inputs?.length > 0 && (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">
                  Public Inputs
                </p>
                <div className="flex flex-wrap gap-1">
                  {receipt.public_inputs.map((inp, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[8px] text-zinc-500"
                    >
                      {inp}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Nullifier */}
            <div className="flex items-center gap-1 pt-0.5 border-t border-zinc-800/30 mt-1">
              <Fingerprint className="h-2.5 w-2.5 text-zinc-700" />
              <span className="font-mono text-[8px] text-zinc-600">
                nullifier: {receipt.nullifier?.slice(0, 18) ?? "—"}…
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
