"use client";

/**
 * ProofStepper — Step-by-step visualization of proof pipeline.
 * Inspired by obsqra.fi DataPathVisualization with horizontal stepper.
 */

import { Check, Loader2, X, Circle } from "lucide-react";
import { motion } from "framer-motion";

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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4" role="region" aria-label="Proof generation progress">
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
                {step.status === "done" ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${iconColor}`}
                  >
                    {icon}
                  </motion.div>
                ) : step.status === "error" ? (
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${iconColor}`}
                  >
                    {icon}
                  </motion.div>
                ) : (
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconColor} ${step.status === "active" ? "animate-pulse" : ""}`}>
                    {icon}
                  </div>
                )}
                <span 
                  className={`text-xs whitespace-nowrap ${
                    step.status === "active" ? "text-blue-400 font-medium" :
                    step.status === "done" ? "text-emerald-400" :
                    step.status === "error" ? "text-red-400" :
                    "text-zinc-400"
                  }`}
                  role={step.status === "active" ? "status" : undefined}
                  aria-label={step.status === "active" ? `${step.label} in progress` : undefined}
                >{step.label}</span>
                {step.description && (
                  <span className="text-xs text-zinc-600 whitespace-nowrap">{step.description}</span>
                )}
              </div>
              {!isLast && (
                <div className="relative h-0.5 w-8">
                  <div className="absolute inset-0 bg-zinc-700" aria-hidden />
                  {steps[index + 1].status !== "pending" && (
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 0.3 }}
                      className="absolute inset-0 bg-emerald-500"
                    />
                  )}
                </div>
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
