"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  AlertTriangle,
  TrendingUp,
  Zap,
  ShieldCheck,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { RiskProfileV2 } from "@/hooks/useProfile";
import { getCapitalRiskProfile } from "@/lib/trust/riskProfile";

interface AgentInsightsStripProps {
  address: string | undefined;
  onAction?: (action: string) => void;
}

interface RiskScoreResponse {
  is_compliant: boolean;
  risk_score?: number;
}

interface Opportunity {
  id: string;
  name: string;
  apy_bps: number;
  risk_level: string;
  venue: string;
}

interface OpportunitiesResponse {
  opportunities: Opportunity[];
}

interface Insight {
  icon: React.ElementType;
  color: string;
  text: string;
  action: string;
}

const MAX_VISIBLE = 3;
const POLL_MS = 30_000;

function buildInsights(
  risk: RiskScoreResponse | null,
  opps: OpportunitiesResponse | null,
): Insight[] {
  const out: Insight[] = [];

  if (risk) {
    const score = risk.risk_score ?? 0;
    if (!risk.is_compliant || score > 60) {
      out.push({
        icon: AlertTriangle,
        color: "text-amber-400",
        text: `Risk elevated — portfolio score ${score}`,
        action: "investigate",
      });
    } else if (risk.is_compliant && score <= 30) {
      out.push({
        icon: ShieldCheck,
        color: "text-emerald-400",
        text: `Risk healthy — score ${score}/100`,
        action: "review",
      });
    }
  }

  if (opps?.opportunities?.length) {
    const sorted = [...opps.opportunities].sort(
      (a, b) => b.apy_bps - a.apy_bps,
    );
    const top = sorted[0];
    const apy = (top.apy_bps / 100).toFixed(1);
    out.push({
      icon: TrendingUp,
      color: "text-cyan-400",
      text: `${top.name} yielding ${apy}% APY`,
      action: "deploy",
    });

    if (sorted.length > 1 && sorted[1].apy_bps > 500) {
      const second = sorted[1];
      const secondApy = (second.apy_bps / 100).toFixed(1);
      out.push({
        icon: Zap,
        color: "text-amber-400",
        text: `High yield: ${second.name} at ${secondApy}%`,
        action: "deploy",
      });
    }
  }

  return out.slice(0, MAX_VISIBLE);
}

export function AgentInsightsStrip({
  address,
  onAction,
}: AgentInsightsStripProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!address) {
      setInsights([]);
      setLoading(false);
      return;
    }

    try {
      const profile = await apiFetch<RiskProfileV2>(`/api/v1/zkdefi/risk_profile/v2/${address}`, {
        method: "GET",
      }).catch(() => null);
      const riskProfile = getCapitalRiskProfile(profile);

      const [risk, opps] = await Promise.all([
        apiFetch<RiskScoreResponse>("/api/v1/zkdefi/zkml/risk_score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: address,
            portfolio_features: [10, 20, 15, 30, 10, 25, 12, 18],
          }),
        }).catch(() => null),
        apiFetch<OpportunitiesResponse>("/api/v1/strategies/opportunities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: address,
            risk_profile: riskProfile,
            limit: 5,
          }),
        }).catch(() => null),
      ]);

      setInsights(buildInsights(risk, opps));
    } catch {
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const t = setInterval(fetchData, POLL_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  return (
    <section className="rounded-lg border border-zinc-800 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Brain className="w-4 h-4 text-zinc-400" />
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Agent Insights
        </h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
        </div>
      ) : insights.length === 0 ? (
        <p className="text-xs text-zinc-500 text-center py-2">
          No insights available
        </p>
      ) : (
        <div className="space-y-2">
          {insights.map((ins, i) => {
            const Icon = ins.icon;
            return (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${ins.color}`} />
                <span
                  className="flex-1 text-xs text-zinc-300 truncate"
                  title={ins.text}
                >
                  {ins.text}
                </span>
                <button
                  onClick={() => onAction?.(ins.action)}
                  className="flex-shrink-0 text-[10px] px-2 py-1 border border-zinc-700 rounded text-zinc-300 hover:bg-zinc-700 transition-colors capitalize"
                >
                  {ins.action}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => onAction?.("open_zkrag")}
        className="text-[10px] text-cyan-400 hover:text-cyan-300 mt-2 block text-center w-full"
      >
        See all
      </button>
    </section>
  );
}
