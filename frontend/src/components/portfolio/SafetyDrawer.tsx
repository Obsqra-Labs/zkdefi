"use client";

import type { ConstraintResult, GateResult } from "./types";
import { formatUsd } from "./formatters";

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <p className="mt-2 text-sm text-zinc-500">{body}</p>
    </div>
  );
}

function MatrixStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-zinc-200";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <p className={`mt-3 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

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
    <div className={`rounded-xl border px-3 py-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-100">{title}</span>
        <span className="text-xs uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{reason}</p>
    </div>
  );
}

type Props = {
  gateResult: GateResult | null;
  passedGateCount: number;
  failedGateConstraints: ConstraintResult[];
  warningGateConstraints: ConstraintResult[];
  showFullGateMatrix: boolean;
  onToggleFullMatrix: () => void;
};

export function SafetyDrawer({
  gateResult,
  passedGateCount,
  failedGateConstraints,
  warningGateConstraints,
  showFullGateMatrix,
  onToggleFullMatrix,
}: Props) {
  const totalChecks = gateResult?.constraint_results?.length ?? 0;

  return (
    <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.3)] transition-[opacity,transform] duration-300 ease-out">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/80">
          <div className="h-4 w-4 rounded-full bg-emerald-300" />
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Safety drawer</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Review the checks behind the action</h2>
        </div>
      </div>

      <div className="mt-6">
        {!gateResult ? (
          <EmptyState
            title="No proposal checked yet"
            body="Run a manual proposal or hit the recommendation button to populate the matrix."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <MatrixStat
                label="Blockers"
                value={failedGateConstraints.length.toString()}
                tone={failedGateConstraints.length ? "bad" : "neutral"}
              />
              <MatrixStat
                label="Warnings"
                value={warningGateConstraints.length.toString()}
                tone={warningGateConstraints.length ? "neutral" : "good"}
              />
              <MatrixStat label="Passed" value={passedGateCount.toString()} tone="good" />
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Safety summary</p>
                  <p className="mt-1 text-sm text-zinc-300">
                    {gateResult.allowed ? "Safe to sign" : "Needs adjustment"} · {formatUsd(gateResult.estimated_cost_usd)} estimated network cost
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                    {passedGateCount} passed
                  </span>
                  <span className={`rounded-full border px-3 py-1 ${failedGateConstraints.length ? "border-red-500/20 bg-red-500/10 text-red-200" : "border-zinc-700 bg-zinc-950 text-zinc-300"}`}>
                    {failedGateConstraints.length} blockers
                  </span>
                  <span className={`rounded-full border px-3 py-1 ${warningGateConstraints.length ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-zinc-700 bg-zinc-950 text-zinc-300"}`}>
                    {warningGateConstraints.length} warnings
                  </span>
                </div>
              </div>

              {failedGateConstraints.length ? (
                <div className="mt-5">
                  <div className="mb-2">
                    <p className="text-sm font-medium text-white">Blockers</p>
                    <p className="mt-1 text-xs text-zinc-500">These checks must clear before the action can be signed.</p>
                  </div>
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
              ) : (
                <div className="mt-5 rounded-xl border border-emerald-500/10 bg-zinc-950/80 px-3 py-3 text-sm text-emerald-200">
                  No blockers on the current proposal.
                </div>
              )}

              <div className="mt-5">
                <div className="mb-2">
                  <p className="text-sm font-medium text-white">Warnings</p>
                  <p className="mt-1 text-xs text-zinc-500">Warnings do not stop signing, but they change the economics or confidence of the action.</p>
                </div>
                {warningGateConstraints.length ? (
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
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-300">
                    No active warnings on the current proposal.
                  </div>
                )}
              </div>

              <div className="mt-5">
                <div className="mb-2">
                  <p className="text-sm font-medium text-white">Passed checks</p>
                  <p className="mt-1 text-xs text-zinc-500">The rest of the matrix cleared for the current proposal.</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{passedGateCount} checks passed</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {totalChecks} total checks · {gateResult.estimated_gas?.toLocaleString() ?? "0"} gas estimate
                      </p>
                    </div>
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                      {gateResult.proof_mode ?? "n/a"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
                <div className="text-xs text-zinc-500">Full matrix is available when you need the check-by-check detail.</div>
                <button
                  type="button"
                  onClick={onToggleFullMatrix}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                >
                  {showFullGateMatrix ? "Hide full matrix" : "Show full matrix"}
                </button>
              </div>

              <div
                className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                  showFullGateMatrix ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="overflow-hidden rounded-2xl border border-zinc-800">
                  <div className="grid grid-cols-[1.4fr_0.7fr_2fr] bg-zinc-900/90 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    <span>Constraint</span>
                    <span>Status</span>
                    <span>Reason</span>
                  </div>
                  <div className="divide-y divide-zinc-800 bg-zinc-950/85">
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
                          className="grid grid-cols-[1.4fr_0.7fr_2fr] gap-3 px-4 py-3 text-sm"
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
            </div>
          </>
        )}
      </div>
    </section>
  );
}
