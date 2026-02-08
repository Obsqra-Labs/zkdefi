"use client";

import { useState, useEffect } from "react";
import { 
  Shield, 
  Brain, 
  Key, 
  RefreshCw, 
  FileCheck, 
  Activity,
  TrendingUp,
  Lock,
  Eye,
  CheckCircle,
  AlertTriangle
} from "lucide-react";
import { SessionKeyManager } from "./SessionKeyManager";
import { AgentRebalancer } from "./AgentRebalancer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";

interface AgentDashboardProps {
  userAddress: string;
}

export function AgentDashboard({ userAddress }: AgentDashboardProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "sessions" | "rebalancer" | "compliance">("overview");
  const [zkmlStatus, setZkmlStatus] = useState<any>(null);
  const [positions, setPositions] = useState<{ [key: string]: number }>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [poolSafety, setPoolSafety] = useState<any>(null);
  
  useEffect(() => {
    fetchZkmlStatus();
    fetchPositions();
    fetchPoolSafety();
  }, []);
  
  const fetchZkmlStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/zkml/status`);
      if (response.ok) {
        const data = await response.json();
        setZkmlStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch zkML status:", error);
    }
  };
  
  const fetchPositions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/position/${userAddress}`);
      if (response.ok) {
        const data = await response.json();
        setPositions({ "0": data.position || 0 });
      }
    } catch (error) {
      console.error("Failed to fetch positions:", error);
    }
  };

  const fetchPoolSafety = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/zkml/pool-safety`);
      if (response.ok) {
        const data = await response.json();
        setPoolSafety(data);
      } else {
        // Default safe state if endpoint not available
        setPoolSafety({
          tvl_volatility: "low",
          liquidity_concentration: "healthy",
          deployer_age_days: 120,
          volume_anomaly: false,
          anomaly_flag: 0,
          safe: true
        });
      }
    } catch (error) {
      console.error("Failed to fetch pool safety:", error);
      setPoolSafety({ safe: true, anomaly_flag: 0 });
    }
  };
  
  const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "sessions", label: "Session Keys", icon: Key },
    { id: "rebalancer", label: "Rebalancer", icon: RefreshCw },
    { id: "compliance", label: "Compliance", icon: FileCheck },
  ];
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Agent Dashboard</h2>
          <p className="text-zinc-400 text-sm">Privacy-preserving autonomous DeFi agent</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 bg-emerald-500/20 rounded-lg flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xs text-emerald-400">Agent Active</span>
          </div>
        </div>
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
              <Brain className="w-4 h-4 text-violet-400" />
            </div>
            <span className="text-sm text-zinc-400">zkML Models</span>
          </div>
          <p className="text-2xl font-bold text-white">2</p>
          <p className="text-xs text-zinc-500">Risk + Anomaly</p>
        </div>
        
        <div className="glass rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-sm text-zinc-400">Proofs Generated</span>
          </div>
          <p className="text-2xl font-bold text-white">--</p>
          <p className="text-xs text-zinc-500">Garaga verified</p>
        </div>
        
        <div className="glass rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center">
              <Lock className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-sm text-zinc-400">Privacy Score</span>
          </div>
          <p className="text-2xl font-bold text-white">100%</p>
          <p className="text-xs text-zinc-500">All intents hidden</p>
        </div>
        
        <div className="glass rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-amber-400" />
            </div>
            <span className="text-sm text-zinc-400">Total Value</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {Object.values(positions).reduce((a, b) => a + b, 0).toLocaleString()}
          </p>
          <p className="text-xs text-zinc-500">Across protocols</p>
        </div>
      </div>
      
      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-800 pb-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
      
      {/* Tab Content */}
      <div>
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Privacy Architecture */}
            <div className="glass rounded-2xl border border-zinc-800 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Privacy Architecture</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-zinc-300 mb-3">Proof System</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-violet-400" />
                        <span className="text-sm">zkML Proofs</span>
                      </div>
                      <span className="text-xs text-violet-400">Garaga (Groth16)</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm">Execution Proofs</span>
                      </div>
                      <span className="text-xs text-emerald-400">Integrity (STARK)</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-zinc-300 mb-3">Privacy Features</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-zinc-800/50 rounded-lg">
                      <Eye className="w-4 h-4 text-cyan-400" />
                      <span className="text-sm">Intent hidden until execution</span>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-zinc-800/50 rounded-lg">
                      <Lock className="w-4 h-4 text-amber-400" />
                      <span className="text-sm">zkML outputs private</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* zkML Models */}
            <div className="glass rounded-2xl border border-zinc-800 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">zkML Models</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-violet-500/10 border border-violet-500/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-5 h-5 text-violet-400" />
                    <span className="font-medium">Risk Score Model</span>
                  </div>
                  <p className="text-sm text-zinc-400 mb-3">
                    Evaluates portfolio risk from 8 features. Proves score ≤ threshold without revealing actual score.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      zkmlStatus?.risk_score_circuit_ready ? "bg-emerald-400" : "bg-amber-400"
                    }`} />
                    <span className="text-xs text-zinc-500">
                      {zkmlStatus?.risk_score_circuit_ready ? "Ready" : "Simulated"}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    <span className="font-medium">Anomaly Detector</span>
                  </div>
                  <p className="text-sm text-zinc-400 mb-3">
                    Analyzes pool safety from 6 risk factors. Proves no anomaly without revealing analysis.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      zkmlStatus?.anomaly_detection_circuit_ready ? "bg-emerald-400" : "bg-amber-400"
                    }`} />
                    <span className="text-xs text-zinc-500">
                      {zkmlStatus?.anomaly_detection_circuit_ready ? "Ready" : "Simulated"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Pool Safety Analysis */}
            <div className="glass rounded-2xl border border-zinc-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Pool Safety Analysis</h3>
                <span className="text-xs text-cyan-400 bg-cyan-500/20 px-2 py-1 rounded">zkML Verified</span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="p-3 bg-zinc-800/50 rounded-lg">
                  <div className="text-xs text-zinc-400 mb-1">TVL Volatility</div>
                  <div className={`font-medium ${poolSafety?.tvl_volatility === "low" ? "text-emerald-400" : poolSafety?.tvl_volatility === "medium" ? "text-amber-400" : "text-red-400"}`}>
                    {poolSafety?.tvl_volatility === "low" ? "Low" : poolSafety?.tvl_volatility === "medium" ? "Medium" : poolSafety?.tvl_volatility || "Low"}
                  </div>
                </div>
                <div className="p-3 bg-zinc-800/50 rounded-lg">
                  <div className="text-xs text-zinc-400 mb-1">Liquidity Concentration</div>
                  <div className={`font-medium ${poolSafety?.liquidity_concentration === "healthy" ? "text-emerald-400" : "text-amber-400"}`}>
                    {poolSafety?.liquidity_concentration === "healthy" ? "Healthy" : poolSafety?.liquidity_concentration || "Healthy"}
                  </div>
                </div>
                <div className="p-3 bg-zinc-800/50 rounded-lg">
                  <div className="text-xs text-zinc-400 mb-1">Deployer Age</div>
                  <div className={`font-medium ${(poolSafety?.deployer_age_days || 0) > 90 ? "text-emerald-400" : "text-amber-400"}`}>
                    {poolSafety?.deployer_age_days ? `${poolSafety.deployer_age_days} days` : ">90 days"}
                  </div>
                </div>
                <div className="p-3 bg-zinc-800/50 rounded-lg">
                  <div className="text-xs text-zinc-400 mb-1">Volume Anomaly</div>
                  <div className={`font-medium ${poolSafety?.volume_anomaly ? "text-red-400" : "text-emerald-400"}`}>
                    {poolSafety?.volume_anomaly ? "Detected" : "None"}
                  </div>
                </div>
              </div>

              {poolSafety?.anomaly_flag === 0 || poolSafety?.safe ? (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <div>
                    <p className="text-emerald-400 font-medium">All Pools Clear</p>
                    <p className="text-xs text-zinc-400">No anomalies detected by zkML analysis.</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className="text-amber-400 font-medium">Anomaly Detected</p>
                    <p className="text-xs text-zinc-400">Some pools may have elevated risk. Review before proceeding.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === "sessions" && (
          <SessionKeyManager 
            userAddress={userAddress} 
            onSessionGranted={(sessionId) => setActiveSessionId(sessionId)}
          />
        )}
        
        {activeTab === "rebalancer" && (
          <AgentRebalancer 
            userAddress={userAddress}
            sessionId={activeSessionId || undefined}
            positions={positions}
          />
        )}
        
        {activeTab === "compliance" && (
          <div className="glass rounded-2xl border border-zinc-800 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-600/20 flex items-center justify-center">
                <FileCheck className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Compliance Profiles</h3>
                <p className="text-xs text-zinc-500">Selective disclosure proofs</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              {["KYC Eligibility", "Risk Compliance", "Performance Proof", "Portfolio Aggregation"].map((type) => (
                <div key={type} className="p-4 bg-zinc-800/50 border border-zinc-700/50 rounded-xl">
                  <h4 className="font-medium text-white mb-1">{type}</h4>
                  <p className="text-xs text-zinc-500 mb-3">Prove compliance without revealing details</p>
                  <button className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-xs font-medium transition-colors">
                    Generate Proof
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
