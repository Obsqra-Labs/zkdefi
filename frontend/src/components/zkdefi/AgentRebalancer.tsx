"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  RefreshCw, 
  Shield, 
  AlertTriangle, 
  Check, 
  X, 
  Loader2, 
  ArrowRight,
  Brain,
  Lock,
  Activity,
  Power,
  Pause,
  Play,
  Clock,
  Zap
} from "lucide-react";
import { useApp } from "@/lib/AppContext";
import { ProofTimeline } from "@/components/zkdefi/ProofTimeline";
import { TierBadge } from "@/components/zkdefi/TierBadge";
import { toastSuccess, toastError } from "@/lib/toast";
import { formatGateDenied } from "@/lib/gateCopy";

import { API_BASE, walletAuthHeaders } from "@/lib/api/client";

interface Proposal {
  proposal_id: string;
  user_address: string;
  from_protocol: number;
  to_protocol: number;
  amount: number;
  reason: string;
  status: string;
  created_at: string;
  risk_proof?: any;
  anomaly_proof?: any;
  commitment_hash?: string;
  snapshot_hash?: string | null;
  tx_hash?: string;
  error?: string;
}

interface AutonomousState {
  state: "stopped" | "running" | "paused" | "error";
  user_address: string;
  running: boolean;
  started_at?: string;
  last_check?: string;
  checks_count?: number;
  actions_taken?: number;
  last_action?: {
    proposal_id: string;
    tx_hash?: string;
    timestamp: string;
  };
  config?: {
    interval_seconds: number;
    risk_threshold: number;
  };
}

interface AgentRebalancerProps {
  userAddress: string;
  sessionId?: string;
  positions?: { [key: string]: number };
  /** User tier (0=Strict, 1=Standard, 2=Express) for badge and visibility copy */
  userTier?: number;
}

const PROTOCOL_NAMES = ["Pools", "Ekubo", "JediSwap (legacy)"];

export function AgentRebalancer({ 
  userAddress, 
  sessionId,
  positions = {},
  userTier = 0,
}: AgentRebalancerProps) {
  const { hasOnboarded, invalidateTabs } = useApp();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [showPropose, setShowPropose] = useState(false);
  
  // Propose form
  const [fromProtocol, setFromProtocol] = useState(0);
  const [toProtocol, setToProtocol] = useState(1);
  const [amount, setAmount] = useState(1000);
  const [reason, setReason] = useState("Risk optimization");
  
  // Autonomous mode state
  const [autonomousState, setAutonomousState] = useState<AutonomousState | null>(null);
  const [autonomousLoading, setAutonomousLoading] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [showAutonomousSettings, setShowAutonomousSettings] = useState(false);
  const [poolPassport, setPoolPassport] = useState<{ safe: boolean | null; health_score?: number } | null>(null);
  
  // Fetch autonomous status
  const fetchAutonomousStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/autonomous/status/${userAddress}`);
      if (response.ok) {
        const data = await response.json();
        setAutonomousState(data);
      }
    } catch (error) {
      console.error("Failed to fetch autonomous status:", error);
    }
  }, [userAddress]);
  
  useEffect(() => {
    if (userAddress) {
      fetchProposals();
      fetchAutonomousStatus();
    }
  }, [userAddress, fetchAutonomousStatus]);

  // Fetch pool passport when propose modal is open and To protocol is selected
  useEffect(() => {
    if (!showPropose) {
      setPoolPassport(null);
      return;
    }
    const poolId = `pool_${toProtocol}`;
    setPoolPassport(null);
    fetch(`${API_BASE}/api/v1/zkdefi/risk_passport/pool/${poolId}`)
      .then(r => r.json())
      .then(data => setPoolPassport({ safe: data.safe ?? null, health_score: data.health_score }))
      .catch(() => setPoolPassport(null));
  }, [showPropose, toProtocol]);
  
  const fetchProposals = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/proposals/${userAddress}`);
      if (response.ok) {
        const data = await response.json();
        setProposals(data.proposals || []);
      }
    } catch (error) {
      console.error("Failed to fetch proposals:", error);
    } finally {
      setLoading(false);
    }
  };
  
  const startAutonomous = async () => {
    if (!sessionId) {
      alert("Session key required for autonomous mode");
      return;
    }
    if (userAddress && hasOnboarded === false) {
      toastError("Complete one-time agent setup to continue. Open Setup from the banner or go to /agent?tab=onboarding");
      return;
    }
    setAutonomousLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/autonomous/start`, {
        method: "POST",
        headers: walletAuthHeaders(userAddress, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          user_address: userAddress,
          session_id: sessionId,
          interval_minutes: intervalMinutes,
          risk_threshold: 50
        })
      });
      
      if (response.ok) {
        await fetchAutonomousStatus();
        setShowAutonomousSettings(false);
      }
    } catch (error) {
      console.error("Failed to start autonomous mode:", error);
    } finally {
      setAutonomousLoading(false);
    }
  };
  
  const stopAutonomous = async () => {
    setAutonomousLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/autonomous/stop`, {
        method: "POST",
        headers: walletAuthHeaders(userAddress, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          user_address: userAddress
        })
      });
      
      if (response.ok) {
        await fetchAutonomousStatus();
      }
    } catch (error) {
      console.error("Failed to stop autonomous mode:", error);
    } finally {
      setAutonomousLoading(false);
    }
  };
  
  const pauseAutonomous = async () => {
    setAutonomousLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/autonomous/pause/${userAddress}`, {
        method: "POST",
        headers: walletAuthHeaders(userAddress),
      });
      
      if (response.ok) {
        await fetchAutonomousStatus();
      }
    } catch (error) {
      console.error("Failed to pause autonomous mode:", error);
    } finally {
      setAutonomousLoading(false);
    }
  };
  
  const resumeAutonomous = async () => {
    setAutonomousLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/autonomous/resume/${userAddress}`, {
        method: "POST",
        headers: walletAuthHeaders(userAddress),
      });
      
      if (response.ok) {
        await fetchAutonomousStatus();
      }
    } catch (error) {
      console.error("Failed to resume autonomous mode:", error);
    } finally {
      setAutonomousLoading(false);
    }
  };
  
  const handlePropose = async () => {
    if (userAddress && hasOnboarded === false) {
      toastError("Complete one-time agent setup to continue. Open Setup from the banner or go to /agent?tab=onboarding");
      return;
    }
    setProcessing("proposing");
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: userAddress,
          from_protocol: fromProtocol,
          to_protocol: toProtocol,
          amount: amount,
          reason: reason
        })
      });
      
      if (response.ok) {
        const proposal = await response.json();
        setShowPropose(false);
        await fetchProposals();
        invalidateTabs();
        // Automatically run zkML checks
        await runZkmlChecks(proposal.proposal_id);
      }
    } catch (error) {
      console.error("Failed to propose:", error);
    } finally {
      setProcessing(null);
    }
  };
  
  const runZkmlChecks = async (proposalId: string, retryOnce = true) => {
    setProcessing(proposalId);
    try {
      const portfolioFeatures = Object.values(positions).length > 0
        ? generatePortfolioFeatures(positions)
        : [50, 30, 20, 20, 50, 30, 10, 20];
      const body = JSON.stringify({
        proposal_id: proposalId,
        portfolio_features: portfolioFeatures,
        pool_id: `pool_${toProtocol}`
      });
      let response = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      if (response.status === 503 && retryOnce) {
        const data = await response.json().catch(() => ({}));
        const detail = (data.detail || "").toLowerCase();
        if (detail.includes("retry")) {
          toastSuccess("Proof in progress, retrying…");
          await new Promise(r => setTimeout(r, 2500));
          return runZkmlChecks(proposalId, false);
        }
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toastError(formatGateDenied(data.detail || "zkML gate check failed"));
      }
      await fetchProposals();
    } catch (error) {
      console.error("Failed to run zkML checks:", error);
      toastError("Failed to run zkML checks");
    } finally {
      setProcessing(null);
    }
  };
  
  const prepareAndExecute = async (proposalId: string, retryOnce = true) => {
    if (!sessionId) {
      alert("Session key required for execution");
      return;
    }
    if (userAddress && hasOnboarded === false) {
      toastError("Complete one-time agent setup to continue. Open Setup from the banner or go to /agent?tab=onboarding");
      return;
    }
    setProcessing(proposalId);
    try {
      const prepareBody = JSON.stringify({ proposal_id: proposalId, session_id: sessionId });
      let prepRes = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: prepareBody
      });
      if (prepRes.status === 503 && retryOnce) {
        const data = await prepRes.json().catch(() => ({}));
        if ((data.detail || "").toLowerCase().includes("retry")) {
          toastSuccess("Proof in progress, retrying…");
          await new Promise(r => setTimeout(r, 2500));
          return prepareAndExecute(proposalId, false);
        }
      }
      if (!prepRes.ok) {
        const data = await prepRes.json().catch(() => ({}));
        toastError(data.detail || "Prepare failed");
        return;
      }
      let execRes = await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: prepareBody
      });
      if (execRes.status === 503 && retryOnce) {
        toastSuccess("Proof in progress, retrying…");
        await new Promise(r => setTimeout(r, 2500));
        return prepareAndExecute(proposalId, false);
      }
      if (!execRes.ok) {
        const data = await execRes.json().catch(() => ({}));
        toastError(data.detail || "Execution failed");
      } else {
        const result = await execRes.json().catch(() => ({}));
        if (result.execution_error) {
          toastError(`Execution failed: ${result.execution_error}`);
        } else {
          invalidateTabs();
        }
      }
      await fetchProposals();
    } catch (error) {
      console.error("Failed to execute:", error);
    } finally {
      setProcessing(null);
    }
  };
  
  const generatePortfolioFeatures = (pos: { [key: string]: number }): number[] => {
    const values = Object.values(pos);
    const total = values.reduce((a, b) => a + b, 0);
    const max = Math.max(...values);
    const concentration = total > 0 ? Math.floor((max * 100) / total) : 0;
    
    return [
      Math.floor(total / 1000000),
      concentration,
      100 - (values.filter(v => v > 0).length * 30),
      30,
      60,
      30,
      10,
      20
    ];
  };
  
  const getStatusBadge = (status: string) => {
    const styles: { [key: string]: { bg: string; text: string; icon: any } } = {
      pending: { bg: "bg-zinc-500/20", text: "text-zinc-400", icon: Loader2 },
      zkml_checking: { bg: "bg-blue-500/20", text: "text-blue-400", icon: Brain },
      zkml_passed: { bg: "bg-emerald-500/20", text: "text-emerald-400", icon: Check },
      zkml_failed: { bg: "bg-red-500/20", text: "text-red-400", icon: X },
      ready_to_execute: { bg: "bg-violet-500/20", text: "text-violet-400", icon: Lock },
      executing: { bg: "bg-amber-500/20", text: "text-amber-400", icon: Loader2 },
      completed: { bg: "bg-emerald-500/20", text: "text-emerald-400", icon: Check },
      failed: { bg: "bg-red-500/20", text: "text-red-400", icon: AlertTriangle },
    };
    
    const style = styles[status] || styles.pending;
    const Icon = style.icon;
    
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
        <Icon className={`w-3 h-3 ${status === "executing" || status === "zkml_checking" ? "animate-spin" : ""}`} />
        {status.replace(/_/g, " ")}
      </span>
    );
  };
  
  return (
    <div className="glass rounded-2xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-600/20 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Agent Rebalancer</h3>
            <p className="text-xs text-zinc-500 flex items-center gap-2">
              zkML-gated autonomous execution
              <TierBadge tier={userTier} showVisibilityHint />
            </p>
          </div>
        </div>
        
        <button
          onClick={() => setShowPropose(true)}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Propose Rebalance
        </button>
      </div>
      
      {/* zkML Status */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <span className="text-sm text-zinc-400">Risk Model</span>
          </div>
          <p className="text-xs text-zinc-500">Evaluates portfolio risk score</p>
        </div>
        <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-zinc-400">Anomaly Detector</span>
          </div>
          <p className="text-xs text-zinc-500">Checks pool/protocol safety</p>
        </div>
      </div>
      
      {/* Autonomous Mode Section */}
      <div className="mb-6 p-4 rounded-xl border border-zinc-700/50 bg-gradient-to-br from-violet-900/20 to-cyan-900/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              autonomousState?.state === "running" 
                ? "bg-emerald-500/20" 
                : autonomousState?.state === "paused"
                ? "bg-amber-500/20"
                : "bg-zinc-700/50"
            }`}>
              <Zap className={`w-5 h-5 ${
                autonomousState?.state === "running" 
                  ? "text-emerald-400" 
                  : autonomousState?.state === "paused"
                  ? "text-amber-400"
                  : "text-zinc-500"
              }`} />
            </div>
            <div>
              <h4 className="font-medium text-white">Autonomous Mode</h4>
              <p className="text-xs text-zinc-500">
                {autonomousState?.state === "running" 
                  ? `Active - checking every ${(autonomousState.config?.interval_seconds || 900) / 60} min`
                  : autonomousState?.state === "paused"
                  ? "Paused"
                  : "Enable for hands-free rebalancing"}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {autonomousState?.state === "running" && (
              <>
                <button
                  onClick={pauseAutonomous}
                  disabled={autonomousLoading}
                  className="p-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 rounded-lg transition-colors"
                  title="Pause"
                >
                  <Pause className="w-4 h-4 text-amber-400" />
                </button>
                <button
                  onClick={stopAutonomous}
                  disabled={autonomousLoading}
                  className="p-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded-lg transition-colors"
                  title="Stop"
                >
                  <Power className="w-4 h-4 text-red-400" />
                </button>
              </>
            )}
            
            {autonomousState?.state === "paused" && (
              <>
                <button
                  onClick={resumeAutonomous}
                  disabled={autonomousLoading}
                  className="p-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-lg transition-colors"
                  title="Resume"
                >
                  <Play className="w-4 h-4 text-emerald-400" />
                </button>
                <button
                  onClick={stopAutonomous}
                  disabled={autonomousLoading}
                  className="p-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded-lg transition-colors"
                  title="Stop"
                >
                  <Power className="w-4 h-4 text-red-400" />
                </button>
              </>
            )}
            
            {(autonomousState?.state === "stopped" || !autonomousState) && (
              <button
                onClick={() => sessionId ? startAutonomous() : setShowAutonomousSettings(true)}
                disabled={autonomousLoading || !sessionId}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {autonomousLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Power className="w-4 h-4" />
                )}
                Enable
              </button>
            )}
          </div>
        </div>
        
        {/* Status info when running */}
        {autonomousState?.state === "running" && (
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">Last Check</span>
              </div>
              <p className="text-sm font-mono text-zinc-300">
                {autonomousState.last_check 
                  ? new Date(autonomousState.last_check).toLocaleTimeString()
                  : "Pending..."}
              </p>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">Checks</span>
              </div>
              <p className="text-sm font-mono text-zinc-300">
                {autonomousState.checks_count || 0}
              </p>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">Actions</span>
              </div>
              <p className="text-sm font-mono text-zinc-300">
                {autonomousState.actions_taken || 0}
              </p>
            </div>
          </div>
        )}
        
        {/* No session key warning */}
        {!sessionId && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Session key required for autonomous mode. Create one in Session Keys panel.</span>
          </div>
        )}
      </div>
      
      {/* Proposals List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No rebalancing proposals</p>
          <p className="text-xs mt-1">Propose a rebalance to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <div
              key={proposal.proposal_id}
              className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400">{PROTOCOL_NAMES[proposal.from_protocol] ?? "Unknown"}</span>
                    <ArrowRight className="w-4 h-4 text-zinc-600" />
                    <span className="text-white">{PROTOCOL_NAMES[proposal.to_protocol] ?? "Unknown"}</span>
                  </div>
                  <span className="text-sm text-zinc-500">
                    {(proposal.amount ?? 0).toLocaleString()} tokens
                  </span>
                </div>
                {getStatusBadge(proposal.status)}
              </div>
              
              <p className="text-xs text-zinc-500 mb-3">{proposal.reason}</p>
              {proposal.snapshot_hash && (
                <p className="text-xs text-zinc-500 font-mono mb-2" title={proposal.snapshot_hash}>
                  snap {typeof proposal.snapshot_hash === "string" && proposal.snapshot_hash.length > 14
                    ? `${proposal.snapshot_hash.slice(0, 8)}…${proposal.snapshot_hash.slice(-6)}`
                    : proposal.snapshot_hash}
                </p>
              )}
              {/* zkML Results */}
              {(proposal.risk_proof || proposal.anomaly_proof) && (
                <div className="flex gap-2 mb-3">
                  {proposal.risk_proof && (
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                      proposal.risk_proof.is_compliant 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : "bg-red-500/20 text-red-400"
                    }`}>
                      {proposal.risk_proof.is_compliant ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      Risk: {proposal.risk_proof.is_compliant ? "Pass" : "Fail"}
                    </div>
                  )}
                  {proposal.anomaly_proof && (
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                      proposal.anomaly_proof.is_safe 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : "bg-red-500/20 text-red-400"
                    }`}>
                      {proposal.anomaly_proof.is_safe ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      Pool: {proposal.anomaly_proof.is_safe ? "Safe" : "Anomaly"}
                    </div>
                  )}
                </div>
              )}
              
              {proposal.error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3">
                  <p className="text-xs text-red-400">Execution failed: {proposal.error}</p>
                </div>
              )}
              
              {proposal.tx_hash && !proposal.error && (
                <div className="text-xs text-zinc-500">
                  TX: <span className="font-mono">{proposal.tx_hash.slice(0, 10)}...{proposal.tx_hash.slice(-8)}</span>
                </div>
              )}
              
              {/* Why did this execute? — Proof timeline from proposal proofs + receipt */}
              {(proposal.risk_proof || proposal.anomaly_proof || (proposal.tx_hash && !proposal.error)) && (
                <div className="mt-2 p-3 bg-zinc-800/50 border border-zinc-700/50 rounded-lg">
                  <ProofTimeline
                    receipts={[
                      ...(proposal.risk_proof
                        ? [{
                            proof_type: "risk_score",
                            threshold_or_model: "30",
                            result: proposal.risk_proof.is_compliant ? "compliant" : "non_compliant",
                            timestamp: proposal.created_at,
                            model_hash: "risk_v1",
                            snapshot_hash: proposal.snapshot_hash ?? undefined,
                          }]
                        : []),
                      ...(proposal.anomaly_proof
                        ? [{
                            proof_type: "pool_safety",
                            threshold_or_model: "anomaly",
                            result: proposal.anomaly_proof.is_safe ? "safe" : "unsafe",
                            timestamp: proposal.created_at,
                            model_hash: "anomaly_v1",
                            snapshot_hash: proposal.snapshot_hash ?? undefined,
                          }]
                        : []),
                      ...(proposal.tx_hash && !proposal.error
                        ? [{
                            proof_type: "rebalance",
                            threshold_or_model: proposal.proposal_id,
                            result: "completed",
                            timestamp: proposal.created_at,
                            tx_hash: proposal.tx_hash,
                            snapshot_hash: proposal.snapshot_hash ?? undefined,
                          }]
                        : []),
                    ]}
                    compact={true}
                    title="Why did this execute?"
                  />
                </div>
              )}
              
              {/* Actions */}
              <div className="flex gap-2 mt-3">
                {proposal.status === "pending" && (
                  <button
                    onClick={() => runZkmlChecks(proposal.proposal_id)}
                    disabled={processing === proposal.proposal_id}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                  >
                    {processing === proposal.proposal_id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Brain className="w-3 h-3" />
                    )}
                    Run zkML Checks
                  </button>
                )}
                
                {(proposal.status === "zkml_passed" || proposal.status === "ready_to_execute") && (
                  <>
                    {userTier >= 1 && (
                      <p className="text-xs text-amber-400/90 mb-2">
                        Recipient and amount may be visible on-chain for your tier.
                      </p>
                    )}
                    <button
                      onClick={() => prepareAndExecute(proposal.proposal_id)}
                      disabled={processing === proposal.proposal_id || !sessionId}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                    >
                      {processing === proposal.proposal_id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      Execute
                    </button>
                  </>
                )}
              </div>
              
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400 mt-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    Execution pipeline
                  </span>
                  <span className="text-zinc-300">~15-30s total</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Commit (MEV-protected) → zkML verify → Groth16 proof → on-chain execute → receipt
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Propose Modal */}
      {showPropose && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-700 p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Propose Rebalance</h3>
              <button
                onClick={() => setShowPropose(false)}
                className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">From Protocol</label>
                  <select
                    value={fromProtocol}
                    onChange={(e) => setFromProtocol(parseInt(e.target.value))}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  >
                    {PROTOCOL_NAMES.map((name, idx) => (
                      <option key={idx} value={idx}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">To Protocol</label>
                  <select
                    value={toProtocol}
                    onChange={(e) => setToProtocol(parseInt(e.target.value))}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  >
                    {PROTOCOL_NAMES.map((name, idx) => (
                      <option key={idx} value={idx}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Amount</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Reason</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 flex items-start gap-2">
                <Brain className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-cyan-200">
                  This proposal will be checked by zkML models (risk score + anomaly detection) before execution.
                </p>
              </div>
              
              {/* Pool passport for selected To pool */}
              {showPropose && (
                <div className="rounded-lg border border-zinc-700 p-3 text-xs">
                  <span className="text-zinc-400">Pool passport ({PROTOCOL_NAMES[toProtocol]}): </span>
                  {poolPassport === null ? (
                    <span className="text-zinc-500">Loading...</span>
                  ) : poolPassport.safe === null ? (
                    <span className="text-zinc-500">Not analyzed yet</span>
                  ) : (
                    <span className={poolPassport.safe ? "text-emerald-400" : "text-amber-400"}>
                      {poolPassport.safe ? "Safe" : "Not safe"}
                      {poolPassport.health_score != null && ` (${poolPassport.health_score})`}
                    </span>
                  )}
                </div>
              )}
              
              <button
                onClick={handlePropose}
                disabled={processing === "proposing" || fromProtocol === toProtocol}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {processing === "proposing" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Propose Rebalance
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
