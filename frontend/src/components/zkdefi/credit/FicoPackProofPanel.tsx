"use client";
import { ProofGenomeCard, type ProofGenomeMeta } from "./ProofGenomeCard";
import { Shield, TrendingUp, Activity, Lock, Zap, Loader2, X } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/api/client";
import { toastSuccess, toastError } from "@/lib/toast";

interface FicoPackProofPanelProps {
  address: string;
}

export interface ProofStatusFromApi {
  proof_type: string;
  status: string;
  generated_at: number | null;
  proof_hash: string | null;
  on_chain_verified: boolean;
}

function buildSolvencyInputs(address: string) {
  return {
    user_address: address,
    asset_positions: [1000, 2000],
    debt_positions: [500],
    min_solvency_ratio_bps: 12000,
  };
}
function buildRiskPassportInputs(address: string) {
  return {
    user_address: address,
    volatility_bps: 800,
    max_drawdown_bps: 1500,
    concentration_bps: 3000,
    effective_leverage_bps: 5000,
    liquidation_events: 0,
    tenure_days: 30,
    required_tier: 3,
  };
}
function buildTraderPerformanceInputs(address: string) {
  const returns = Array(30).fill(50);
  const equity = returns.reduce<number[]>((acc, r, i) => [...acc, (acc[i - 1] ?? 10000) + r], []);
  return {
    user_address: address,
    returns_bps: returns,
    equity_curve: equity,
    wins_count: 18,
    trades_count: 30,
    min_sharpe_x100: 150,
    max_drawdown_bps: 2000,
    min_win_rate_bps: 5000,
  };
}
function buildStrategyIntegrityInputs(address: string) {
  return {
    user_address: address,
    position_weights_bps: [2000, 2000, 1500, 1500, 1000, 1000, 500, 500],
    effective_leverage_bps: 10000,
    observed_slippage_bps: [20, 30, 10, 15, 25, 20, 10, 10],
    asset_exposures_bps: [2000, 2000, 1500, 1500, 1000, 1000, 500, 500],
    max_position_weight_bps: 2500,
    max_leverage_bps: 20000,
    max_slippage_bps: 100,
  };
}
function buildExecutionIntegrityInputs(address: string) {
  return {
    user_address: address,
    submission_block: 1000,
    inclusion_block: 1003,
    expected_price: 2000,
    actual_price: 1995,
    max_delay_blocks: 5,
    max_price_deviation_bps: 50,
  };
}

const FICO_PROOFS: {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string;
  buildInputs: (address: string) => Record<string, unknown>;
  perks: string[];
  genome: ProofGenomeMeta;
}[] = [
  {
    id: "solvency",
    title: "Solvency Proof",
    description: "Proves assets ≥ liabilities without revealing positions",
    icon: <Shield className="w-5 h-5 text-blue-400" />,
    endpoint: "/api/v1/zkdefi/reputation/proof/solvency",
    buildInputs: buildSolvencyInputs,
    perks: [
      "Unlock higher credit line (1.2x multiplier)",
      "Qualify for unsecured lending",
      "Reduced liquidation penalty",
    ],
    genome: {
      formula: "total_assets ≥ total_liabilities  ∧  solvency_ratio_bps ≥ min_solvency_ratio_bps",
      constraints: [
        "sum_assets = Σ asset_positions[i]",
        "sum_liabilities = Σ debt_positions[j]",
        "solvency_ratio_bps = (sum_assets × scale) / max(1, sum_liabilities)",
      ],
      inputsRequired: [
        { name: "asset_positions[]", description: "Scaled asset amounts" },
        { name: "debt_positions[]", description: "Scaled debt amounts" },
        { name: "min_solvency_ratio_bps", description: "Min ratio (e.g. 12000 = 120%)" },
      ],
      circuitId: "SolvencyProof",
      factType: "solvency",
      publicSignals: ["is_solvent", "solvency_ratio_bps_bucket"],
    },
  },
  {
    id: "risk_passport",
    title: "Risk Passport",
    description: "Verifies risk tier meets minimum threshold",
    icon: <TrendingUp className="w-5 h-5 text-emerald-400" />,
    endpoint: "/api/v1/zkdefi/reputation/proof/risk-passport",
    buildInputs: buildRiskPassportInputs,
    perks: [
      "Access to Express tier (Tier 2)",
      "Enable autonomous agents",
      "Priority protocol access",
    ],
    genome: {
      formula: "risk_tier ∈ [1..5]  ∧  risk_tier ≤ required_tier",
      constraints: [
        "Weighted score from volatility_bps, max_drawdown_bps, concentration_bps, leverage_bps",
        "Tier lookup via threshold comparisons",
      ],
      inputsRequired: [
        { name: "volatility_bps", description: "Portfolio volatility (bps)" },
        { name: "max_drawdown_bps", description: "Max drawdown (bps)" },
        { name: "concentration_bps", description: "Concentration (bps)" },
        { name: "effective_leverage_bps", description: "Leverage (bps)" },
        { name: "tenure_days", description: "Account tenure" },
        { name: "required_tier", description: "Target tier (1–5)" },
      ],
      circuitId: "RiskPassportTier",
      factType: "risk_passport",
      publicSignals: ["risk_tier", "is_within_required_tier"],
    },
  },
  {
    id: "trader_performance",
    title: "Trader Performance",
    description: "Attests to Sharpe, drawdown, and win rate over lookback",
    icon: <Activity className="w-5 h-5 text-purple-400" />,
    endpoint: "/api/v1/zkdefi/reputation/proof/performance",
    buildInputs: buildTraderPerformanceInputs,
    perks: [
      "Trading fee discount (0.5% → 0.3%)",
      "Access to leveraged strategies",
      "Higher position limits",
    ],
    genome: {
      formula: "meets_sharpe ∧ meets_drawdown ∧ meets_win_rate → performance_pass",
      constraints: [
        "sharpe_x100 = (mean_excess_return × 100) / max(1, stddev_proxy)",
        "Drawdown from equity_curve; win_rate = (wins_count × scale) / max(1, trades_count)",
      ],
      inputsRequired: [
        { name: "returns_bps[30]", description: "Daily returns (bps)" },
        { name: "equity_curve[30]", description: "Equity curve values" },
        { name: "min_sharpe_x100", description: "Min Sharpe (e.g. 150 = 1.5)" },
        { name: "max_drawdown_bps", description: "Max allowed drawdown (bps)" },
        { name: "min_win_rate_bps", description: "Min win rate (bps)" },
      ],
      circuitId: "TraderPerformanceProof",
      factType: "performance",
      publicSignals: ["meets_sharpe", "meets_drawdown", "meets_win_rate", "performance_pass"],
    },
  },
  {
    id: "strategy_integrity",
    title: "Strategy Integrity",
    description: "Proves strategy parameters meet mandate constraints",
    icon: <Lock className="w-5 h-5 text-amber-400" />,
    endpoint: "/api/v1/zkdefi/reputation/proof/strategy-integrity",
    buildInputs: buildStrategyIntegrityInputs,
    perks: [
      "Deploy custom strategies",
      "Higher gas limits",
      "Access to beta features",
    ],
    genome: {
      formula: "position_ok ∧ leverage_ok ∧ slippage_ok → strategy_compliant",
      constraints: [
        "max(position_weights_bps) ≤ max_position_weight_bps",
        "effective_leverage_bps ≤ max_leverage_bps",
        "max(observed_slippage_bps) ≤ max_slippage_bps",
      ],
      inputsRequired: [
        { name: "position_weights_bps[]", description: "Position weights (bps)" },
        { name: "effective_leverage_bps", description: "Leverage (bps)" },
        { name: "observed_slippage_bps[]", description: "Slippage per leg (bps)" },
        { name: "max_*_bps", description: "Policy bounds" },
      ],
      circuitId: "StrategyIntegrity",
      factType: "strategy_integrity",
      publicSignals: ["position_ok", "leverage_ok", "slippage_ok", "strategy_compliant"],
    },
  },
  {
    id: "execution_integrity",
    title: "Execution Integrity",
    description: "Verifies execution met delay and price-deviation bounds",
    icon: <Zap className="w-5 h-5 text-orange-400" />,
    endpoint: "/api/v1/zkdefi/reputation/proof/execution-integrity",
    buildInputs: buildExecutionIntegrityInputs,
    perks: [
      "Reduced relayer fees (50% off)",
      "Faster execution priority",
      "MEV protection active",
    ],
    genome: {
      formula: "delay_ok ∧ price_ok ∧ route_ok → execution_valid",
      constraints: [
        "delay = inclusion_block − submission_block ≤ max_delay_blocks",
        "deviation_bps = |actual_price − expected_price| × 10000 / expected_price ≤ max_price_deviation_bps",
      ],
      inputsRequired: [
        { name: "submission_block", description: "Block when order submitted" },
        { name: "inclusion_block", description: "Block when included" },
        { name: "expected_price", description: "Expected execution price" },
        { name: "actual_price", description: "Actual execution price" },
        { name: "max_delay_blocks", description: "Max blocks delay" },
        { name: "max_price_deviation_bps", description: "Max price deviation (bps)" },
      ],
      circuitId: "ExecutionIntegrity",
      factType: "execution_integrity",
      publicSignals: ["delay_ok", "price_ok", "route_ok", "execution_valid"],
    },
  },
];

export function FicoPackProofPanel({ address }: FicoPackProofPanelProps) {
  const [generatingProof, setGeneratingProof] = useState<string | null>(null);
  const [proofStatuses, setProofStatuses] = useState<Record<string, ProofStatusFromApi>>({});
  const [loading, setLoading] = useState(true);
  const [editModalProof, setEditModalProof] = useState<(typeof FICO_PROOFS)[number] | null>(null);
  const [editModalBody, setEditModalBody] = useState("");

  const fetchProofStatuses = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/reputation/proofs/${address}`);
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, ProofStatusFromApi> = {};
        data.proofs.forEach((p: ProofStatusFromApi) => {
          map[p.proof_type] = p;
        });
        setProofStatuses(map);
      }
    } catch (error) {
      console.error("Failed to fetch proof statuses:", error);
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    fetchProofStatuses().finally(() => setLoading(false));
  }, [address, fetchProofStatuses]);

  async function handleGenerateProof(proofId: string, endpoint: string, buildInputs: (address: string) => Record<string, unknown>) {
    setGeneratingProof(proofId);
    try {
      const body = buildInputs(address);
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data?.all_pass) {
        toastSuccess("Proof generated successfully");
        await fetchProofStatuses();
      } else {
        const msg = data?.detail || data?.results?.[0]?.error || "Proof generation failed";
        toastError(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
    } catch (error) {
      console.error("Proof generation error:", error);
      toastError("Request failed");
    } finally {
      setGeneratingProof(null);
    }
  }

  function openEditModal(proof: (typeof FICO_PROOFS)[number]) {
    setEditModalProof(proof);
    setEditModalBody(JSON.stringify(proof.buildInputs(address), null, 2));
  }

  async function handleGenerateFromModal() {
    if (!editModalProof) return;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(editModalBody) as Record<string, unknown>;
    } catch {
      toastError("Invalid JSON");
      return;
    }
    setGeneratingProof(editModalProof.id);
    try {
      const res = await fetch(`${API_BASE}${editModalProof.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data?.results?.[0]?.success) {
        await fetchProofStatuses();
        setEditModalProof(null);
        if (data?.all_pass) {
          toastSuccess("Proof generated successfully");
        } else {
          toastSuccess("Proof generated; constraints not met.");
        }
      } else {
        const msg = data?.detail || data?.results?.[0]?.error || "Proof generation failed";
        toastError(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
    } catch (error) {
      console.error("Proof generation error:", error);
      toastError("Request failed");
    } finally {
      setGeneratingProof(null);
    }
  }

  const completedCount = Object.values(proofStatuses).filter((p) => p?.status === "complete").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">FICO Pack Proofs</h3>
        <div className="text-sm text-zinc-500">
          {completedCount} / {FICO_PROOFS.length} Complete
        </div>
      </div>

      <div className="grid gap-4">
        {FICO_PROOFS.map((proof) => {
          const ps = proofStatuses[proof.id];
          const status = (ps?.status as "complete" | "pending" | "available") || "pending";
          const proofDetails =
            status === "complete" && ps
              ? {
                  generated_at: ps.generated_at,
                  proof_hash: ps.proof_hash,
                  on_chain_verified: ps.on_chain_verified,
                }
              : undefined;
          return (
            <ProofGenomeCard
              key={proof.id}
              title={proof.title}
              description={proof.description}
              status={status}
              genome={proof.genome}
              proofDetails={proofDetails}
              icon={proof.icon}
              perks={proof.perks}
              onGenerate={() => handleGenerateProof(proof.id, proof.endpoint, proof.buildInputs)}
              onEditInputs={() => openEditModal(proof)}
              generating={generatingProof === proof.id}
            />
          );
        })}
      </div>

      {/* Edit inputs modal */}
      {editModalProof && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4"
          onClick={(e) => e.target === e.currentTarget && setEditModalProof(null)}
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h4 className="font-semibold text-zinc-200">Edit inputs — {editModalProof.title}</h4>
              <button
                type="button"
                onClick={() => setEditModalProof(null)}
                className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex-1 min-h-0">
              <textarea
                value={editModalBody}
                onChange={(e) => setEditModalBody(e.target.value)}
                className="w-full h-64 p-3 font-mono text-sm bg-zinc-800/60 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                placeholder="JSON request body"
                spellCheck={false}
              />
            </div>
            <div className="flex gap-2 p-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setEditModalProof(null)}
                className="py-2 px-4 border border-zinc-600 rounded-lg text-zinc-400 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateFromModal}
                disabled={generatingProof === editModalProof.id}
                className="py-2 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {generatingProof === editModalProof.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  "Generate with these inputs"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
