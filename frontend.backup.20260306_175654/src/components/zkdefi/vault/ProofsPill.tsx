"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export interface ProofsPillProps {
  proofsState: {
    policyEnforced: "OK" | "WARNING" | "FAIL";
    riskWithinBound: "OK" | "WARNING" | "FAIL";
    mevProtection: "OK" | "WARNING" | "FAIL";
    overall: "OK" | "WARNING" | "FAIL";
  };
}

function StatusIcon({ status }: { status: "OK" | "WARNING" | "FAIL" }) {
  if (status === "OK") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "WARNING") return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
  return <XCircle className="w-3.5 h-3.5 text-red-400" />;
}

export function ProofsPill({ proofsState }: ProofsPillProps) {
  const [expanded, setExpanded] = useState(false);
  const { overall } = proofsState;

  const pillStyles =
    overall === "OK"
      ? "bg-emerald-500/20 text-emerald-400"
      : overall === "WARNING"
        ? "bg-amber-500/20 text-amber-400"
        : "bg-red-500/20 text-red-400";

  const label =
    overall === "OK"
      ? "Proofs OK"
      : overall === "WARNING"
        ? "Proofs Warning"
        : "Proofs Fail";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-90 ${pillStyles}`}
      >
        {label}
      </button>
      {expanded && (
        <div className="absolute left-0 top-full mt-1.5 z-10 min-w-[200px] rounded-lg border border-white/10 bg-zinc-900/95 p-2 shadow-lg">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-white/70">Policy enforced</span>
              <StatusIcon status={proofsState.policyEnforced} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-white/70">Risk within bound</span>
              <StatusIcon status={proofsState.riskWithinBound} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-white/70">MEV protection active</span>
              <StatusIcon status={proofsState.mevProtection} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
