"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from "lucide-react";

import type { ConstraintResult, GateResult } from "./types";
import { formatUsd } from "./formatters";

/* ------------------------------------------------------------------ */
/*  Review item used inside the modal                                  */
/* ------------------------------------------------------------------ */
function ReviewItem({
  title,
  reason,
  label,
  tone,
}: {
  title: string;
  reason: string;
  label: string;
  tone: "blocked" | "warning" | "passed";
}) {
  const toneClass =
    tone === "blocked"
      ? "border-red-500/10 bg-zinc-950/80 text-red-300"
      : tone === "warning"
        ? "border-amber-500/10 bg-zinc-950/80 text-amber-300"
        : "border-emerald-500/10 bg-zinc-950/80 text-emerald-300";

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-100">{title}</span>
        <span className="text-[10px] uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">{reason}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Full constraint detail modal                                       */
/* ------------------------------------------------------------------ */
function GateDetailModal({
  gateResult,
  passedGateCount,
  failedGateConstraints,
  warningGateConstraints,
  onClose,
}: {
  gateResult: GateResult;
  passedGateCount: number;
  failedGateConstraints: ConstraintResult[];
  warningGateConstraints: ConstraintResult[];
  onClose: () => void;
}) {
  const clearedChecks = useMemo(
    () => (gateResult.constraint_results ?? []).filter((item) => item.passed && !item.warning),
    [gateResult],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-[24px] border border-zinc-800/80 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="pr-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Gate constraint report</p>
          <p className="mt-2 text-sm text-zinc-300">
            {gateResult.constraint_results?.length ?? 0} checks &middot; {gateResult.estimated_gas?.toLocaleString() ?? "0"} gas &middot; {formatUsd(gateResult.estimated_cost_usd)} cost
          </p>
        </div>

        {/* Summary pills */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
            {passedGateCount} passed
          </span>
          {failedGateConstraints.length > 0 && (
            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs text-red-200">
              {failedGateConstraints.length} blockers
            </span>
          )}
          {warningGateConstraints.length > 0 && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
              {warningGateConstraints.length} warnings
            </span>
          )}
        </div>

        {/* Blockers section */}
        {failedGateConstraints.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-red-400">Blockers</p>
            <div className="space-y-2">
              {failedGateConstraints.map((item) => (
                <ReviewItem
                  key={`${item.kind}-${item.name}-failed`}
                  title={item.name}
                  reason={item.reason}
                  label="Blocker"
                  tone="blocked"
                />
              ))}
            </div>
          </div>
        )}

        {/* Warnings section */}
        {warningGateConstraints.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-amber-400">Warnings</p>
            <div className="space-y-2">
              {warningGateConstraints.map((item) => (
                <ReviewItem
                  key={`${item.kind}-${item.name}-warning`}
                  title={item.name}
                  reason={item.reason}
                  label="Warning"
                  tone="warning"
                />
              ))}
            </div>
          </div>
        )}

        {/* Cleared section */}
        {clearedChecks.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-emerald-400">Cleared</p>
            <div className="space-y-2">
              {clearedChecks.map((item) => (
                <ReviewItem
                  key={`${item.kind}-${item.name}-cleared`}
                  title={item.name}
                  reason={item.reason}
                  label="Cleared"
                  tone="passed"
                />
              ))}
            </div>
          </div>
        )}

        {/* Full matrix table */}
        <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800">
          <div className="grid grid-cols-[1.4fr_0.7fr_2fr] bg-zinc-900/90 px-4 py-2.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span>Constraint</span>
            <span>Status</span>
            <span>Reason</span>
          </div>
          <div className="max-h-[300px] divide-y divide-zinc-800/60 overflow-y-auto bg-zinc-950/85">
            {(gateResult.constraint_results ?? []).map((item) => {
              const statusLabel = item.passed ? (item.warning ? "Warning" : "Pass") : "Blocker";
              const statusClass = item.passed
                ? item.warning
                  ? "text-amber-300"
                  : "text-emerald-300"
                : "text-red-300";
              return (
                <div
                  key={`${item.kind}-${item.name}`}
                  className="grid grid-cols-[1.4fr_0.7fr_2fr] gap-3 px-4 py-2 text-xs"
                >
                  <span className="text-zinc-200">{item.name}</span>
                  <span className={statusClass}>{statusLabel}</span>
                  <span className="text-zinc-500">{item.reason}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main SafetyDrawer - compact summary bar                            */
/* ------------------------------------------------------------------ */
type Props = {
  gateResult: GateResult | null;
  summaryLabel: string;
  passedGateCount: number;
  failedGateConstraints: ConstraintResult[];
  warningGateConstraints: ConstraintResult[];
  showFullGateMatrix: boolean;
  onToggleFullMatrix: () => void;
};

export function SafetyDrawer({
  gateResult,
  summaryLabel,
  passedGateCount,
  failedGateConstraints,
  warningGateConstraints,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const totalChecks = gateResult?.constraint_results?.length ?? 0;

  if (!gateResult) {
    return (
      <section className="rounded-[22px] border border-dashed border-zinc-800 bg-zinc-950/88 px-5 py-6 text-center">
        <p className="text-sm font-medium text-zinc-200">No proposal checked</p>
        <p className="mt-1 text-xs text-zinc-500">Run a gate check to see the constraint matrix.</p>
      </section>
    );
  }

  const feeOverrideOnly =
    !gateResult.allowed &&
    failedGateConstraints.length === 1 &&
    failedGateConstraints[0]?.name === "FeeEfficiencyGuard";

  const summaryTone = failedGateConstraints.length
    ? "text-amber-200"
    : gateResult.allowed
      ? "text-emerald-200"
      : "text-zinc-300";

  const statusIcon = failedGateConstraints.length ? (
    <ShieldAlert className="h-4 w-4 text-red-400" />
  ) : warningGateConstraints.length ? (
    <AlertTriangle className="h-4 w-4 text-amber-400" />
  ) : (
    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex w-full items-center gap-3 rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 px-4 py-3 text-left shadow-[0_12px_32px_rgba(0,0,0,0.2)] transition hover:border-zinc-700"
      >
        {statusIcon}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${summaryTone}`}>
            {summaryLabel || (gateResult.allowed ? "Safe to sign" : feeOverrideOnly ? "Permitted with fee warning" : "Needs adjustment")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {totalChecks} checks &middot; {passedGateCount} passed &middot; {failedGateConstraints.length} blockers &middot; {warningGateConstraints.length} warnings &middot; {formatUsd(gateResult.estimated_cost_usd)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {failedGateConstraints.length > 0 && (
            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-red-200">
              {failedGateConstraints.length}
            </span>
          )}
          {warningGateConstraints.length > 0 && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-200">
              {warningGateConstraints.length}
            </span>
          )}
          <span className="text-xs text-zinc-500">Details &rarr;</span>
        </div>
      </button>

      {modalOpen && (
        <GateDetailModal
          gateResult={gateResult}
          passedGateCount={passedGateCount}
          failedGateConstraints={failedGateConstraints}
          warningGateConstraints={warningGateConstraints}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
