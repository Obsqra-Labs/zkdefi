"use client";

/**
 * ProofStepper — Compact vertical step tracker for deposit / withdraw flows.
 * Only renders when at least one step is active or done, keeping the UI
 * clean before the user triggers a transaction.
 */

import { Check, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface ProofStepperProps {
  steps: Array<{
    label: string;
    status: "pending" | "active" | "done" | "error";
    detail?: string;
  }>;
  /** Override accent color (default emerald). Accepts a tailwind hue name. */
  accent?: "emerald" | "violet" | "rose" | "blue";
}

const ACCENT = {
  emerald: { active: "border-emerald-500 bg-emerald-500/10", done: "bg-emerald-500", line: "bg-emerald-500", text: "text-emerald-400" },
  violet:  { active: "border-violet-500 bg-violet-500/10",  done: "bg-violet-500",  line: "bg-violet-500",  text: "text-violet-400"  },
  rose:    { active: "border-rose-500 bg-rose-500/10",      done: "bg-rose-500",     line: "bg-rose-500",    text: "text-rose-400"    },
  blue:    { active: "border-blue-500 bg-blue-500/10",      done: "bg-blue-500",     line: "bg-blue-500",    text: "text-blue-400"    },
} as const;

export function ProofStepper({ steps, accent = "emerald" }: ProofStepperProps) {
  // Only show once the flow has started (at least one step is non-pending)
  const hasStarted = steps.some((s) => s.status !== "pending");
  if (steps.length === 0 || !hasStarted) return null;

  const c = ACCENT[accent];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
        role="region"
        aria-label="Transaction progress"
      >
        <div className="space-y-0">
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1;
            return (
              <div key={idx} className="flex gap-3">
                {/* Left rail — icon + connector line */}
                <div className="flex flex-col items-center">
                  <StepIcon step={step} accent={c} />
                  {!isLast && (
                    <div className="relative w-0.5 flex-1 min-h-[16px] bg-zinc-800">
                      {(step.status === "done") && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "100%" }}
                          transition={{ duration: 0.25 }}
                          className={`absolute inset-x-0 top-0 ${c.line}`}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Right — label + detail */}
                <div className={`pb-3 ${isLast ? "" : ""}`}>
                  <span
                    className={`text-xs leading-none ${
                      step.status === "active" ? `${c.text} font-medium` :
                      step.status === "done"   ? "text-zinc-300" :
                      step.status === "error"  ? "text-red-400 font-medium" :
                      "text-zinc-500"
                    }`}
                    role={step.status === "active" ? "status" : undefined}
                  >
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="block text-[10px] text-zinc-500 mt-0.5">{step.detail}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Step icon sub-component
// ---------------------------------------------------------------------------

function StepIcon({
  step,
  accent,
}: {
  step: { status: string };
  accent: (typeof ACCENT)[keyof typeof ACCENT];
}) {
  const base = "w-5 h-5 rounded-full flex items-center justify-center shrink-0";

  if (step.status === "done") {
    return (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className={`${base} ${accent.done} text-white`}
      >
        <Check className="w-3 h-3" />
      </motion.div>
    );
  }

  if (step.status === "error") {
    return (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className={`${base} bg-red-500 text-white`}
      >
        <X className="w-3 h-3" />
      </motion.div>
    );
  }

  if (step.status === "active") {
    return (
      <div className={`${base} border ${accent.active}`}>
        <Loader2 className={`w-3 h-3 animate-spin ${accent.text}`} />
      </div>
    );
  }

  // pending
  return <div className={`${base} bg-zinc-800 border border-zinc-700`}>
    <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
  </div>;
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
