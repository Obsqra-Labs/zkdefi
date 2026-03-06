"use client";

import { useState } from "react";
import { Brain, Shield, Zap, Clock, Check, X, Loader2, Play, AlertTriangle } from "lucide-react";
import { apiUrl } from "@/lib/api/client";


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
      
      // This would be a call to the contract - for now simulate the check
      const features = [volatility, concentration, age, volume];
      const sum = features.reduce((a, b) => a + b, 0) + 50; // +50 bias
      const threshold = 200;
      const tier0Passed = sum > threshold;
      
      const t0Duration = Date.now() - t0Start;
      updateTier(0, { 
        status: tier0Passed ? "passed" : "failed", 
        duration: t0Duration,
        details: `Sum=${sum}, Threshold=${threshold}`
      });
      
      if (!tier0Passed) {
        setFinalResult("failed");
        onBrainComplete?.(false);
        setIsRunning(false);
        return;
      }
      
      // === TIER 1a: RiskScore (Groth16) ===
      updateTier(1, { status: "running" });
      const t1aStart = Date.now();
      
      const riskResponse = await fetch(apiUrl("/api/v1/zkdefi/zkml/risk_score"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: userAddress,
          portfolio_features: [volatility, concentration, age, volume, 65, 55, 45, 75],
          threshold: 50
        })
      });
      
      const riskData = await riskResponse.json();
      const t1aDuration = Date.now() - t1aStart;
      const tier1aPassed = riskData.proof_calldata?.length > 0;
      
      updateTier(1, { 
        status: tier1aPassed ? "passed" : "failed", 
        duration: t1aDuration,
        details: `${riskData.proof_calldata?.length || 0} proof elements`
      });
      
      // === TIER 1b: AnomalyDetector (Groth16) ===
      updateTier(2, { status: "running" });
      const t1bStart = Date.now();
      
      const anomalyResponse = await fetch(apiUrl("/api/v1/zkdefi/zkml/anomaly"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: userAddress,
          pool_id: "ekubo_eth_usdc",
          pool_features: {
            tvl_volatility: 20,
            liquidity_concentration: 30,
            price_impact_score: 15,
            deployer_age_days: 500,
            volume_anomaly: 10,
            contract_risk_score: 25
          },
          threshold: 60
        })
      });
      
      const anomalyData = await anomalyResponse.json();
      const t1bDuration = Date.now() - t1bStart;
      const tier1bPassed = anomalyData.is_safe;
      
      updateTier(2, { 
        status: tier1bPassed ? "passed" : "failed", 
        duration: t1bDuration,
        details: tier1bPassed ? "Pool is safe" : "Anomaly detected"
      });
      
      // Final result
      const allPassed = tier0Passed && tier1aPassed && tier1bPassed;
      setFinalResult(allPassed ? "passed" : "failed");
      onBrainComplete?.(allPassed);
      
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
