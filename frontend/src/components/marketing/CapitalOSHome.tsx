"use client";

import {
  Shield,
  Wallet,
  Fingerprint,
  Layers,
  Activity,
  Lock,
  Copy,
  CheckCircle2,
  Brain,
  Eye,
  Cpu,
} from "lucide-react";
import { useState } from "react";

/* ─── types ────────────────────────────────────────────────────────── */

export interface L3Identity {
  wallet_address: string;
  l3_address: string;
  session_id: string;
  session_created_at: string;
  fico_score?: number;
  fico_tier?: string;
  credit_class?: string;
  credit_confidence?: number;
  defi_veteran_score?: number;
  recommended_tier?: number;
  tier_reasoning?: string;
  profile_hash?: string;
  ezkl_ready?: boolean;
}

interface CapitalOSHomeProps {
  identity: L3Identity;
  sessionValue?: number;
  sessionPnl?: number;
  sessionPnlPct?: number;
  positionCount?: number;
  proofCount?: number;
  snapshotCount?: number;
}

/* ─── helpers ──────────────────────────────────────────────────────── */

function truncAddr(addr: string, chars = 6): string {
  if (!addr) return "";
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}

const TIER_LABELS: Record<number, { label: string; color: string; border: string }> = {
  1: { label: "Tier 1 — Observer", color: "text-zinc-400", border: "border-zinc-600" },
  2: { label: "Tier 2 — Participant", color: "text-cyan-400", border: "border-cyan-600" },
  3: { label: "Tier 3 — Operator", color: "text-emerald-400", border: "border-emerald-600" },
  4: { label: "Tier 4 — Strategist", color: "text-amber-400", border: "border-amber-600" },
  5: { label: "Tier 5 — Architect", color: "text-violet-400", border: "border-violet-600" },
};

const CREDIT_COLORS: Record<string, string> = {
  AAA: "text-emerald-400",
  AA: "text-cyan-400",
  A: "text-blue-400",
  B: "text-amber-400",
  C: "text-rose-400",
};

/* ─── component ────────────────────────────────────────────────────── */

export function CapitalOSHome({
  identity,
  sessionValue = 0,
  sessionPnl = 0,
  sessionPnlPct = 0,
  positionCount = 0,
  proofCount = 0,
  snapshotCount = 0,
}: CapitalOSHomeProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const tier = TIER_LABELS[identity.recommended_tier ?? 1] ?? TIER_LABELS[1];
  const creditColor = CREDIT_COLORS[identity.credit_class ?? "C"] ?? "text-zinc-400";

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
      {/* ── Dark header bar — identity + credit ── */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/95 to-zinc-950 px-5 py-4 border-b border-zinc-800/50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: avatar + addresses */}
          <div className="flex items-center gap-3">
            {/* Identity ring */}
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-emerald-500/30 bg-zinc-900">
              <Fingerprint className="h-6 w-6 text-emerald-400" />
              {identity.ezkl_ready && (
                <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500">
                  <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                </div>
              )}
            </div>

            <div className="space-y-0.5">
              {/* L1/L2 wallet */}
              <div className="flex items-center gap-1.5">
                <Wallet className="h-3 w-3 text-zinc-500" />
                <span className="font-mono text-xs text-zinc-400">
                  {truncAddr(identity.wallet_address)}
                </span>
                <button
                  onClick={() => copyToClipboard(identity.wallet_address, "wallet")}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  {copiedField === "wallet" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
                <span className="text-[9px] text-zinc-600">L2</span>
              </div>

              {/* L3 address */}
              <div className="flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-cyan-500/60" />
                <span className="font-mono text-xs text-cyan-400/80">
                  {truncAddr(identity.l3_address)}
                </span>
                <button
                  onClick={() => copyToClipboard(identity.l3_address, "l3")}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  {copiedField === "l3" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
                <span className="text-[9px] text-cyan-600">L3</span>
              </div>

              {/* Session ID */}
              <div className="flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-zinc-600" />
                <span className="font-mono text-[10px] text-zinc-600">
                  {identity.session_id}
                </span>
              </div>
            </div>
          </div>

          {/* Right: FICO + credit badge */}
          <div className="flex items-center gap-4">
            {/* FICO score */}
            {identity.fico_score != null && identity.fico_score > 0 && (
              <div className="text-center">
                <p className={`text-2xl font-bold tabular-nums ${
                  identity.fico_score >= 750 ? "text-emerald-400" :
                  identity.fico_score >= 670 ? "text-cyan-400" :
                  identity.fico_score >= 580 ? "text-amber-400" : "text-rose-400"
                }`}>
                  {identity.fico_score}
                </p>
                <p className="text-[9px] text-zinc-600">FICO</p>
              </div>
            )}

            {/* Credit class */}
            {identity.credit_class && (
              <div className="text-center">
                <p className={`text-2xl font-bold ${creditColor}`}>
                  {identity.credit_class}
                </p>
                <p className="text-[9px] text-zinc-600">Credit</p>
              </div>
            )}

            {/* Tier badge */}
            <div className={`rounded-lg border ${tier.border} bg-zinc-900/50 px-3 py-1.5`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${tier.color}`}>
                {tier.label}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Balance + stats row ── */}
      <div className="grid grid-cols-2 gap-px bg-zinc-800/30 sm:grid-cols-4">
        {/* Balance */}
        <div className="bg-zinc-950/80 px-4 py-3 text-center">
          <p className="text-lg font-bold text-zinc-100 tabular-nums">
            ${sessionValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[9px] text-zinc-600">Paper Balance</p>
        </div>

        {/* PnL */}
        <div className="bg-zinc-950/80 px-4 py-3 text-center">
          <p className={`text-lg font-bold tabular-nums ${
            sessionPnl >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}>
            {sessionPnl >= 0 ? "+" : ""}${sessionPnl.toFixed(2)}
            <span className="ml-1 text-xs font-normal">
              ({sessionPnlPct >= 0 ? "+" : ""}{sessionPnlPct.toFixed(2)}%)
            </span>
          </p>
          <p className="text-[9px] text-zinc-600">P&amp;L</p>
        </div>

        {/* Positions */}
        <div className="bg-zinc-950/80 px-4 py-3 text-center">
          <p className="text-lg font-bold text-zinc-300 tabular-nums">{positionCount}</p>
          <p className="text-[9px] text-zinc-600">Positions</p>
        </div>

        {/* Proofs / Snapshots */}
        <div className="bg-zinc-950/80 px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-3">
            <div>
              <p className="text-lg font-bold text-violet-400 tabular-nums">{proofCount}</p>
              <p className="text-[9px] text-zinc-600">Proofs</p>
            </div>
            <div className="h-6 w-px bg-zinc-800" />
            <div>
              <p className="text-lg font-bold text-cyan-400 tabular-nums">{snapshotCount}</p>
              <p className="text-[9px] text-zinc-600">Snapshots</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Capability badges row ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-zinc-800/30">
        <span className="text-[9px] text-zinc-600 mr-1">Surfaces:</span>
        {[
          { icon: Brain, label: "AI Brain", color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20" },
          { icon: Shield, label: "Reputation", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
          { icon: Activity, label: "Intelligent Stream", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
          { icon: Lock, label: "Dark Vault", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
          { icon: Eye, label: "ZK Proofs", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20" },
          { icon: Cpu, label: "Browser ML", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
        ].map(({ icon: Icon, label, color, bg, border }) => (
          <span
            key={label}
            className={`inline-flex items-center gap-1 rounded-full border ${border} ${bg} px-2 py-0.5 text-[9px] font-medium ${color}`}
          >
            <Icon className="h-2.5 w-2.5" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
