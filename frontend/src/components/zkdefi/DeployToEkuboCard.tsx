"use client";

import { useState } from "react";
import { Zap, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { API_BASE } from "@/lib/api/client";

type RiskProfile = "conservative" | "balanced" | "aggressive";

interface DeployResult {
  deployment_id: string;
  positions: Array<{ strategy: string; amount: number; status: string }>;
  receipt_id: string;
  target: string;
  recommendation_id?: string;
}

interface DeployToEkuboCardProps {
  userAddress: string;
  onEvent?: () => void;
}

export function DeployToEkuboCard({ userAddress, onEvent }: DeployToEkuboCardProps) {
  const [amount, setAmount] = useState("");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("balanced");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeploy = async () => {
    const num = parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a positive amount");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/zkdefi/orchestration/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: userAddress,
          deployable_amount: num,
          risk_profile: riskProfile,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Deploy failed");
        return;
      }
      setResult(data as DeployResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="deploy-to-ekubo" className="glass rounded-xl border border-emerald-800/50 p-6 scroll-mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5 text-emerald-400" />
        <h3 className="font-semibold">Deploy to Ekubo</h3>
        <span className="ml-auto px-2 py-1 text-xs rounded bg-emerald-600/20 text-emerald-300 border border-emerald-600/30">
          Ekubo Sepolia
        </span>
      </div>
      <p className="text-sm text-zinc-400 mb-4">
        Recommend → execute → receipt. Ekubo Sepolia only. Enter the amount you want to deploy; we allocate by risk profile and record a compliance receipt.
      </p>
      {!result ? (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Deployable amount</label>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Risk profile</label>
              <select
                value={riskProfile}
                onChange={(e) => setRiskProfile(e.target.value as RiskProfile)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-white focus:border-emerald-500 focus:outline-none"
                disabled={loading}
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-amber-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={handleDeploy}
            disabled={loading}
            className="mt-4 w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deploying…
              </>
            ) : (
              "Deploy"
            )}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-medium">Deployed</span>
          </div>
          <div className="text-sm space-y-1">
            <p className="text-zinc-400">
              <span className="text-zinc-500">Deployment ID:</span>{" "}
              <span className="font-mono text-zinc-300">{result.deployment_id}</span>
            </p>
            <p className="text-zinc-400">
              <span className="text-zinc-500">Receipt:</span>{" "}
              <span className="font-mono text-zinc-300 truncate block max-w-full" title={result.receipt_id}>
                {result.receipt_id}
              </span>
            </p>
          </div>
          {result.positions?.length > 0 && (
            <div className="pt-2 border-t border-zinc-700/50">
              <p className="text-xs text-zinc-500 mb-2">Positions</p>
              <ul className="space-y-1 text-sm">
                {result.positions.map((p, i) => (
                  <li key={i} className="flex justify-between text-zinc-300">
                    <span>{p.strategy}</span>
                    <span>{p.amount} — {p.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setAmount("");
              setError(null);
            }}
            className="mt-3 text-sm text-emerald-400 hover:text-emerald-300"
          >
            Deploy again
          </button>
        </div>
      )}
    </div>
  );
}
