"use client";

import { useEffect, useState } from "react";
import { Shield, CheckCircle2 } from "lucide-react";
import type { ReputationData } from "./ReputationProfile";

/* ── tier display helpers ── */
const TIER_LABELS: Record<number, string> = {
  1: "Observer",
  2: "Participant",
  3: "Operator",
  4: "Strategist",
  5: "Architect",
};
const TIER_COLORS: Record<number, string> = {
  1: "text-zinc-400 border-zinc-600",
  2: "text-cyan-400 border-cyan-600",
  3: "text-violet-400 border-violet-600",
  4: "text-fuchsia-400 border-fuchsia-600",
  5: "text-amber-400 border-amber-600",
};

interface IdentityCardProps {
  data: ReputationData;
}

/**
 * Compact identity card with staggered reveal animation (~600ms total).
 * Shows: tier → FICO score → credential hash → verified badge.
 * Used in the Loop demo Step 1 after the user clicks "Try as guest".
 */
export function IdentityCard({ data }: IdentityCardProps) {
  const [revealStage, setRevealStage] = useState(0);

  useEffect(() => {
    // 4-stage reveal: 0→1 (tier) → 2 (score) → 3 (hash) → 4 (verified)
    const timers = [
      setTimeout(() => setRevealStage(1), 80),
      setTimeout(() => setRevealStage(2), 250),
      setTimeout(() => setRevealStage(3), 420),
      setTimeout(() => setRevealStage(4), 600),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const tier = data.recommended_tier ?? 3;
  const tierLabel = TIER_LABELS[tier] ?? `Tier ${tier}`;
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS[3];

  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      {/* Row 1 — Tier badge */}
      <div
        className="transition-all duration-300"
        style={{
          opacity: revealStage >= 1 ? 1 : 0,
          transform: revealStage >= 1 ? "translateY(0)" : "translateY(8px)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500/10">
            <Shield className="h-4.5 w-4.5 text-fuchsia-400" />
          </div>
          <div>
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold ${tierColor}`}
            >
              {tierLabel}
            </span>
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
              {data.account_type} · {data.protocol_count} protocols · {data.position_count} positions
            </p>
          </div>
        </div>
      </div>

      {/* Row 2 — FICO score + credit class */}
      <div
        className="mt-4 transition-all duration-300"
        style={{
          opacity: revealStage >= 2 ? 1 : 0,
          transform: revealStage >= 2 ? "translateY(0)" : "translateY(8px)",
        }}
      >
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-2xl font-bold text-zinc-100">
            {data.fico_score ?? "—"}
          </span>
          <span className="font-mono text-xs text-zinc-500">
            FICO · {data.fico_tier ?? "—"}
          </span>
          {data.credit_class && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
              Class {data.credit_class}
            </span>
          )}
        </div>
        <div className="mt-2 flex gap-1">
          {[
            { label: "Conviction", value: data.conviction_score },
            { label: "Activity", value: data.activity_score },
            { label: "Diversity", value: data.diversity_score },
            { label: "Capital", value: data.capital_score },
            { label: "Resilience", value: data.resilience_score },
          ].map((s) => (
            <div key={s.label} className="flex-1">
              <div className="h-1 rounded-full bg-zinc-800">
                <div
                  className="h-1 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-500 transition-all duration-500"
                  style={{ width: `${Math.round((s.value ?? 0) * 100)}%` }}
                />
              </div>
              <p className="mt-0.5 text-center font-mono text-[8px] text-zinc-600">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Row 3 — Credential hash */}
      <div
        className="mt-4 transition-all duration-300"
        style={{
          opacity: revealStage >= 3 ? 1 : 0,
          transform: revealStage >= 3 ? "translateY(0)" : "translateY(8px)",
        }}
      >
        <div className="flex items-center gap-2 rounded-lg bg-zinc-950/60 px-3 py-2">
          <span className="font-mono text-[10px] text-zinc-600">Profile hash</span>
          <code className="font-mono text-[11px] text-zinc-400">
            {data.profile_hash}
          </code>
        </div>
      </div>

      {/* Row 4 — Verified badge */}
      <div
        className="mt-3 transition-all duration-300"
        style={{
          opacity: revealStage >= 4 ? 1 : 0,
          transform: revealStage >= 4 ? "translateY(0)" : "translateY(8px)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-mono text-[10px] font-semibold text-emerald-400">
            Identity verified · ZK proof attached
          </span>
        </div>
      </div>
    </div>
  );
}
