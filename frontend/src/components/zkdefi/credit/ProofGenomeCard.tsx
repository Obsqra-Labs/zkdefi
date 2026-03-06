"use client";

import { CheckCircle, Clock, FileCheck, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface ProofGenomeMeta {
  formula: string;
  constraints: string[];
  inputsRequired: { name: string; description: string }[];
  circuitId: string;
  factType: string;
  publicSignals?: string[];
}

interface ProofGenomeCardProps {
  title: string;
  description: string;
  status: "complete" | "pending" | "available";
  genome: ProofGenomeMeta;
  proofDetails?: {
    generated_at: number | null;
    proof_hash: string | null;
    on_chain_verified: boolean;
  };
  icon: React.ReactNode;
  perks?: string[];
  onGenerate?: () => void;
  onEditInputs?: () => void;
  generating?: boolean;
}

const STATUS_CONFIG = {
  complete: {
    icon: CheckCircle,
    label: "Complete",
    badgeClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
    iconBoxClass: "bg-emerald-500/10 border-emerald-500/30",
  },
  pending: {
    icon: Clock,
    label: "Pending",
    badgeClass: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    iconBoxClass: "bg-amber-500/10 border-amber-500/30",
  },
  available: {
    icon: FileCheck,
    label: "Available",
    badgeClass: "bg-zinc-800/50 border-zinc-700 text-zinc-400",
    iconBoxClass: "bg-zinc-800/50 border-zinc-700",
  },
} as const;

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

export function ProofGenomeCard({
  title,
  description,
  status,
  genome,
  proofDetails,
  icon,
  perks,
  onGenerate,
  onEditInputs,
  generating,
}: ProofGenomeCardProps) {
  const [expanded, setExpanded] = useState(true);
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  return (
    <div className={`rounded-xl border bg-zinc-900/80 border-zinc-700 overflow-hidden`}>
      {/* Header: always visible */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-start justify-between gap-4 p-5 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${config.iconBoxClass}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <h4 className="font-semibold text-zinc-200">{title}</h4>
            <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${config.badgeClass}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                {config.label}
              </span>
              <span className="text-xs text-zinc-600 font-mono">{genome.circuitId}</span>
            </div>
          </div>
        </div>
        {expanded ? <ChevronDown className="w-5 h-5 text-zinc-500 shrink-0" /> : <ChevronRight className="w-5 h-5 text-zinc-500 shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-zinc-800"
          >
            <div className="p-5 pt-4 space-y-5">
              {/* What this proves */}
              <section>
                <h5 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">What this proves</h5>
                <div className="font-mono text-sm text-zinc-300 bg-zinc-800/60 rounded-lg px-3 py-2 border border-zinc-700">
                  {genome.formula}
                </div>
                {genome.constraints.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {genome.constraints.map((c, i) => (
                      <li key={i} className="text-xs text-zinc-400 flex items-start gap-2">
                        <span className="text-zinc-600">•</span>
                        <span className="font-mono">{c}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Inputs required / used */}
              <section>
                <h5 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  {status === "complete" ? "Proof details" : "Inputs required"}
                </h5>
                {status === "complete" && proofDetails && (
                  <div className="space-y-2">
                    {proofDetails.proof_hash && (
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-zinc-400 font-mono bg-zinc-800/60 px-2 py-1 rounded truncate max-w-[240px]">
                          {proofDetails.proof_hash.slice(0, 10)}…{proofDetails.proof_hash.slice(-8)}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(proofDetails!.proof_hash!)}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                          title="Copy hash"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {proofDetails.generated_at != null && (
                      <p className="text-xs text-zinc-500">
                        Generated: {new Date(proofDetails.generated_at * 1000).toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-zinc-500">
                      On-chain verified: {proofDetails.on_chain_verified ? (
                        <span className="text-emerald-400">Yes</span>
                      ) : (
                        <span className="text-zinc-500">No</span>
                      )}
                    </p>
                  </div>
                )}
                {status !== "complete" && (
                  <ul className="space-y-1.5">
                    {genome.inputsRequired.map((inp, i) => (
                      <li key={i} className="text-xs text-zinc-400">
                        <span className="font-mono text-zinc-300">{inp.name}</span>
                        {inp.description && <span className="text-zinc-500"> — {inp.description}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {genome.publicSignals && genome.publicSignals.length > 0 && (
                <section>
                  <h5 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Public signals</h5>
                  <p className="text-xs text-zinc-400 font-mono">{genome.publicSignals.join(", ")}</p>
                </section>
              )}

              {/* Fact type (power user) */}
              <section className="flex items-center gap-2 text-xs text-zinc-600">
                <span>Fact type:</span>
                <code className="font-mono text-zinc-500">{genome.factType}</code>
              </section>

              {/* Perks */}
              {perks && perks.length > 0 && (
                <section className="pt-2 border-t border-zinc-800">
                  <h5 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Unlocks</h5>
                  <ul className="space-y-1">
                    {perks.map((perk, idx) => (
                      <li key={idx} className="text-xs text-zinc-400 flex items-start gap-1.5">
                        <span className="text-emerald-500 mt-0.5">✓</span>
                        {perk}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Generate button */}
              {(status === "available" || status === "pending") && (onGenerate || onEditInputs) && (
                <div className="flex flex-col gap-2">
                  {status === "available" && onGenerate && (
                    <button
                      onClick={onGenerate}
                      disabled={generating}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {generating ? (
                        <>
                          <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Generating…
                        </>
                      ) : (
                        "Generate Proof"
                      )}
                    </button>
                  )}
                  {onEditInputs && (
                    <button
                      type="button"
                      onClick={onEditInputs}
                      className="w-full py-2 px-4 border border-zinc-600 hover:border-zinc-500 text-zinc-400 hover:text-zinc-300 text-sm rounded-lg transition-colors"
                    >
                      Edit inputs
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
