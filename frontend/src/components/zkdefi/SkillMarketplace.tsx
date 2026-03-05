"use client";

/**
 * SkillMarketplace — Browse and inspect available ZK circuit skills.
 *
 * Grid display of all skills from the agent-builder API, grouped by category.
 * Each card shows circuit readiness, tier requirements, and parameter schema.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Layers,
  Shield,
  Zap,
  TrendingUp,
  Lock,
  CheckCircle,
  XCircle,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Search,
  Cpu,
} from "lucide-react";

import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Skill {
  skill_id: string;
  name: string;
  description: string;
  category: string;
  circuit_name: string;
  parameters: Record<string, unknown>;
  requires_tier: number;
  circuit_ready: boolean;
}

function normalizeSkill(input: unknown): Skill {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    skill_id: String(row.skill_id ?? ""),
    name: String(row.name ?? row.skill_id ?? "Unknown Skill"),
    description: String(row.description ?? ""),
    category: String(row.category ?? "other"),
    circuit_name: String(row.circuit_name ?? "unknown"),
    parameters:
      row.parameters && typeof row.parameters === "object" && !Array.isArray(row.parameters)
        ? (row.parameters as Record<string, unknown>)
        : {},
    requires_tier: Number.isFinite(Number(row.requires_tier)) ? Number(row.requires_tier) : 0,
    circuit_ready: Boolean(row.circuit_ready),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  agent_skill: {
    icon: <Zap className="w-4 h-4" />,
    label: "Agent Skills",
    color: "amber",
  },
  agent_identity: {
    icon: <Shield className="w-4 h-4" />,
    label: "Identity & Reputation",
    color: "blue",
  },
  ml_scoring: {
    icon: <TrendingUp className="w-4 h-4" />,
    label: "ML Scoring",
    color: "emerald",
  },
  merkle_privacy: {
    icon: <Lock className="w-4 h-4" />,
    label: "Privacy Proofs",
    color: "purple",
  },
  reputation: {
    icon: <Shield className="w-4 h-4" />,
    label: "Reputation",
    color: "cyan",
  },
  strategy_integrity: {
    icon: <Layers className="w-4 h-4" />,
    label: "Strategy Integrity",
    color: "indigo",
  },
  execution_quality: {
    icon: <Cpu className="w-4 h-4" />,
    label: "Execution Quality",
    color: "rose",
  },
};

function getCategoryColor(category: string): string {
  return CATEGORY_CONFIG[category]?.color || "gray";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillMarketplace({
  onSkillSelect,
}: {
  onSkillSelect?: (skillId: string) => void;
}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("");
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/agent-builder/skills`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setSkills((Array.isArray(data?.skills) ? data.skills : []).map((entry: unknown) => normalizeSkill(entry)));
    } catch {
      setError(true);
      setSkills([
        { skill_id: "il_predictor", name: "IL Predictor", description: "Predict impermanent loss with ZK-verified sqrt approximation", category: "agent_skill", circuit_name: "ImpermanentLossPredictor", parameters: { token0_reserve: "uint", token1_reserve: "uint", new_price_ratio: "uint", position_value: "uint" }, requires_tier: 0, circuit_ready: false },
        { skill_id: "yield_optimality", name: "Yield Optimality", description: "Verify yield allocation is optimal across N pools", category: "agent_skill", circuit_name: "YieldOptimality", parameters: { pool_yields: "uint[8]", weights: "uint[8]", total_allocation: "uint" }, requires_tier: 0, circuit_ready: false },
        { skill_id: "slippage_bound", name: "Slippage Bound", description: "Prove trade slippage stays within bound", category: "agent_skill", circuit_name: "SlippageBound", parameters: { trade_amount: "uint", current_liquidity: "uint", price_impact_coefficient: "uint" }, requires_tier: 0, circuit_ready: false },
        { skill_id: "reputation_check", name: "Reputation Score", description: "Compute and prove agent reputation score 0-1000", category: "agent_identity", circuit_name: "AgentReputationScore", parameters: { total_volume: "uint", successful_trades: "uint", failed_trades: "uint", cumulative_return: "uint" }, requires_tier: 0, circuit_ready: false },
        { skill_id: "arb_check", name: "Arbitrage Check", description: "Verify cross-protocol price arbitrage profitability", category: "agent_skill", circuit_name: "CrossProtocolArbitrage", parameters: { source_price: "uint", dest_price: "uint", fee_bps: "uint", gas_cost_scaled: "uint" }, requires_tier: 1, circuit_ready: false },
        { skill_id: "liquidation_check", name: "Liquidation Risk", description: "Check health factor across N lending positions", category: "agent_skill", circuit_name: "LiquidationRisk", parameters: { collateral_values: "uint[8]", debt_values: "uint[8]", liq_thresholds: "uint[8]" }, requires_tier: 0, circuit_ready: false },
        { skill_id: "performance_attestation", name: "Performance Attestation", description: "Prove historical mean return and max drawdown", category: "agent_identity", circuit_name: "HistoricalPerformanceAttestation", parameters: { period_returns: "int[12]", period_balances: "uint[12]", initial_balance: "uint" }, requires_tier: 1, circuit_ready: false },
        { skill_id: "mev_protection", name: "MEV Resistance", description: "Prove transaction was protected from MEV extraction", category: "agent_skill", circuit_name: "MEVResistanceProof", parameters: { submit_block: "uint", execute_block: "uint", expected_price: "uint", execution_price: "uint" }, requires_tier: 0, circuit_ready: false },
        { skill_id: "risk_score", name: "Risk Score", description: "ML-based portfolio risk scoring circuit", category: "ml_scoring", circuit_name: "CairoPerceptron", parameters: { portfolio_features: "uint[5]" }, requires_tier: 0, circuit_ready: true },
        { skill_id: "anomaly_detection", name: "Anomaly Detection", description: "Pool anomaly detection via ML circuit", category: "ml_scoring", circuit_name: "AnomalyDetector", parameters: { pool_metrics: "uint[8]" }, requires_tier: 0, circuit_ready: false },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const filteredSkills = skills.filter(
    (s) =>
      !filter ||
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.category.toLowerCase().includes(filter.toLowerCase()) ||
      s.description.toLowerCase().includes(filter.toLowerCase())
  );

  const grouped = filteredSkills.reduce<Record<string, Skill[]>>((acc, s) => {
    const cat = s.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const readyCount = skills.filter((s) => s.circuit_ready).length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-purple-400" />
          <h3 className="text-sm font-semibold text-white">Skill Marketplace</h3>
          <span className="text-[10px] text-white/30">
            {readyCount}/{skills.length} ready
          </span>
        </div>
        <button onClick={fetchSkills} className="text-white/30 hover:text-white/60">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="text-[10px] text-amber-400/60 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> Demo data — API unavailable
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
        <input
          type="text"
          placeholder="Filter skills…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/20 focus:border-[#00FFD1]/30 focus:outline-none"
        />
      </div>

      {/* Grouped skills */}
      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
        {Object.entries(grouped).map(([category, catSkills]) => {
          const cfg = CATEGORY_CONFIG[category] || {
            icon: <Cpu className="w-4 h-4" />,
            label: category,
            color: "gray",
          };
          return (
            <div key={category}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-${cfg.color}-400`}>{cfg.icon}</span>
                <span className="text-xs font-medium text-white/50">{cfg.label}</span>
                <span className="text-[10px] text-white/20 ml-auto">{catSkills.length}</span>
              </div>

              <div className="space-y-1.5">
                {catSkills.map((skill) => (
                  <div key={skill.skill_id} className="rounded-lg border border-white/5 bg-white/[0.02]">
                    <button
                      className="w-full text-left px-3 py-2.5 flex items-center justify-between"
                      onClick={() =>
                        setExpandedSkill(expandedSkill === skill.skill_id ? null : skill.skill_id)
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {skill.circuit_ready ? (
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-white/20 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white truncate">
                            {skill.name}
                          </div>
                          <div className="text-[10px] text-white/30 truncate">
                            {skill.description}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {skill.requires_tier > 0 && (
                          <span className="text-[10px] text-amber-400/60 whitespace-nowrap">
                            Tier {skill.requires_tier}+
                          </span>
                        )}
                        {expandedSkill === skill.skill_id ? (
                          <ChevronUp className="w-3 h-3 text-white/20" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-white/20" />
                        )}
                      </div>
                    </button>

                    {expandedSkill === skill.skill_id && (
                      <div className="px-3 pb-3 pt-0 space-y-2">
                        <div className="text-[10px] text-white/30">
                          Circuit: <span className="text-white/50 font-mono">{skill.circuit_name}</span>
                        </div>
                        {Object.keys(skill.parameters || {}).length > 0 && (
                          <div>
                            <div className="text-[10px] text-white/30 mb-1">Parameters:</div>
                            <div className="space-y-0.5">
                              {Object.entries(skill.parameters || {}).map(([key, type]) => (
                                <div
                                  key={key}
                                  className="flex items-center gap-2 text-[10px] px-2 py-1 rounded bg-white/[0.03]"
                                >
                                  <span className="text-white/50 font-mono">{key}</span>
                                  <span className="text-white/20">:</span>
                                  <span className="text-[#00FFD1]/40 font-mono">{String(type)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => onSkillSelect?.(skill.skill_id)}
                          className="w-full py-1.5 rounded text-[10px] border border-[#00FFD1]/20 text-[#00FFD1]/60 hover:bg-[#00FFD1]/5 hover:text-[#00FFD1]"
                        >
                          Add to Agent
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
