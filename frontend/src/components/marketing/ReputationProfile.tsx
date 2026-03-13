"use client";

import {
  Shield,
  Flame,
  Heart,
  Zap,
  BarChart3,
  Layers,
  Diamond,
  User,
  Activity,
  Crown,
  TrendingUp,
  Wallet,
} from "lucide-react";

/* ─── types ─────────────────────────────────────────────────────────── */

interface BehavioralSignal {
  signal: string;
  value: number;
  label: string;
  evidence: string;
  category: string;
}

export interface ReputationData {
  wallet_address: string;
  scanned_at: string;
  account_type: string;
  nonce: number;
  account_exists: boolean;
  is_contract_deployer: boolean;
  total_capital_usd: number;
  capital_by_protocol: Record<string, number>;
  protocol_count: number;
  position_count: number;
  signals: BehavioralSignal[];
  defi_veteran_score: number;
  conviction_score: number;
  activity_score: number;
  diversity_score: number;
  capital_score: number;
  resilience_score: number;
  recommended_tier: number;
  tier_reasoning: string;
  profile_hash: string;
  scan_duration_ms: number;
  errors: string[];
  // Credit scoring (FICO pack)
  fico_score?: number;
  fico_tier?: string;
  credit_class?: string;
  credit_class_index?: number;
  credit_confidence?: number;
  credit_features?: Record<string, number>;
  credit_feature_hash?: string;
  credit_model_hash?: string;
  credit_circuit_version?: string;
  ezkl_ready?: boolean;
}

/* ─── helpers ───────────────────────────────────────────────────────── */

const SIGNAL_ICONS: Record<string, typeof Shield> = {
  power_user: Crown,
  active_user: Activity,
  regular_user: User,
  new_user: User,
  whale: Diamond,
  substantial_capital: TrendingUp,
  modest_capital: Wallet,
  diversified: Layers,
  concentrated: Flame,
  defi_native: Zap,
  defi_experienced: BarChart3,
  diamond_hands: Diamond,
  balanced_deployer: Shield,
  staker: Heart,
  liquidity_provider: Layers,
  market_survivor: Shield,
  rug_survivor: Flame,
  custom_contract: Zap,
  argent_user: User,
  braavos_user: User,
  oz_account: Zap,
  multisig: Shield,
  vesu_user: TrendingUp,
  endur_staker: Heart,
  nostra_user: BarChart3,
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  experience:  { bg: "bg-cyan-500/10",    text: "text-cyan-400",    border: "border-cyan-500/20" },
  capital:     { bg: "bg-emerald-500/10",  text: "text-emerald-400",  border: "border-emerald-500/20" },
  conviction:  { bg: "bg-violet-500/10",   text: "text-violet-400",   border: "border-violet-500/20" },
  resilience:  { bg: "bg-amber-500/10",    text: "text-amber-400",    border: "border-amber-500/20" },
  governance:  { bg: "bg-rose-500/10",     text: "text-rose-400",     border: "border-rose-500/20" },
};

const TIER_STYLES: Record<number, { label: string; color: string; bg: string; border: string }> = {
  1: { label: "Tier 1 — Explorer",    color: "text-zinc-400",    bg: "bg-zinc-500/10",    border: "border-zinc-500/20" },
  2: { label: "Tier 2 — Operator",    color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20" },
  3: { label: "Tier 3 — Veteran",     color: "text-emerald-400", bg: "bg-emerald-500/10",  border: "border-emerald-500/20" },
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  argent_v1: "Argent V1",
  "argent_v0.3": "Argent V0.3",
  argent_new: "Argent",
  argent_multisig: "Argent Multisig",
  braavos: "Braavos",
  braavos_base: "Braavos",
  openzeppelin: "OpenZeppelin",
  openzeppelin_c1: "OpenZeppelin (Cairo 1)",
  custom: "Custom Contract",
  unknown: "Unknown",
};

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  if (score >= 20) return "text-cyan-400";
  return "text-zinc-500";
}

function scoreBarColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  if (score >= 20) return "bg-cyan-500";
  return "bg-zinc-600";
}

/* ─── ScoreBar ──────────────────────────────────────────────────────── */

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-medium text-zinc-400">{label}</span>
        <span className={`font-bold ${scoreColor(score)}`}>{score}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-700 ${scoreBarColor(score)}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
    </div>
  );
}

/* ─── main component ────────────────────────────────────────────────── */

export function ReputationProfile({ data }: { data: ReputationData }) {
  const tier = TIER_STYLES[data.recommended_tier] ?? TIER_STYLES[1];
  const accountLabel = ACCOUNT_TYPE_LABELS[data.account_type] ?? data.account_type;
  const hasFico = data.fico_score != null && data.fico_score > 0;

  // Sort signals by value descending, take top 6
  const topSignals = [...data.signals]
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* ── Header: Tier badge + account summary ── */}
      <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border ${tier.border} ${tier.bg} px-6 py-4`}>
        <div className="flex items-center gap-4">
          {/* Veteran score ring */}
          <div className="relative flex h-16 w-16 items-center justify-center">
            <svg className="absolute h-16 w-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3"
                className="text-zinc-800" />
              <circle cx="32" cy="32" r="28" fill="none" strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(data.defi_veteran_score / 100) * 175.9} 175.9`}
                className={scoreColor(data.defi_veteran_score)}
              />
            </svg>
            <span className={`text-lg font-bold ${scoreColor(data.defi_veteran_score)}`}>
              {data.defi_veteran_score}
            </span>
          </div>

          <div>
            <p className={`text-xs font-bold uppercase tracking-wider ${tier.color}`}>
              {tier.label}
            </p>
            <p className="text-[10px] text-zinc-500">{data.tier_reasoning}</p>
            <p className="mt-1 text-[10px] text-zinc-600">
              {accountLabel} · {data.nonce.toLocaleString()} txns
              {data.is_contract_deployer && (
                <span className="ml-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-400">
                  Deployer
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">DeFi Veteran Score</p>
          <p className={`mt-0.5 text-2xl font-bold ${scoreColor(data.defi_veteran_score)}`}>
            {data.defi_veteran_score}<span className="text-sm text-zinc-500">/100</span>
          </p>
        </div>
      </div>

      {/* ── FICO Credit Score + Circuit Status ── */}
      {hasFico && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* FICO Score */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">FICO Score</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${
                (data.fico_score ?? 0) >= 750 ? "text-emerald-400" :
                (data.fico_score ?? 0) >= 670 ? "text-cyan-400" :
                (data.fico_score ?? 0) >= 580 ? "text-amber-400" : "text-red-400"
              }`}>
                {data.fico_score}
              </span>
              <span className="text-xs text-zinc-500">/ 850</span>
            </div>
            <p className={`mt-1 text-[10px] font-medium uppercase tracking-wider ${
              data.fico_tier === "excellent" ? "text-emerald-400" :
              data.fico_tier === "good" ? "text-cyan-400" :
              data.fico_tier === "fair" ? "text-amber-400" : "text-red-400"
            }`}>
              {data.fico_tier}
            </p>
          </div>

          {/* Credit Class */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Credit Class</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${
                data.credit_class === "AAA" ? "text-emerald-400" :
                data.credit_class === "AA" ? "text-cyan-400" :
                data.credit_class === "A" ? "text-blue-400" :
                data.credit_class === "B" ? "text-amber-400" : "text-red-400"
              }`}>
                {data.credit_class}
              </span>
              <span className="text-xs text-zinc-500">
                {((data.credit_confidence ?? 0) * 100).toFixed(0)}% conf
              </span>
            </div>
            <p className="mt-1 text-[10px] text-zinc-600">
              MLP {data.credit_circuit_version?.replace("creditworthiness_", "")}
            </p>
          </div>

          {/* Circuit Status */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">ZK Circuit</p>
            <div className="mt-1 flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${data.ezkl_ready ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className={`text-sm font-bold ${data.ezkl_ready ? "text-emerald-400" : "text-amber-400"}`}>
                {data.ezkl_ready ? "Proof Ready" : "Inference Only"}
              </span>
            </div>
            <p className="mt-2 text-[10px] text-zinc-600">
              {data.ezkl_ready
                ? "EZKL Halo2 circuit compiled — can generate ZK proofs"
                : "MLP inference active — EZKL artifacts pending"}
            </p>
            {data.credit_feature_hash && (
              <p className="mt-1 font-mono text-[9px] text-zinc-700 truncate">
                feat: {data.credit_feature_hash.slice(0, 14)}…
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Score bars ── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-4 sm:grid-cols-5">
        <ScoreBar label="Activity" score={data.activity_score} />
        <ScoreBar label="Conviction" score={data.conviction_score} />
        <ScoreBar label="Diversity" score={data.diversity_score} />
        <ScoreBar label="Capital" score={data.capital_score} />
        <ScoreBar label="Resilience" score={data.resilience_score} />
      </div>

      {/* ── Behavioral signals ── */}
      {topSignals.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Behavioral Signals ({data.signals.length})
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topSignals.map((sig, i) => {
              const cat = CATEGORY_COLORS[sig.category] ?? CATEGORY_COLORS.experience;
              const Icon = SIGNAL_ICONS[sig.signal] ?? Shield;
              return (
                <div key={i} className={`rounded-lg border ${cat.border} ${cat.bg} px-4 py-3`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${cat.text}`} />
                    <span className={`text-xs font-bold ${cat.text}`}>{sig.label}</span>
                    <span className="ml-auto rounded-full bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                      {(sig.value * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                    {sig.evidence}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Capital by protocol ── */}
      {data.protocol_count > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-6 py-4">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Capital Distribution
          </h3>
          <div className="flex flex-wrap items-end gap-4">
            {Object.entries(data.capital_by_protocol)
              .sort(([, a], [, b]) => b - a)
              .map(([protocol, usd]) => {
                const pct = data.total_capital_usd > 0 ? (usd / data.total_capital_usd) * 100 : 0;
                return (
                  <div key={protocol} className="space-y-1 text-center">
                    <div className="mx-auto h-16 w-6 overflow-hidden rounded bg-zinc-800">
                      <div
                        className="w-full rounded bg-emerald-500/60 transition-all duration-500"
                        style={{ height: `${Math.max(pct, 4)}%`, marginTop: `${100 - Math.max(pct, 4)}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-medium capitalize text-zinc-300">{protocol}</p>
                    <p className="text-[10px] text-zinc-600">${(usd / 1000).toFixed(1)}k</p>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Profile hash (proof binding) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-2">
        <p className="text-[10px] text-zinc-600">
          Profile hash: <span className="font-mono text-zinc-500">{data.profile_hash?.slice(0, 18)}…</span>
        </p>
        {data.credit_model_hash && data.credit_model_hash !== "heuristic_fallback" && (
          <p className="text-[10px] text-zinc-600">
            Model: <span className="font-mono text-zinc-500">{data.credit_model_hash.slice(0, 12)}…</span>
          </p>
        )}
        <p className="text-[10px] text-zinc-600">
          Scanned in {data.scan_duration_ms.toFixed(0)}ms
        </p>
      </div>
    </div>
  );
}
