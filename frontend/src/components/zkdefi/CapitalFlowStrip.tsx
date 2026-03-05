"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ArrowRight } from "lucide-react";

type ProofStatus = "OK" | "WARNING" | "FAIL";

export interface CapitalFlowStripProps {
  proofsState: {
    policyEnforced: ProofStatus;
    riskWithinBound: ProofStatus;
    mevProtection: ProofStatus;
    overall: ProofStatus;
  };
  isConnected: boolean;
  hasOnboarded: boolean;
  commitmentCount: number;
  activeSessionCount: number;
  agentStatus: "idle" | "monitoring" | "executing";
  pendingRebalance: boolean;
  aiInsight: string | null;
  onNavigate: (surface: string, subTab?: string) => void;
}

function StatusIcon({ status }: { status: ProofStatus }) {
  if (status === "OK") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "WARNING") return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
  return <XCircle className="w-3.5 h-3.5 text-red-400" />;
}

function overallStyles(overall: ProofStatus) {
  if (overall === "OK") return "border-emerald-700/30 text-emerald-400";
  if (overall === "WARNING") return "border-amber-700/30 text-amber-400";
  return "border-red-700/30 text-red-400";
}

function deriveNextStep(props: CapitalFlowStripProps): {
  text: string;
  cta?: { label: string; surface: string; sub?: string };
} {
  if (!props.isConnected) {
    return { text: "Connect wallet to start" };
  }
  if (!props.hasOnboarded) {
    return {
      text: "Complete onboarding to set up your identity",
      cta: { label: "Onboard", surface: "vault", sub: "onboarding" },
    };
  }
  if (props.commitmentCount === 0) {
    return {
      text: "Deposit to fund your vault",
      cta: { label: "Deposit", surface: "vault" },
    };
  }
  if (props.activeSessionCount === 0) {
    return {
      text: "Grant a session key to enable your agent",
      cta: { label: "Grant", surface: "brain", sub: "agent" },
    };
  }
  if (props.agentStatus === "idle") {
    return {
      text: "Start your agent to begin autonomous execution",
      cta: { label: "Start", surface: "brain", sub: "agent" },
    };
  }
  if (props.pendingRebalance) {
    return { text: "Rebalance pending — MEV protected" };
  }
  if (props.agentStatus === "executing") {
    return { text: "Agent executing — proof pipeline active" };
  }
  if (props.aiInsight) {
    return { text: props.aiInsight };
  }
  return { text: "Agent active — earning yield" };
}

export function CapitalFlowStrip(props: CapitalFlowStripProps) {
  const [expanded, setExpanded] = useState(false);
  const { proofsState } = props;
  const nextStep = deriveNextStep(props);

  return (
    <div className="relative rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 flex items-center justify-between gap-4">
      {/* Left: Proof gate status */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={`flex items-center gap-2 text-xs font-medium transition-colors ${overallStyles(proofsState.overall)}`}
      >
        <StatusIcon status={proofsState.overall} />
        <span>
          {proofsState.overall === "OK"
            ? "Gates OK"
            : proofsState.overall === "WARNING"
              ? "Gates Warning"
              : "Gates Fail"}
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="absolute left-0 top-full mt-1.5 z-20 min-w-[220px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-lg">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-400">Policy enforced</span>
              <StatusIcon status={proofsState.policyEnforced} />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-400">Risk within bound</span>
              <StatusIcon status={proofsState.riskWithinBound} />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-400">MEV protection</span>
              <StatusIcon status={proofsState.mevProtection} />
            </div>
          </div>
        </div>
      )}

      {/* Right: Next step */}
      <div className="flex items-center gap-3 text-xs min-w-0 flex-1 justify-end">
        <span className="text-zinc-400 truncate">{nextStep.text}</span>
        {nextStep.cta && (
          <button
            type="button"
            onClick={() => props.onNavigate(nextStep.cta!.surface, nextStep.cta!.sub)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors font-medium whitespace-nowrap"
          >
            {nextStep.cta.label}
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
