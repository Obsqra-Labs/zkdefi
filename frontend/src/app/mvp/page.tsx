"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import { Shield, ArrowRight, ExternalLink, Brain } from "lucide-react";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { RiskProfileForm } from "./components/RiskProfileForm";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";

/** Turn API error detail (string | array of { msg } | object) into a single string for display. */
function detailToString(detail: unknown): string {
  if (detail == null) return "Request failed";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d)));
    return parts.length ? parts.join(". ") : JSON.stringify(detail);
  }
  if (typeof detail === "object" && detail !== null && "msg" in detail) return String((detail as { msg: unknown }).msg);
  return JSON.stringify(detail);
}

type Step = "risk" | "recommendation" | "deploy";

interface PoolRec {
  pool_id: string;
  protocol: string;
  pair: string;
  allocation_percent: number;
  allocation_amount: number;
  expected_apy: number;
  risk_score: number;
}

interface Recommendation {
  user_address: string;
  risk_profile: string;
  total_amount: number;
  recommended_pools: PoolRec[];
  ai_reasoning: string;
  expected_portfolio_apy: number;
  recommendation_id: string;
}

export default function MVPPage() {
  const { address, isConnected } = useAccount();
  const [step, setStep] = useState<Step>("risk");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    ok: boolean;
    message: string;
    positions?: Array<{ strategy?: string; pool_id?: string; amount?: number; tx_hash?: string | null; status?: string; pool_name?: string }>;
  } | null>(null);

  const handleRiskSubmit = async (data: {
    amount: number;
    riskProfile: "conservative" | "balanced" | "aggressive";
  }) => {
    if (!address) return;
    setRecommendError(null);
    setRecommendLoading(true);
    setRecommendation(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          risk_profile: data.riskProfile,
          amount: data.amount,
        }),
      });
      const text = await res.text();
      let json: Recommendation;
      try {
        json = JSON.parse(text);
      } catch {
        setRecommendError(res.ok ? "Invalid response from server" : `Backend or proxy returned an error page (${res.status}). Check API is up and NEXT_PUBLIC_API_URL is correct.`);
        setRecommendLoading(false);
        return;
      }
      if (!res.ok) {
        setRecommendError(detailToString((json as { detail?: unknown }).detail) || `Request failed (${res.status})`);
        setRecommendLoading(false);
        return;
      }
      setRecommendation(json);
      setStep("recommendation");
    } catch (e) {
      setRecommendError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRecommendLoading(false);
    }
  };

  const handleDeploy = async () => {
    if (!address || !recommendation) return;
    setDeployResult(null);
    setDeployLoading(true);
    try {
      // Backend may expect deposit_amount (vault_execute) and/or total_amount + recommended_pools (execute-advanced)
      const body = {
        user_address: address,
        risk_profile: recommendation.risk_profile,
        total_amount: recommendation.total_amount,
        deposit_amount: recommendation.total_amount,
        recommended_pools: recommendation.recommended_pools,
        recommendation_id: recommendation.recommendation_id,
        allocations: recommendation.recommended_pools.map((p) => ({
          strategy: p.pool_id,
          percentage: p.allocation_percent,
          amount: p.allocation_amount,
          expected_apy: p.expected_apy,
          pool_id: p.pool_id,
          protocol: p.protocol,
          token_pair: p.pair,
        })),
      };
      const res = await fetch(`${API_BASE}/api/v2/strategies/execute-advanced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
      } catch {
        setDeployResult({
          ok: false,
          message: res.status === 404
            ? "Deploy endpoint not configured on this backend."
            : `Server returned non-JSON (${res.status}). Check API.`,
        });
        setDeployLoading(false);
        return;
      }
      if (!res.ok) {
        setDeployResult({
          ok: false,
          message: detailToString(json.detail) || `Request failed (${res.status})`,
        });
        setDeployLoading(false);
        return;
      }
      const positions = (json.positions as Array<{ strategy?: string; pool_id?: string; amount?: number; tx_hash?: string | null; status?: string; pool_name?: string }>) ?? [];
      const deployed = positions.filter((p) => p.tx_hash && p.status !== "recorded").length;
      const recorded = positions.filter((p) => p.status === "recorded").length;
      const hasTxLinks = positions.some((p) => p.tx_hash);
      setDeployResult({
        ok: true,
        message: hasTxLinks
          ? `Deployed ${deployed} position(s) on Starknet.`
          : recorded > 0
            ? `${recorded} position(s) recorded. Sign with your wallet on the Dashboard to deploy capital.`
            : "Strategy submitted. Go to Dashboard to sign and deploy.",
        positions: positions.length ? positions : undefined,
      });
      setStep("deploy");
    } catch (e) {
      setDeployResult({
        ok: false,
        message: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setDeployLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">zkde.fi</h1>
                <p className="text-xs text-zinc-400">MVP — Yield Optimization</p>
              </div>
            </Link>
            <nav className="hidden md:flex items-center gap-1 ml-4">
              <Link href="/agent" className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all">Dashboard</Link>
              <Link href="/mvp" className="px-3 py-1.5 text-sm font-medium text-white bg-zinc-800 rounded-lg">MVP</Link>
              <Link href="/profile" className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all">Profile</Link>
            </nav>
          </div>
          <ConnectButton />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {step === "risk" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white">Connect & set risk profile</h2>
              <p className="text-zinc-400 mt-1">Choose amount and risk level, then get a recommendation.</p>
            </div>
            {!isConnected || !address ? (
              <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-8 text-center">
                <p className="text-zinc-300 mb-4">Connect your wallet to continue.</p>
                <ConnectButton />
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-6">
                <RiskProfileForm
                  onSubmit={handleRiskSubmit}
                  isLoading={recommendLoading}
                />
              </div>
            )}
            {recommendError && (
              <p className="text-sm text-red-400 text-center">{recommendError}</p>
            )}
          </div>
        )}

        {step === "recommendation" && recommendation && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Recommendation</h2>
              <button
                type="button"
                onClick={() => { setStep("risk"); setRecommendation(null); }}
                className="text-sm text-zinc-400 hover:text-white"
              >
                Change risk profile
              </button>
            </div>
            <p className="text-zinc-300">{recommendation.ai_reasoning}</p>
            <p className="text-sm text-zinc-500">
              Expected portfolio APY: <span className="text-emerald-400 font-medium">{recommendation.expected_portfolio_apy.toFixed(1)}%</span>
            </p>
            <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-700">
              {recommendation.recommended_pools.map((p) => (
                <div key={p.pool_id} className="p-4 flex justify-between items-center">
                  <div>
                    <span className="font-medium">{p.pair}</span>
                    <span className="text-zinc-500 text-sm ml-2">({p.protocol})</span>
                  </div>
                  <div className="text-right text-sm">
                    <div>{p.allocation_percent.toFixed(0)}% — {p.allocation_amount.toFixed(0)} STRK</div>
                    <div className="text-zinc-500">APY {p.expected_apy}%</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-zinc-500">
              Deploy sends capital to the vault (wallet may prompt to sign). If the backend only records, sign on the Dashboard to execute.
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={handleDeploy}
                disabled={deployLoading}
                className="px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium"
              >
                {deployLoading ? "Deploying…" : "Deploy"}
              </button>
              <button
                type="button"
                onClick={() => { setStep("risk"); setRecommendation(null); }}
                className="px-6 py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
              >
                Back
              </button>
            </div>
            {deployResult && (
              <p className={deployResult.ok ? "text-emerald-400" : "text-red-400"}>
                {deployResult.message}
              </p>
            )}
          </div>
        )}

        {step === "deploy" && deployResult?.ok && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-white">
                {deployResult.positions?.some((p) => p.tx_hash) ? "Deployed" : "Next: sign on Dashboard"}
              </h2>
              <p className="text-zinc-300 mt-2">{deployResult.message}</p>
            </div>

            {deployResult.positions && deployResult.positions.length > 0 && (
              <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-700 overflow-hidden">
                <div className="px-4 py-3 bg-zinc-800/50 text-sm font-medium text-zinc-300">Positions</div>
                {deployResult.positions.map((p, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <span className="font-medium text-white">{p.pool_name ?? p.pool_id ?? p.strategy ?? "Position"}</span>
                      {typeof p.amount === "number" && (
                        <span className="text-zinc-500 text-sm ml-2">{p.amount.toLocaleString()} STRK</span>
                      )}
                    </div>
                    {p.tx_hash ? (
                      <a
                        href={sepoliaStarkscanTxUrl(p.tx_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 font-medium"
                      >
                        View on Starkscan <ExternalLink className="w-4 h-4" />
                      </a>
                    ) : (
                      <span className="text-sm text-zinc-500">Sign on Dashboard to deploy</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-6 space-y-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Brain className="w-5 h-5 text-emerald-400" />
                When does the AI redeploy?
              </h3>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Right now you got a recommendation and (if you signed) a one-time deploy. To have the agent <strong className="text-zinc-300">rebalance for you</strong> when risk or yield conditions change, go to the Dashboard: set up a session key, then turn on <strong className="text-zinc-300">Autonomous Rebalancing</strong>. The agent monitors your portfolio and redeploys when it makes sense—no manual redeploy.
              </p>
              <Link
                href="/agent"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm"
              >
                Go to Dashboard → enable AI rebalancing <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/agent"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              >
                Dashboard <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                type="button"
                onClick={() => { setStep("risk"); setRecommendation(null); setDeployResult(null); }}
                className="px-6 py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
              >
                New strategy
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
