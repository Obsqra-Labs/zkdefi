"use client";

/**
 * Dashboard — aggregated AI, proof, and protocol status overview.
 *
 * Displays:
 * - LLM provider status (Onyx / OpenAI gpt-4o-mini)
 * - Credit grade from XGBoost model
 * - Circuit readiness summary
 * - Recent proof receipts
 * - Quick links to Brain / Vault / Trade surfaces
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Brain,
  Shield,
  Cpu,
  Sparkles,
  FileCheck,
  Activity,
  ArrowRight,
  Wallet,
} from "lucide-react";
import { useAccount } from "@starknet-react/core";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { LLMProviderHealth } from "@/components/zkdefi/LLMProviderHealth";
import { ProofTimeline, type ProofReceipt } from "@/components/zkdefi/ProofTimeline";
import { API_BASE } from "@/lib/api/client";

interface ZkmlStatus {
  circuits_available: number;
  circuits_ready: number;
  proof_system: string;
  verifier: string;
}

interface PredictiveCredit {
  grade: string;
  grade_confidence: number;
  model_name: string;
  model_hash: string | null;
  proof_hash: string | null;
  credit_line_eth: number;
  max_ltv: number;
  rate_bps: number;
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-cyan-400";
  if (grade.startsWith("C")) return "text-amber-400";
  return "text-orange-400";
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [zkml, setZkml] = useState<ZkmlStatus | null>(null);
  const [credit, setCredit] = useState<PredictiveCredit | null>(null);
  const [receipts, setReceipts] = useState<ProofReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;

    (async () => {
      setLoading(true);

      // Fetch zkML status (no auth needed)
      try {
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/zkml/status`, { signal: AbortSignal.timeout(5000) });
        if (res.ok && !dead) setZkml(await res.json());
      } catch { /* best effort */ }

      // Fetch credit + receipts only if connected
      if (address) {
        try {
          const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_profile/v2/${address}`, { signal: AbortSignal.timeout(8000) });
          if (res.ok && !dead) {
            const data = await res.json();
            if (data?.predictive_credit) setCredit(data.predictive_credit);
          }
        } catch { /* best effort */ }

        try {
          const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_passport/user/${address}`, { signal: AbortSignal.timeout(8000) });
          if (res.ok && !dead) {
            const data = await res.json();
            setReceipts(Array.isArray(data?.proof_receipts) ? data.proof_receipts.slice(0, 5) : []);
          }
        } catch { /* best effort */ }
      }

      if (!dead) setLoading(false);
    })();

    return () => { dead = true; };
  }, [address]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Activity className="w-7 h-7 text-emerald-400" />
              Dashboard
            </h1>
            <p className="text-sm text-zinc-500 mt-1">AI + zkML engine overview</p>
          </div>
          <ConnectButton />
        </div>

        {!isConnected && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <Wallet className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-zinc-300 mb-2">Connect Wallet</h2>
            <p className="text-sm text-zinc-500 max-w-md mx-auto">
              Connect your wallet to see your AI credit grade, proof history, and full protocol status.
            </p>
          </div>
        )}

        {/* Top stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Credit Grade */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="w-4 h-4 text-violet-400" />
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">AI Credit Grade</p>
            </div>
            {credit ? (
              <>
                <p className={`text-3xl font-bold ${gradeColor(credit.grade)}`}>{credit.grade}</p>
                <p className="text-[10px] text-zinc-500 mt-1">
                  {Math.round(credit.grade_confidence * 100)}% confidence · {credit.model_name}
                </p>
              </>
            ) : (
              <p className="text-xl font-bold text-zinc-600">{loading ? "…" : "—"}</p>
            )}
          </div>

          {/* Circuits */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">zkML Circuits</p>
            </div>
            {zkml ? (
              <>
                <p className="text-3xl font-bold text-cyan-400">{zkml.circuits_ready}/{zkml.circuits_available}</p>
                <p className="text-[10px] text-zinc-500 mt-1">ready · {zkml.proof_system} · {zkml.verifier}</p>
              </>
            ) : (
              <p className="text-xl font-bold text-zinc-600">{loading ? "…" : "—"}</p>
            )}
          </div>

          {/* Credit Line */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Credit Line</p>
            </div>
            {credit ? (
              <>
                <p className="text-3xl font-bold text-white">{credit.credit_line_eth.toFixed(3)}</p>
                <p className="text-[10px] text-zinc-500 mt-1">ETH · LTV {Math.round(credit.max_ltv * 100)}%</p>
              </>
            ) : (
              <p className="text-xl font-bold text-zinc-600">{loading ? "…" : "—"}</p>
            )}
          </div>

          {/* Proof Receipts */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <FileCheck className="w-4 h-4 text-emerald-400" />
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Proof Receipts</p>
            </div>
            <p className="text-3xl font-bold text-emerald-400">{receipts.length}</p>
            <p className="text-[10px] text-zinc-500 mt-1">recent verifications</p>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: LLM Provider Health + Proof receipts */}
          <div className="lg:col-span-2 space-y-6">
            <LLMProviderHealth />

            {receipts.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-400" />
                  Recent Proof Receipts
                </h3>
                <ProofTimeline receipts={receipts} />
              </div>
            )}
          </div>

          {/* Right: Quick links */}
          <div className="space-y-4">
            {[
              { label: "Vault", desc: "Deposits, lending, yield", href: "/agent?v=vault", icon: Shield, color: "text-emerald-400" },
              { label: "Trade", desc: "Swap, LP, staking", href: "/agent?v=trade", icon: Activity, color: "text-cyan-400" },
              { label: "Brain", desc: "Agent, zkML, pipeline", href: "/agent?v=brain", icon: Brain, color: "text-violet-400" },
            ].map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-700 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <link.icon className={`w-5 h-5 ${link.color}`} />
                  <div>
                    <p className="text-sm font-medium text-white">{link.label}</p>
                    <p className="text-[10px] text-zinc-500">{link.desc}</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              </Link>
            ))}

            {/* EZKL proof hash */}
            {credit?.proof_hash && (
              <div className="rounded-xl border border-green-800/30 bg-green-950/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-green-400" />
                  <p className="text-xs font-medium text-green-300">EZKL Credit Proof</p>
                </div>
                <p className="text-[10px] font-mono text-zinc-400 break-all" title={credit.proof_hash}>
                  {credit.proof_hash}
                </p>
              </div>
            )}

            {/* Model hash */}
            {credit?.model_hash && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                <p className="text-[10px] text-zinc-500 mb-1">Model Hash</p>
                <p className="text-[10px] font-mono text-zinc-400 break-all">{credit.model_hash}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
