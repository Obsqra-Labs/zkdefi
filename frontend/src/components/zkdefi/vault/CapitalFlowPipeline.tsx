"use client";

import { Wallet, Shield, Lock, BarChart3, TrendingUp, PieChart } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CapitalFlowPipelineProps {
  walletBalance: string;
  shieldedBalance: string;
  deployedBalance: string;
  idleBalance: string;
  activeNode?: "wallet" | "shield" | "vault" | "strategies";
  /** Live Ekubo position count */
  ekuboPositionCount?: number;
  /** Live Ekubo positions total USD */
  ekuboTotalUsd?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtEth(v: string): string {
  const n = parseFloat(v || "0");
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CapitalFlowPipeline({
  walletBalance,
  shieldedBalance,
  deployedBalance,
  idleBalance,
  ekuboPositionCount = 0,
  ekuboTotalUsd = 0,
}: CapitalFlowPipelineProps) {
  const wallet = parseFloat(walletBalance || "0");
  const shielded = parseFloat(shieldedBalance || "0");
  const deployed = parseFloat(deployedBalance || "0");
  const idle = parseFloat(idleBalance || "0");
  const total = wallet + shielded + deployed + idle;

  // Allocation bar segments
  const segments = [
    { label: "Wallet",     value: wallet,   color: "bg-zinc-500",    text: "text-zinc-400" },
    { label: "Shielded",   value: shielded, color: "bg-amber-400",   text: "text-amber-400" },
    { label: "Deployed",   value: deployed, color: "bg-emerald-400", text: "text-emerald-400" },
    { label: "Idle",       value: idle,     color: "bg-zinc-700",    text: "text-zinc-500" },
  ].filter((s) => s.value > 0);

  const cards: { icon: typeof Wallet; label: string; value: string; sub?: string; accent: string; bgAccent: string }[] = [
    {
      icon: Wallet,
      label: "Wallet",
      value: `${fmtEth(walletBalance)} ETH`,
      accent: "text-zinc-300",
      bgAccent: "bg-zinc-800/60",
    },
    {
      icon: Shield,
      label: "Shielded",
      value: `${fmtEth(shieldedBalance)} ETH`,
      sub: "Privacy pool",
      accent: "text-amber-400",
      bgAccent: "bg-amber-500/10",
    },
    {
      icon: BarChart3,
      label: "Deployed",
      value: `${fmtEth(deployedBalance)} ETH`,
      sub: ekuboPositionCount > 0 ? `${ekuboPositionCount} positions` : undefined,
      accent: "text-emerald-400",
      bgAccent: "bg-emerald-500/10",
    },
    {
      icon: Lock,
      label: "Idle",
      value: `${fmtEth(idleBalance)} ETH`,
      sub: "Awaiting deployment",
      accent: "text-zinc-500",
      bgAccent: "bg-zinc-800/40",
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border border-white/[0.06] ${c.bgAccent} p-3.5 flex flex-col gap-1`}
          >
            <div className="flex items-center gap-2 mb-1">
              <c.icon size={14} className={c.accent} />
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">{c.label}</span>
            </div>
            <span className={`text-sm font-semibold ${c.accent}`}>{c.value}</span>
            {c.sub && <span className="text-[10px] text-zinc-600">{c.sub}</span>}
          </div>
        ))}
      </div>

      {/* ── Allocation Bar ── */}
      {total > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <PieChart size={12} />
              <span className="uppercase tracking-wider font-medium">Allocation</span>
            </div>
            {ekuboTotalUsd > 0 && (
              <span className="text-[11px] text-emerald-400/80 flex items-center gap-1">
                <TrendingUp size={10} />
                Ekubo LP {fmtUsd(ekuboTotalUsd)}
              </span>
            )}
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-800/60">
            {segments.map((s) => (
              <div
                key={s.label}
                className={`${s.color} transition-all first:rounded-l-full last:rounded-r-full`}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <span className={`inline-block w-2 h-2 rounded-full ${s.color}`} />
                <span>{s.label}</span>
                <span className="text-zinc-600">{((s.value / total) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
