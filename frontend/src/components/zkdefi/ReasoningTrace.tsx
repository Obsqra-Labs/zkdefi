"use client";

/**
 * ReasoningTrace — Displays the LLM reasoning → skill execution → synthesis
 * pipeline from a single agent execution run.
 */

import { useState } from "react";
import {
  Brain,
  Cpu,
  Sparkles,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Zap,
} from "lucide-react";

export interface TraceStep {
  step_type: "llm_reasoning" | "skill_execution" | "llm_synthesis" | string;
  skill_id?: string | null;
  input_params?: Record<string, unknown> | null;
  result_summary?: Record<string, unknown> | null;
  duration_ms: number;
  success: boolean;
}

export interface ReasoningTraceProps {
  steps: TraceStep[];
  llmProviderUsed?: string;
  llmTokensUsed?: number;
  llmFallbackReason?: string | null;
  totalTimeMs?: number;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  llm_reasoning: <Brain className="w-4 h-4 text-violet-400" />,
  skill_execution: <Cpu className="w-4 h-4 text-cyan-400" />,
  llm_synthesis: <Sparkles className="w-4 h-4 text-amber-400" />,
};

const STEP_LABELS: Record<string, string> = {
  llm_reasoning: "LLM Reasoning",
  skill_execution: "Skill Execution",
  llm_synthesis: "LLM Synthesis",
};

const STEP_COLORS: Record<string, string> = {
  llm_reasoning: "border-violet-600/30",
  skill_execution: "border-cyan-600/30",
  llm_synthesis: "border-amber-600/30",
};

export function ReasoningTrace({
  steps,
  llmProviderUsed,
  llmTokensUsed,
  llmFallbackReason,
  totalTimeMs,
}: ReasoningTraceProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <div className="text-xs text-zinc-500 italic py-2">
        No reasoning trace available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header strip */}
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <div className="flex items-center gap-3">
          {llmProviderUsed && (
            <span className="px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-600/20 font-medium">
              {llmProviderUsed}
            </span>
          )}
          {llmTokensUsed != null && llmTokensUsed > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {llmTokensUsed} tokens
            </span>
          )}
          {totalTimeMs != null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {totalTimeMs}ms total
            </span>
          )}
        </div>
        {llmFallbackReason && (
          <span className="text-amber-400 text-[10px]">
            Fallback: {llmFallbackReason}
          </span>
        )}
      </div>

      {/* Steps */}
      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-[11px] top-3 bottom-3 w-px bg-zinc-800" />

        <div className="space-y-2">
          {steps.map((step, idx) => {
            const expanded = expandedIdx === idx;
            const icon = STEP_ICONS[step.step_type] ?? <Cpu className="w-4 h-4 text-zinc-400" />;
            const label = STEP_LABELS[step.step_type] ?? step.step_type;
            const borderColor = STEP_COLORS[step.step_type] ?? "border-zinc-700";

            return (
              <div key={idx} className="relative pl-7">
                {/* Node dot */}
                <div className="absolute left-0 top-2.5 z-10">
                  <div className={`w-[22px] h-[22px] rounded-full flex items-center justify-center bg-zinc-900 border ${borderColor}`}>
                    {icon}
                  </div>
                </div>

                <button
                  onClick={() => setExpandedIdx(expanded ? null : idx)}
                  className={`w-full text-left rounded-lg border bg-zinc-900/50 p-3 transition-colors hover:bg-zinc-900 ${borderColor}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {expanded ? (
                        <ChevronDown className="w-3 h-3 text-zinc-500" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-zinc-500" />
                      )}
                      <span className="text-xs font-medium text-white">{label}</span>
                      {step.skill_id && (
                        <span className="text-[10px] text-zinc-500 font-mono">{step.skill_id}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500">{step.duration_ms}ms</span>
                      {step.success ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                    </div>
                  </div>

                  {/* Quick preview */}
                  {!expanded && step.result_summary && (
                    <p className="text-[10px] text-zinc-500 mt-1 truncate">
                      {step.step_type === "llm_reasoning" && step.result_summary.reasoning_preview
                        ? String(step.result_summary.reasoning_preview).slice(0, 100) + "…"
                        : step.step_type === "skill_execution" && step.result_summary.proof_hash
                          ? `Proof: ${String(step.result_summary.proof_hash).slice(0, 20)}…`
                          : step.step_type === "llm_synthesis" && step.result_summary.decision_preview
                            ? String(step.result_summary.decision_preview).slice(0, 100) + "…"
                            : ""}
                    </p>
                  )}
                </button>

                {/* Expanded detail */}
                {expanded && step.result_summary && (
                  <div className="mt-1 ml-5 rounded-lg bg-zinc-950 border border-zinc-800 p-3">
                    <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto">
                      {JSON.stringify(step.result_summary, null, 2)}
                    </pre>
                    {step.input_params && (
                      <>
                        <p className="text-[10px] text-zinc-600 mt-2 mb-1">Input:</p>
                        <pre className="text-[10px] text-zinc-500 font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">
                          {JSON.stringify(step.input_params, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
