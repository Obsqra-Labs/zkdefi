"use client";

import React, { useEffect, useState } from "react";
import { Brain, Cpu, FileCheck, CheckCircle, Send } from "lucide-react";

const STEPS = [
  { id: "decision", label: "AI Decision", icon: Brain, desc: "LLM selects skill" },
  { id: "zkml", label: "zkML Circuit", icon: Cpu, desc: "Witness generated" },
  { id: "proof", label: "Proof Generated", icon: FileCheck, desc: "Groth16 BN254" },
  { id: "verify", label: "On-chain Verify", icon: CheckCircle, desc: "Receipt confirmed" },
  { id: "execute", label: "Execution", icon: Send, desc: "Capital deployed" },
];

const STEP_DETAILS: Record<string, { title: string; description: string; privacy: string; output: string }> = {
  decision: {
    title: "AI Decision",
    description: "The LLM-powered agent evaluates market conditions, your portfolio state, and risk parameters to propose an action (rebalance, harvest, or hold).",
    privacy: "Your portfolio composition and strategy are never sent to external LLMs — the agent runs locally with privacy-preserving inputs.",
    output: "Decision payload with proposed action, target pool, and confidence score.",
  },
  zkml: {
    title: "zkML Circuit Evaluation",
    description: "The proposed action is evaluated by zkML circuits (RiskScore, AnomalyDetector, SlippageBound) to verify it satisfies your risk constraints.",
    privacy: "Circuit inputs (position sizes, historical returns) are private witnesses — only the pass/fail result is public.",
    output: "Circuit evaluation result: pass or fail for each constraint.",
  },
  proof: {
    title: "Proof Generation (Groth16)",
    description: "A Groth16 zero-knowledge proof is generated on the BN254 curve, attesting that all constraint checks passed without revealing the underlying data.",
    privacy: "The proof reveals nothing about your positions, strategy, or risk profile — only that constraints are satisfied.",
    output: "Groth16 proof (π) with public inputs hash. ~10-15 seconds generation time.",
  },
  verify: {
    title: "On-chain Verification",
    description: "The proof is submitted to the Garaga verifier contract on Starknet. The VaultController checks the proof against the registered policy root before allowing execution.",
    privacy: "On-chain verification reveals only the public inputs hash and pass/fail — no private data leaves the client.",
    output: "Verification transaction hash and fact registry entry.",
  },
  execute: {
    title: "Execution & Receipt",
    description: "Once verified, the VaultController executes the action through the appropriate adapter (Ekubo LP, Lending, Staking). A cryptographic receipt is produced.",
    privacy: "Execution uses the vault's shielded balance — the adapter sees a commitment, not a wallet address or balance.",
    output: "ConstraintReceipt with action hash, proof reference, and timestamp. Stored on-chain and in backend timeline.",
  },
};

interface ZKGatePipelineProps {
  activeStep?: string;
  completed?: boolean;
  /** Optional execution ID to poll for real step updates. */
  executionId?: string;
  /** Optional callback fired when pipeline reaches a new step. */
  onStepChange?: (stepId: string) => void;
}

export function ZKGatePipeline({
  activeStep: activeStepProp,
  completed = false,
  executionId,
  onStepChange,
}: ZKGatePipelineProps) {
  const [liveStep, setLiveStep] = useState<string | undefined>(activeStepProp);
  const [stepTimings, setStepTimings] = useState<Record<string, number>>({});
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  // If parent passes activeStep, use it; otherwise drive from internal state
  const activeStep = activeStepProp ?? liveStep;

  // Track when each step was reached for duration display
  useEffect(() => {
    if (activeStep && !stepTimings[activeStep]) {
      setStepTimings((prev) => ({ ...prev, [activeStep]: Date.now() }));
      onStepChange?.(activeStep);
    }
  }, [activeStep]);

  // Auto-advance on "executing" agentStatus: simulate pipeline progression
  useEffect(() => {
    if (!completed || !activeStepProp) return;
    const sequence = STEPS.map((s) => s.id);
    let idx = 0;
    const timer = setInterval(() => {
      if (idx < sequence.length) {
        setLiveStep(sequence[idx]);
        idx++;
      } else {
        clearInterval(timer);
      }
    }, 600);
    return () => clearInterval(timer);
  }, [completed, activeStepProp]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">ZK Gate Pipeline</h3>
      <p className="text-sm text-zinc-500 mb-6">
        AI Decision → zkML Circuit → Proof Generated → On-chain Verify → Execution. Execution is gated by proof verification.
      </p>
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const isActive = activeStep === step.id;
          const isPast = completed || (activeStep && STEPS.findIndex((s) => s.id === activeStep) > i);
          const timing = stepTimings[step.id];
          const prevTiming = i > 0 ? stepTimings[STEPS[i - 1].id] : undefined;
          const durationMs = timing && prevTiming ? timing - prevTiming : undefined;
          return (
            <React.Fragment key={step.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setSelectedStep((prev) => (prev === step.id ? null : step.id))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedStep((prev) => (prev === step.id ? null : step.id)); } }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  selectedStep === step.id
                    ? "ring-2 ring-emerald-400/60 border-emerald-400/50 bg-emerald-950/40"
                    : isActive
                    ? "border-emerald-500/50 bg-emerald-950/30"
                    : isPast
                    ? "border-emerald-700/40 bg-emerald-950/10"
                    : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-500"
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? "bg-emerald-600/30 text-emerald-400" : isPast ? "bg-emerald-600/20 text-emerald-500" : "bg-zinc-700 text-zinc-500"}`}>
                  {isActive ? (
                    <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-300">{step.label}</p>
                  <p className="text-[10px] text-zinc-500">
                    {isActive
                      ? "Running…"
                      : isPast
                      ? durationMs
                        ? `Done (${(durationMs / 1000).toFixed(1)}s)`
                        : "Done"
                      : step.desc}
                  </p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`hidden sm:block w-6 h-px ${isPast ? "bg-emerald-600/40" : "bg-zinc-700"}`} aria-hidden />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {selectedStep && STEP_DETAILS[selectedStep] && (
        <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900/80 p-5 space-y-3 animate-in fade-in duration-200">
          <h4 className="text-sm font-semibold text-white">{STEP_DETAILS[selectedStep].title}</h4>
          <p className="text-xs text-zinc-300">{STEP_DETAILS[selectedStep].description}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-emerald-950/20 border border-emerald-700/20 p-3">
              <p className="text-[11px] text-emerald-400/80 font-medium mb-1">Privacy guarantee</p>
              <p className="text-xs text-zinc-300">{STEP_DETAILS[selectedStep].privacy}</p>
            </div>
            <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
              <p className="text-[11px] text-zinc-400 font-medium mb-1">Output</p>
              <p className="text-xs text-zinc-300">{STEP_DETAILS[selectedStep].output}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedStep(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
