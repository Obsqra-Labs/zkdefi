"use client";

import { CheckCircle2, Circle, CircleDot } from "lucide-react";

export interface TrustFlowState {
  rootIdentityConnected: boolean;
  walletsLinked: boolean;
  walletsVerified: boolean;
  attributionsSynced: boolean;
  claimsDerived: boolean;
  disclosurePackIssued: boolean;
  scopedSessionBound: boolean;
}

interface TrustFlowChecklistProps {
  state: TrustFlowState;
  title?: string;
  compact?: boolean;
}

const STEP_LABELS: Array<{ key: keyof TrustFlowState; label: string; hint: string }> = [
  {
    key: "rootIdentityConnected",
    label: "Connect root identity",
    hint: "Anchor the subject to Starknet identity.",
  },
  {
    key: "walletsLinked",
    label: "Link wallets",
    hint: "Attach EVM and Starknet accounts to one subject.",
  },
  {
    key: "walletsVerified",
    label: "Verify ownership",
    hint: "Only verified links influence trust decisions.",
  },
  {
    key: "attributionsSynced",
    label: "Sync attributions",
    hint: "Import cross-chain behavioral events into the ledger.",
  },
  {
    key: "claimsDerived",
    label: "Derive claims",
    hint: "Compute portable trust claims from verified activity.",
  },
  {
    key: "disclosurePackIssued",
    label: "Issue disclosure pack",
    hint: "Create selective disclosure credentials for downstream use.",
  },
  {
    key: "scopedSessionBound",
    label: "Bind scoped session",
    hint: "Grant execution rights with explicit limits.",
  },
];

export function TrustFlowChecklist({ state, title = "Capital OS Trust Flow", compact = false }: TrustFlowChecklistProps) {
  let reachedGap = false;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">{title}</div>
      <div className="space-y-2">
        {STEP_LABELS.map((step) => {
          const complete = Boolean(state[step.key]);
          let status: "complete" | "active" | "pending" = "pending";
          if (complete) {
            status = "complete";
          } else if (!reachedGap) {
            status = "active";
            reachedGap = true;
          }

          return (
            <div key={step.key} className="flex items-start gap-2">
              <div className="pt-0.5">
                {status === "complete" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : status === "active" ? (
                  <CircleDot className="h-4 w-4 text-amber-400" />
                ) : (
                  <Circle className="h-4 w-4 text-zinc-600" />
                )}
              </div>
              <div>
                <div
                  className={`text-sm ${
                    status === "complete"
                      ? "text-zinc-100"
                      : status === "active"
                        ? "text-amber-200"
                        : "text-zinc-500"
                  }`}
                >
                  {step.label}
                </div>
                {!compact ? <div className="text-xs text-zinc-500">{step.hint}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

