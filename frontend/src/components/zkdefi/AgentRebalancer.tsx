"use client";

import { useState, useEffect } from "react";
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
  Activity
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";

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
  tx_hash?: string;
  error?: string;
}

interface AgentRebalancerProps {
  userAddress: string;
  sessionId?: string;
  positions?: { [key: string]: number };
}

const PROTOCOL_NAMES = ["Pools", "Ekubo", "JediSwap"];

export function AgentRebalancer({ 
  userAddress, 
  sessionId,
  positions = {}
}: AgentRebalancerProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [showPropose, setShowPropose] = useState(false);
  
  // Propose form
  const [fromProtocol, setFromProtocol] = useState(0);
  const [toProtocol, setToProtocol] = useState(1);
  const [amount, setAmount] = useState(1000);
  const [reason, setReason] = useState("Risk optimization");
  
  useEffect(() => {
    if (userAddress) {
      fetchProposals();
    }
  }, [userAddress]);
  
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
  
  const handlePropose = async () => {
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
        
        // Automatically run zkML checks
        await runZkmlChecks(proposal.proposal_id);
      }
    } catch (error) {
      console.error("Failed to propose:", error);
    } finally {
      setProcessing(null);
    }
  };
  
  const runZkmlChecks = async (proposalId: string) => {
    setProcessing(proposalId);
    try {
      // Generate portfolio features
      const portfolioFeatures = Object.values(positions).length > 0
        ? generatePortfolioFeatures(positions)
        : [50, 30, 20, 20, 50, 30, 10, 20];
      
      await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposalId,
          portfolio_features: portfolioFeatures,
          pool_id: `pool_${toProtocol}`
        })
      });
      
      await fetchProposals();
    } catch (error) {
      console.error("Failed to run zkML checks:", error);
    } finally {
      setProcessing(null);
    }
  };
  
  const prepareAndExecute = async (proposalId: string) => {
    if (!sessionId) {
      alert("Session key required for execution");
      return;
    }
    
    setProcessing(proposalId);
    try {
      // Prepare
      await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposalId,
          session_id: sessionId
        })
      });
      
      // Execute
      await fetch(`${API_BASE}/api/v1/zkdefi/rebalancer/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposalId,
          session_id: sessionId
        })
      });
      
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
            <p className="text-xs text-zinc-500">zkML-gated autonomous execution</p>
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
                    <span className="text-zinc-400">{PROTOCOL_NAMES[proposal.from_protocol]}</span>
                    <ArrowRight className="w-4 h-4 text-zinc-600" />
                    <span className="text-white">{PROTOCOL_NAMES[proposal.to_protocol]}</span>
                  </div>
                  <span className="text-sm text-zinc-500">
                    {proposal.amount.toLocaleString()} tokens
                  </span>
                </div>
                {getStatusBadge(proposal.status)}
              </div>
              
              <p className="text-xs text-zinc-500 mb-3">{proposal.reason}</p>
              
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
                  <p className="text-xs text-red-400">{proposal.error}</p>
                </div>
              )}
              
              {proposal.tx_hash && (
                <div className="text-xs text-zinc-500">
                  TX: <span className="font-mono">{proposal.tx_hash.slice(0, 10)}...{proposal.tx_hash.slice(-8)}</span>
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
                )}
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
