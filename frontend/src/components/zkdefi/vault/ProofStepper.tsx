"use client";

/**
 * ProofStepper — Step-by-step visualization of proof pipeline.
 * Inspired by obsqra.fi DataPathVisualization with horizontal stepper.
 */

import { Check, Loader2, X, Circle } from "lucide-react";

export interface ProofStepperProps {
  steps: Array<{
    label: string;
    status: "pending" | "active" | "done" | "error";
    description?: string;
  }>;
}

export function ProofStepper({ steps }: ProofStepperProps) {
  if (steps.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;

          let icon;
          let iconColor;
          let lineColor;

          if (step.status === "done") {
            icon = <Check className="w-4 h-4" />;
            iconColor = "bg-emerald-500 text-white";
            lineColor = "bg-emerald-500";
          } else if (step.status === "active") {
            icon = <Loader2 className="w-4 h-4 animate-spin" />;
            iconColor = "bg-blue-500 text-white";
            lineColor = "bg-zinc-700";
          } else if (step.status === "error") {
            icon = <X className="w-4 h-4" />;
            iconColor = "bg-red-500 text-white";
            lineColor = "bg-zinc-700";
          } else {
            icon = <Circle className="w-3 h-3" />;
            iconColor = "bg-zinc-700 text-zinc-500";
            lineColor = "bg-zinc-700";
          }

          return (
            <div key={index} className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconColor}`}>
                  {icon}
                </div>
                <span className="text-xs text-zinc-400 whitespace-nowrap">{step.label}</span>
                {step.description && (
                  <span className="text-xs text-zinc-600 whitespace-nowrap">{step.description}</span>
                )}
              </div>
              {!isLast && (
                <div className={`h-0.5 w-8 ${lineColor}`} aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Pre-defined step sequences per privacy tier
export const COMMITMENT_SHIELD_STEPS = [
  { label: "Generate Commitment", status: "pending" as const },
  { label: "Approve & Sign", status: "pending" as const },
  { label: "Confirm", status: "pending" as const },
];

export const NULLIFIER_SET_STEPS = [
  { label: "Generate Secret", status: "pending" as const },
  { label: "Register in Tree", status: "pending" as const },
  { label: "Build Proof", status: "pending" as const },
  { label: "Approve & Sign", status: "pending" as const },
];

export const HASHED_PROOF_STEPS = [
  { label: "Generate Hash Inputs", status: "pending" as const },
  { label: "Build Hash Proof", status: "pending" as const },
  { label: "Register Claim", status: "pending" as const },
  { label: "Approve & Sign", status: "pending" as const },
];

export const DARK_LEDGER_STEPS = [
  { label: "Verify Tx", status: "pending" as const },
  { label: "Credit Ledger", status: "pending" as const },
  { label: "Done", status: "pending" as const },
];
