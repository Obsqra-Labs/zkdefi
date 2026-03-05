"use client";

import { useState } from "react";
import { Brain, Shield, Zap, Clock, Check, X, Loader2, Play, AlertTriangle } from "lucide-react";

import { API_BASE } from "@/lib/api/client";
const PERCEPTRON_ADDRESS = process.env.NEXT_PUBLIC_CAIRO_PERCEPTRON_ADDRESS ?? "";

interface TierStatus {
  name: string;
  status: "idle" | "running" | "passed" | "failed";
  duration?: number;
  details?: string;
}

interface BrainVisualizerProps {
  userAddress: string;
  onBrainComplete?: (passed: boolean) => void;
}

export function BrainVisualizer({ userAddress, onBrainComplete }: BrainVisualizerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [tiers, setTiers] = useState<TierStatus[]>([
    { name: "Tier 0: Cairo Perceptron", status: "idle" },
    { name: "Tier 1: RiskScore (Groth16)", status: "idle" },
    { name: "Tier 1: AnomalyDetector (Groth16)", status: "idle" },
  ]);
  const [finalResult, setFinalResult] = useState<"pending" | "passed" | "failed">("pending");
  
  // Test features for demo
  const [volatility, setVolatility] = useState(50);
  const [concentration, setConcentration] = useState(60);
  const [age, setAge] = useState(70);
  const [volume, setVolume] = useState(80);
  
  const updateTier = (index: number, update: Partial<TierStatus>) => {
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, ...update } : t));
  };
  
  const runBrain = async () => {
    setIsRunning(true);
    setFinalResult("pending");
    
    // Reset all tiers
    setTiers(prev => prev.map(t => ({ ...t, status: "idle", duration: undefined, details: undefined })));
    
    try {
      // === TIER 0: Cairo Perceptron (On-chain) ===
      updateTier(0, { status: "running" });
      const t0Start = Date.now();
      
      const features = [volatility, concentration, age, volume];
      let tier0Passed = false;

      if (PERCEPTRON_ADDRESS) {
        try {
          const percResp = await fetch(`${API_BASE}/api/v1/zkdefi/perceptron/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ features, bias: 50, threshold: 200 }),
          });
          if (percResp.ok) {
            const percData = await percResp.json();
            tier0Passed = !!percData.passed;
            const t0Duration = Date.now() - t0Start;
            updateTier(0, {
              status: tier0Passed ? "passed" : "failed",
              duration: t0Duration,
              details: `Score=${percData.score ?? "?"}, Threshold=${percData.threshold ?? 200}`,
            });
          } else {
            throw new Error(`Perceptron API error ${percResp.status}`);
          }
        } catch {
          // Fallback to local simulation if API unavailable
          const sum = features.reduce((a, b) => a + b, 0) + 50;
          const threshold = 200;
          tier0Passed = sum > threshold;
          const t0Duration = Date.now() - t0Start;
          updateTier(0, {
            status: tier0Passed ? "passed" : "failed",
            duration: t0Duration,
            details: `Sum=${sum}, Threshold=${threshold} (local fallback)`,
          });
        }
      } else {
        // No perceptron address — local simulation
        const sum = features.reduce((a, b) => a + b, 0) + 50;
        const threshold = 200;
        tier0Passed = sum > threshold;
        const t0Duration = Date.now() - t0Start;
        updateTier(0, {
          status: tier0Passed ? "passed" : "failed",
          duration: t0Duration,
          details: `Sum=${sum}, Threshold=${threshold} (local)`,
        });
      }
      
      if (!tier0Passed) {
        setFinalResult("failed");
        onBrainComplete?.(false);
        setIsRunning(false);
        return;
      }
      
      // === TIER 1: Circuit Scanner (RiskScore + AnomalyDetector via /scan) ===
      updateTier(1, { status: "running" });
      updateTier(2, { status: "running" });
      const t1Start = Date.now();

      try {
        const scanResponse = await fetch(`${API_BASE}/api/v1/zkdefi/zkml/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: userAddress,
            circuits: ["RiskScore", "AnomalyDetector"],
            portfolio_features: [volatility, concentration, age, volume, 65, 55, 45, 75],
          }),
        });

        const scanData = await scanResponse.json();
        const scanResults: Record<string, { success: boolean; is_compliant?: boolean; proof_hash?: string; duration_ms?: number; error?: string }> = {};
        for (const r of scanData.results ?? []) {
          scanResults[r.circuit] = r;
        }

        // -- RiskScore --
        const riskR = scanResults["RiskScore"];
        const t1aPassed = !!(riskR?.success && riskR?.is_compliant !== false);
        updateTier(1, {
          status: t1aPassed ? "passed" : "failed",
          duration: riskR?.duration_ms ?? (Date.now() - t1Start),
          details: riskR?.success
            ? `Proof: ${(riskR.proof_hash ?? "").slice(0, 14)}… (${riskR.is_compliant ? "compliant" : "non-compliant"})`
            : riskR?.error ?? "Circuit failed",
        });

        // -- AnomalyDetector --
        const anomR = scanResults["AnomalyDetector"];
        const t1bPassed = !!(anomR?.success && anomR?.is_compliant !== false);
        updateTier(2, {
          status: t1bPassed ? "passed" : "failed",
          duration: anomR?.duration_ms ?? (Date.now() - t1Start),
          details: anomR?.success
            ? t1bPassed ? "Pool is safe" : "Anomaly detected"
            : anomR?.error ?? "Circuit failed",
        });

        // Final result
        const allPassed = tier0Passed && t1aPassed && t1bPassed;
        setFinalResult(allPassed ? "passed" : "failed");
        onBrainComplete?.(allPassed);
      } catch (scanErr) {
        console.error("Circuit scan failed:", scanErr);
        updateTier(1, { status: "failed", details: "Scan request failed" });
        updateTier(2, { status: "failed", details: "Scan request failed" });
        setFinalResult("failed");
        onBrainComplete?.(false);
      }
      
    } catch (error) {
      console.error("Brain execution failed:", error);
      setFinalResult("failed");
    } finally {
      setIsRunning(false);
    }
  };
  
  return (
    <div className="glass rounded-xl border border-cyan-800/50 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold flex items-center gap-2">
          <Brain className="w-5 h-5 text-cyan-400" />
          zkML Brain Visualization
        </h3>
        <button
          onClick={runBrain}
          disabled={isRunning}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium transition-all"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Brain Check
            </>
          )}
        </button>
        <p className="text-[11px] text-zinc-500 mt-1.5">
          Runs zkML risk model (Cairo perceptron) · ~3-5s · result feeds agent gate decisions
        </p>
      </div>
      
      {/* Input Features */}
      <div className="mb-6 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
        <p className="text-xs text-zinc-400 mb-3">Adjust features to test the brain:</p>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-zinc-500">Volatility</label>
            <input
              type="range"
              min="0"
              max="100"
              value={volatility}
              onChange={(e) => setVolatility(parseInt(e.target.value))}
              className="w-full"
            />
            <span className="text-sm font-mono">{volatility}</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Concentration</label>
            <input
              type="range"
              min="0"
              max="100"
              value={concentration}
              onChange={(e) => setConcentration(parseInt(e.target.value))}
              className="w-full"
            />
            <span className="text-sm font-mono">{concentration}</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Age</label>
            <input
              type="range"
              min="0"
              max="100"
              value={age}
              onChange={(e) => setAge(parseInt(e.target.value))}
              className="w-full"
            />
            <span className="text-sm font-mono">{age}</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Volume</label>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(parseInt(e.target.value))}
              className="w-full"
            />
            <span className="text-sm font-mono">{volume}</span>
          </div>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Sum = {volatility + concentration + age + volume + 50} (needs {">"} 200 for Tier 0)
        </p>
      </div>
      
      {/* Brain Flow Visualization */}
      <div className="space-y-3">
        {tiers.map((tier, idx) => (
          <div
            key={tier.name}
            className={`p-4 rounded-lg border transition-all ${
              tier.status === "idle" ? "border-zinc-700 bg-zinc-800/30" :
              tier.status === "running" ? "border-cyan-500/50 bg-cyan-950/20" :
              tier.status === "passed" ? "border-emerald-500/50 bg-emerald-950/20" :
              "border-red-500/50 bg-red-950/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {tier.status === "idle" && <div className="w-5 h-5 rounded-full border-2 border-zinc-600" />}
                {tier.status === "running" && <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />}
                {tier.status === "passed" && <Check className="w-5 h-5 text-emerald-400" />}
                {tier.status === "failed" && <X className="w-5 h-5 text-red-400" />}
                <span className="font-medium">{tier.name}</span>
              </div>
              <div className="flex items-center gap-3">
                {tier.duration !== undefined && (
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {tier.duration}ms
                  </span>
                )}
                {tier.details && (
                  <span className="text-xs text-zinc-500">{tier.details}</span>
                )}
              </div>
            </div>
            
            {/* Tier description */}
            <p className="text-xs text-zinc-500 mt-2">
              {idx === 0 && "On-chain quick check (~10k gas). Blocks obviously bad actions."}
              {idx === 1 && "Off-chain Groth16 proof (~3s). Verifies portfolio risk constraints."}
              {idx === 2 && "Off-chain Groth16 proof (~3s). Checks pool for anomalies/rug signals."}
            </p>
          </div>
        ))}
        
        {/* Connector lines */}
        <div className="flex justify-center">
          <div className={`w-0.5 h-8 ${
            finalResult === "pending" ? "bg-zinc-700" :
            finalResult === "passed" ? "bg-emerald-500" :
            "bg-red-500"
          }`} />
        </div>
        
        {/* Final Result */}
        <div className={`p-4 rounded-lg border ${
          finalResult === "pending" ? "border-zinc-700 bg-zinc-800/30" :
          finalResult === "passed" ? "border-emerald-500 bg-emerald-950/30" :
          "border-red-500 bg-red-950/30"
        }`}>
          <div className="flex items-center justify-center gap-3">
            {finalResult === "pending" && (
              <>
                <Zap className="w-5 h-5 text-zinc-500" />
                <span className="font-medium text-zinc-400">Ready to run</span>
              </>
            )}
            {finalResult === "passed" && (
              <>
                <Shield className="w-5 h-5 text-emerald-400" />
                <span className="font-medium text-emerald-400">All checks passed - Action allowed</span>
              </>
            )}
            {finalResult === "failed" && (
              <>
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <span className="font-medium text-red-400">Check failed - Action blocked</span>
              </>
            )}
          </div>
        </div>

        {/* Model Transparency */}
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/20 px-3 py-2 text-xs space-y-1.5 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400 font-medium">Model transparency</span>
            <span className="text-zinc-500 text-[10px]">Deterministic fallback available</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Decision engine</span>
            <span className="text-zinc-300 font-mono text-[11px]">Onyx (onyx-defi-v1)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Risk model</span>
            <span className="text-zinc-300 font-mono text-[11px]">Cairo Perceptron v1 (on-chain)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Proof system</span>
            <span className="text-zinc-300 font-mono text-[11px]">Groth16 / BN254 (Circom 2.1.6)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Verifier</span>
            <span className="text-zinc-300 font-mono text-[11px]">Garaga (Starknet Sepolia)</span>
          </div>
        </div>
      </div>
      
      {/* How It Works */}
      <div className="mt-6 p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
        <h4 className="text-sm font-medium text-zinc-300 mb-2">How Autonomous Triggering Works</h4>
        <ol className="text-xs text-zinc-500 space-y-1.5">
          <li className="flex items-start gap-2">
            <span className="text-cyan-400 font-bold">1.</span>
            <span>User grants a <strong className="text-zinc-300">Session Key</strong> with constraints (max amount, duration, protocols)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan-400 font-bold">2.</span>
            <span>Backend agent <strong className="text-zinc-300">monitors</strong> market conditions (TVL, APY, price movements)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan-400 font-bold">3.</span>
            <span>When opportunity detected, agent runs <strong className="text-zinc-300">zkML brain</strong> (this visualization)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan-400 font-bold">4.</span>
            <span>If all tiers pass, agent generates <strong className="text-zinc-300">execution proofs</strong> and submits tx</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan-400 font-bold">5.</span>
            <span>On-chain contracts verify all proofs before executing the action</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
