"use client";

import { useState, useEffect, useRef } from "react";
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

function statusLabel(status: "OK" | "WARNING" | "FAIL"): string {
  return status === "OK" ? "Passing" : status === "WARNING" ? "Warning" : "Failing";
}

export function ProofsPill({ proofsState }: ProofsPillProps) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { overall } = proofsState;

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  // Close on Escape
  useEffect(() => {
    if (!expanded) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expanded]);

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
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-label="View proof verification details"
        aria-expanded={expanded}
        aria-haspopup="true"
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${pillStyles}`}
      >
        {label}
      </button>
      <div
        role="tooltip"
        aria-label="Proof verification checks"
        className={`absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 z-10 min-w-[200px] rounded-lg border border-white/10 bg-zinc-900/95 p-2 shadow-lg transition-all duration-200 origin-top ${
          expanded
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">Policy enforced</span>
            <span className="sr-only">{statusLabel(proofsState.policyEnforced)}</span>
            <StatusIcon status={proofsState.policyEnforced} />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">Risk within bound</span>
            <span className="sr-only">{statusLabel(proofsState.riskWithinBound)}</span>
            <StatusIcon status={proofsState.riskWithinBound} />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">MEV protection active</span>
            <span className="sr-only">{statusLabel(proofsState.mevProtection)}</span>
            <StatusIcon status={proofsState.mevProtection} />
          </div>
        </div>
      </div>
    </div>
  );
}
