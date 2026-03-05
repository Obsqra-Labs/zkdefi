"use client";

/**
 * BrainSurfaceContainer — canonical automation / AI surface.
 *
 * WP-4 Brain Systemization:
 * - Session key controls are first-class, top-of-surface (banner
 *   visible across ALL sub-tabs, not just agent).
 * - Standard gate outcomes / advisory copy via ExecutionContext.
 * - Pipeline visibility for every autonomous action path:
 *   dedicated "pipeline" sub-tab with ZKGatePipeline,
 *   ExecutionLoopCard, and ExecutionControlRail.
 * - AutomationControlPanel integrated alongside AgentRebalancer.
 *
 * Absorbs: agent controls (BrainVisualizer, SessionKeyManager,
 * AgentRebalancer, AutomationControlPanel), models (ModelComposer,
 * MyAgents), pipeline (ZKGatePipeline, ExecutionLoopCard,
 * ExecutionControlRail), and agents (AgentBuilder, AgentDashboard,
 * AgentPerformanceDashboard, AgentLeaderboard, SkillMarketplace).
 */

import { useState, useCallback, useEffect } from "react";
import { Brain, Bot, Boxes, Key, GitBranch, Shield, Activity, Cpu, Sparkles, FileCheck } from "lucide-react";

import { BrainVisualizer } from "@/components/zkdefi/BrainVisualizer";
import { SessionKeyManager } from "@/components/zkdefi/SessionKeyManager";
import { AgentRebalancer } from "@/components/zkdefi/AgentRebalancer";
import { AutomationControlPanel } from "@/components/zkdefi/AutomationControlPanel";
import { ModelComposer } from "@/components/zkdefi/ModelComposer";
import { MyAgents } from "@/components/zkdefi/MyAgents";
import { CircuitReadoutPanel } from "@/components/zkdefi/CircuitReadoutPanel";
import { ProofTimeline } from "@/components/zkdefi/ProofTimeline";
import { ZKGatePipeline } from "@/components/zkdefi/ZKGatePipeline";
import { ExecutionLoopCard } from "@/components/zkdefi/ExecutionLoopCard";
import { ExecutionControlRail } from "@/components/zkdefi/ExecutionControlRail";
import { AIInsightsCard } from "@/components/zkdefi/AIInsightsCard";
import { LLMProviderHealth } from "@/components/zkdefi/LLMProviderHealth";

import { AgentBuilder } from "@/components/zkdefi/AgentBuilder";
import { AgentDashboard } from "@/components/zkdefi/AgentDashboard";
import { AgentPerformanceDashboard } from "@/components/zkdefi/AgentPerformanceDashboard";
import { AgentLeaderboard } from "@/components/zkdefi/AgentLeaderboard";
import { SkillMarketplace } from "@/components/zkdefi/SkillMarketplace";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import { useExecutionContext } from "@/hooks/useExecutionContext";
import { useApp } from "@/lib/AppContext";
import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BrainSubTab = "agent" | "models" | "pipeline" | "agents";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrainSurfaceContainerProps {
  address: string | undefined;
  /** Initial sub-tab override (deep link compat). */
  initialSubTab?: BrainSubTab;
  /** Optional positions blob from vault (bridged via shell). */
  positions?: Record<string, number>;
  /** Optional user tier from vault (bridged via shell). */
  userTier?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BrainSurfaceContainer({
  address,
  initialSubTab = "agent",
  positions,
  userTier,
}: BrainSurfaceContainerProps) {
  const cardFallback = (label: string) => (
    <div className="rounded-lg border border-red-700/30 bg-red-950/20 p-4">
      <p className="text-sm font-medium text-red-300">{label} unavailable</p>
      <p className="mt-1 text-xs text-red-300/80">
        This panel failed to render. Reload the page or open another sub-tab.
      </p>
    </div>
  );

  const [subTab, setSubTab] = useState<BrainSubTab>(initialSubTab);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<
    "idle" | "monitoring" | "executing"
  >("idle");
  const [agentRefreshTrigger, setAgentRefreshTrigger] = useState(0);
  const [pipelineStep, setPipelineStep] = useState<string | undefined>(undefined);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessionConstraints, setSessionConstraints] = useState<{
    risk_profile: string | null;
    max_position_usd: number | null;
    session_duration_hours: number | null;
  } | null>(null);

  const [proofReceipts, setProofReceipts] = useState<any[]>([]);
  const [profileV2, setProfileV2] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Execution context: passport, sessions, compliance
  const execCtx = useExecutionContext(address);
  const { hasOnboarded } = useApp();

  useEffect(() => {
    if (!address) { setProofReceipts([]); return; }
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_passport/user/${address}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok && !dead) {
          const data = await res.json();
          const receipts = Array.isArray(data?.proof_receipts) ? data.proof_receipts : [];
          setProofReceipts(receipts.slice(0, 10));
        }
      } catch { /* best effort */ }
    })();
    return () => { dead = true; };
  }, [address]);

  // Fetch v2 profile for AIInsightsCard
  useEffect(() => {
    if (!address) { setProfileV2(null); return; }
    let dead = false;
    setProfileLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_profile/v2/${address}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok && !dead) {
          setProfileV2(await res.json());
        }
      } catch { /* best effort */ }
      if (!dead) setProfileLoading(false);
    })();
    return () => { dead = true; };
  }, [address]);

  const handleSessionGranted = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  // Derive pipeline step from agent status — finer-grained mapping
  useEffect(() => {
    if (agentStatus === "executing") {
      // Walk through all 5 steps in sequence
      const steps = ["decision", "zkml", "proof", "verify", "execute"];
      let idx = 0;
      setPipelineStep(steps[0]);
      const timer = setInterval(() => {
        idx++;
        if (idx < steps.length) {
          setPipelineStep(steps[idx]);
        } else {
          clearInterval(timer);
        }
      }, 800);
      return () => clearInterval(timer);
    } else if (agentStatus === "monitoring") {
      setPipelineStep("decision");
    } else {
      setPipelineStep(undefined);
    }
  }, [agentStatus]);

  return (
    <div className="space-y-6">
      {/* ================================================================ */}
      {/* Sub-navigation                                                   */}
      {/* ================================================================ */}
      <div className="flex gap-2 border-b border-zinc-800 pb-3 flex-wrap">
        <button
          onClick={() => setSubTab("agent")}
          className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${subTab === "agent" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          <Brain className="w-4 h-4" /> Agent Controls
        </button>
        <button
          onClick={() => setSubTab("models")}
          className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${subTab === "models" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          <Boxes className="w-4 h-4" /> zkML Models
        </button>
        <button
          onClick={() => setSubTab("pipeline")}
          className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${subTab === "pipeline" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          <GitBranch className="w-4 h-4" /> Pipeline
        </button>
        <button
          onClick={() => setSubTab("agents")}
          className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${subTab === "agents" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          <Bot className="w-4 h-4" /> Agents
        </button>
      </div>

      {/* ================================================================ */}
      {/* Session Key Status Banner — always visible (first-class)         */}
      {/* ================================================================ */}
      <div
        className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-3 ${
          activeSessionId
            ? "bg-emerald-950/30 border border-emerald-700/40 text-emerald-300"
            : "bg-zinc-800/50 border border-zinc-700 text-zinc-400"
        }`}
      >
        <div className="flex items-center gap-3">
          <Key className="w-4 h-4 flex-shrink-0" />
          {activeSessionId ? (
            <>
              Session active:{" "}
              <span className="font-mono text-xs">
                {activeSessionId.slice(0, 12)}…
              </span>
            </>
          ) : (
            "No active session key — grant one on Agent Controls to enable autonomous execution"
          )}
        </div>
        {/* Gate status summary */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-400">
              Passport: {execCtx.passportScore ?? "—"} ({execCtx.passportTier})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-400">
              Sessions: {execCtx.activeSessionCount}
            </span>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* SUB-TAB: Agent Controls                                          */}
      {/* ================================================================ */}
      {subTab === "agent" && !address && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Brain className="w-12 h-12 text-zinc-600 mb-4" />
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">Connect Wallet</h3>
          <p className="text-sm text-zinc-500 max-w-md">
            Connect your wallet to access agent controls, session key management, and autonomous execution.
          </p>
        </div>
      )}

      {subTab === "agent" && address && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* v6: AI Credit Insights — zkML powered */}
            <AIInsightsCard profileV2={profileV2} loading={profileLoading} />

            {/* v6 Tech Stack Banner */}
            <div className="rounded-lg border border-violet-700/20 bg-gradient-to-r from-violet-950/20 to-indigo-950/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-violet-400" />
                <h4 className="text-sm font-semibold text-white">v6 AI + zkML + LLM Stack</h4>
                <span className="text-[9px] font-mono text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded">ACTIVE</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <Cpu className="w-3 h-3 text-cyan-400" />
                  <span>3 zkML Circuits</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>LLM Decision Engine</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <FileCheck className="w-3 h-3 text-emerald-400" />
                  <span>EZKL Prover</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <Shield className="w-3 h-3 text-violet-400" />
                  <span>Garaga Verifier</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                Session keys grant time-limited, constraint-bound execution rights. The agent operates within your risk bounds — all actions are proof-verified before capital moves.
              </span>
            </div>
            {/* Session Key Manager — first-class, top-of-surface */}
            <SessionKeyManager
              userAddress={address}
              onSessionGranted={handleSessionGranted}
            />

            <BrainVisualizer
              userAddress={address}
              onBrainComplete={(passed) => {
                setAgentStatus(passed ? "executing" : "idle");
              }}
            />

            <AgentRebalancer
              userAddress={address}
              sessionId={activeSessionId ?? undefined}
              positions={positions}
              userTier={userTier ?? 0}
            />

            {/* Automation Control — session-gated */}
            {activeSessionId && (
              <AutomationControlPanel
                userAddress={address}
                activeSessionId={activeSessionId}
                constraints={sessionConstraints}
              />
            )}
          </div>
          <div className="space-y-6">
            {/* Execution Control Rail */}
            <ExecutionControlRail address={address} compact />

            {/* How it works */}
            <div className="glass rounded-xl border border-zinc-800 p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Brain className="w-5 h-5 text-cyan-400" />
                How It Works
              </h3>
              <div className="space-y-3 text-sm text-zinc-400">
                {[
                  "Grant session key with constraints (max position, duration)",
                  "Agent monitors market data and your selected pool",
                  "Rebalances are verified by zkML risk models",
                  "Proofs submitted based on your reputation tier",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-600/20 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">
                      {i + 1}
                    </div>
                    <p>{step}</p>
                  </div>
                ))}
              </div>
            </div>
            <ProofTimeline receipts={proofReceipts} compact title="Recent proofs" />
            <LLMProviderHealth />
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* SUB-TAB: zkML Models                                             */}
      {/* ================================================================ */}
      {subTab === "models" && !address && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Boxes className="w-12 h-12 text-zinc-600 mb-4" />
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">Connect Wallet</h3>
          <p className="text-sm text-zinc-500 max-w-md">
            Connect your wallet to compose custom zkML agents and manage model deployments.
          </p>
        </div>
      )}

      {subTab === "models" && address && (
        <div className="space-y-6">
          <ErrorBoundary fallback={cardFallback("Unified Circuit Readout")}>
            <CircuitReadoutPanel userAddress={address} />
          </ErrorBoundary>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <ErrorBoundary fallback={cardFallback("Model Composer")}>
                <ModelComposer
                  userAddress={address}
                  onAgentCreated={() =>
                    setAgentRefreshTrigger((t) => t + 1)
                  }
                />
              </ErrorBoundary>

              {/* Info Panel */}
              <div className="glass rounded-xl border border-zinc-800 p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Boxes className="w-5 h-5 text-cyan-400" />
                  About zkML Models
                </h3>
                <div className="space-y-3 text-sm text-zinc-400">
                  <p>
                    Compose multiple zkML models into a custom agent. Each model
                    generates a zero-knowledge proof that verifies a specific
                    constraint without revealing your private data.
                  </p>
                  <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                    <p className="text-xs font-medium text-cyan-400 mb-2">
                      Groth16 / Circom
                    </p>
                    <p className="text-xs">
                      Fast, compact proofs for risk, anomaly, yield, slippage,
                      and execution safety constraints.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                    <p className="text-xs font-medium text-violet-400 mb-2">
                      ONNX / EZKL Bridge
                    </p>
                    <p className="text-xs">
                      Predictive models can be consumed as composable signals and
                      summarized into human-readable context by the agent stack.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <ErrorBoundary fallback={cardFallback("My Agents")}>
                <MyAgents
                  userAddress={address}
                  refreshTrigger={agentRefreshTrigger}
                />
              </ErrorBoundary>

              {/* Usage Guide */}
              <div className="glass rounded-xl border border-zinc-800 p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Brain className="w-5 h-5 text-emerald-400" />
                  How to Use
                </h3>
                <div className="space-y-3 text-sm text-zinc-400">
                  {[
                    "Inspect full circuit + ONNX readout and choose signal set",
                    "Compose skills into one agent (LLM + proofs)",
                    "Run in signal mode for market-depth context",
                    "Promote selected signals to gates when you want stricter policy",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-cyan-600/20 flex items-center justify-center text-xs font-bold text-cyan-400 flex-shrink-0">
                        {i + 1}
                      </div>
                      <p>{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* SUB-TAB: Pipeline — gate/execution visibility                    */}
      {/* ================================================================ */}
      {subTab === "pipeline" && (
        <div className="space-y-6">
          {/* Execution loop overview */}
          <ExecutionLoopCard
            hasAccount={!!address}
            hasOnboarded={!!hasOnboarded}
            agentStatus={agentStatus}
          />

          {/* ZK Gate Pipeline visualization */}
          <ZKGatePipeline
            activeStep={pipelineStep}
            completed={agentStatus === "executing"}
          />

          {/* Gate status summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500 mb-1">Passport Score</p>
              <p className="text-2xl font-bold text-white">
                {execCtx.passportScore ?? "—"}
              </p>
              <p className="text-xs text-zinc-500">{execCtx.passportTier}</p>
            </div>
            <div className="glass rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500 mb-1">Active Sessions</p>
              <p className="text-2xl font-bold text-white">
                {execCtx.activeSessionCount}
              </p>
              <p className="text-xs text-zinc-500">
                {activeSessionId ? "Session granted" : "No session"}
              </p>
            </div>
            <div className="glass rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500 mb-1">Compliance Profiles</p>
              <p className="text-2xl font-bold text-white">
                {execCtx.complianceProfileCount}
              </p>
              <p className="text-xs text-zinc-500">
                {execCtx.complianceProfileCount > 0 ? "Active" : "None generated"}
              </p>
            </div>
            <div className="glass rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500 mb-1">Agent Status</p>
              <p className={`text-2xl font-bold ${
                agentStatus === "executing"
                  ? "text-orange-400"
                  : agentStatus === "monitoring"
                  ? "text-cyan-400"
                  : "text-zinc-400"
              }`}>
                {agentStatus === "executing"
                  ? "Executing"
                  : agentStatus === "monitoring"
                  ? "Monitoring"
                  : "Idle"}
              </p>
              <p className="text-xs text-zinc-500">Autonomous loop</p>
            </div>
          </div>

          {/* Full Execution Control Rail */}
          {address && <ExecutionControlRail address={address} />}

          {/* Pipeline explainer */}
          <div className="glass rounded-xl border border-zinc-800 p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-cyan-400" />
              Pipeline Architecture
            </h3>
            <div className="space-y-3 text-sm text-zinc-400">
              <p>
                Every autonomous action follows this pipeline:{" "}
                <span className="text-zinc-200">
                  Vault → AI Brain → ZK Gate → Execute → Receipt
                </span>.
                Capital only moves after all gate checks pass.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                  <p className="text-xs font-medium text-emerald-400 mb-1">Gate Checks</p>
                  <ul className="text-xs text-zinc-500 space-y-1">
                    <li>• Risk passport score threshold</li>
                    <li>• Session key constraints (amount, duration)</li>
                    <li>• Pool safety analysis</li>
                    <li>• zkML anomaly detection</li>
                  </ul>
                </div>
                <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                  <p className="text-xs font-medium text-cyan-400 mb-1">Proof Generation</p>
                  <ul className="text-xs text-zinc-500 space-y-1">
                    <li>• Tier 0: Cairo perceptron (on-chain)</li>
                    <li>• Tier 1: Groth16 circuit proofs</li>
                    <li>• Tier 2: RISC Zero advanced proofs</li>
                    <li>• Execution proof for settlement</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* SUB-TAB: Agents — build, deploy, monitor                        */}
      {/* ================================================================ */}
      {subTab === "agents" && !address && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bot className="w-12 h-12 text-zinc-600 mb-4" />
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">Connect Wallet</h3>
          <p className="text-sm text-zinc-500 max-w-md">
            Connect your wallet to build, deploy, and monitor your autonomous agents.
          </p>
        </div>
      )}

      {subTab === "agents" && address && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass rounded-xl border border-zinc-800 p-6">
              <ErrorBoundary fallback={cardFallback("Agent Builder")}>
                <AgentBuilder address={address} />
              </ErrorBoundary>
            </div>
            <div className="glass rounded-xl border border-zinc-800 p-6">
              <ErrorBoundary fallback={cardFallback("Agent Dashboard")}>
                <AgentDashboard address={address} />
              </ErrorBoundary>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="glass rounded-xl border border-zinc-800 p-6">
              <ErrorBoundary fallback={cardFallback("Performance Dashboard")}>
                <AgentPerformanceDashboard agentId={selectedAgentId} />
              </ErrorBoundary>
            </div>
            <div className="glass rounded-xl border border-zinc-800 p-6">
              <ErrorBoundary fallback={cardFallback("Agent Leaderboard")}>
                <AgentLeaderboard onSelectAgent={(id) => setSelectedAgentId(id)} />
              </ErrorBoundary>
            </div>
            <div className="glass rounded-xl border border-zinc-800 p-6">
              <ErrorBoundary fallback={cardFallback("Skill Marketplace")}>
                <SkillMarketplace />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
