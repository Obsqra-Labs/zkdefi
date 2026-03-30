"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

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

function SectionToggle({
  title,
  subtitle,
  badge,
  open,
  onToggle,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/55 px-4 py-3 text-left transition-colors duration-200 hover:border-zinc-700 hover:bg-zinc-900/75"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        {badge ? (
          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
            {badge}
          </span>
        ) : null}
        <ChevronRight className={`h-4 w-4 text-zinc-400 transition-transform duration-300 ${open ? "rotate-90" : ""}`} />
      </div>
    </button>
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
  const [showBlockers, setShowBlockers] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [showPolicyChecks, setShowPolicyChecks] = useState(false);
  const [showZkmlChecks, setShowZkmlChecks] = useState(false);
  const totalChecks = gateResult?.constraint_results?.length ?? 0;
  const policyChecks = useMemo(
    () => (gateResult?.constraint_results ?? []).filter((item) => item.kind === "policy"),
    [gateResult],
  );
  const zkmlChecks = useMemo(
    () => (gateResult?.constraint_results ?? []).filter((item) => item.kind === "zkml"),
    [gateResult],
  );
  const summaryTone = !gateResult
    ? "text-zinc-300"
    : failedGateConstraints.length
      ? "text-amber-200"
      : gateResult.allowed
        ? "text-emerald-200"
        : "text-zinc-300";
  const feeOverrideOnly =
    !gateResult?.allowed &&
    failedGateConstraints.length === 1 &&
    failedGateConstraints[0]?.name === "FeeEfficiencyGuard";

  return (
    <section className="rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.26)] transition-[opacity,transform] duration-300 ease-out">
      <div>
        {!gateResult ? (
          <EmptyState
            title="No proposal checked yet"
            body="Run a manual proposal or hit the recommendation button to populate the matrix."
          />
        ) : (
          <>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Gate report</p>
                  <p className={`mt-1 text-sm font-medium ${summaryTone}`}>
                    {gateResult.allowed ? "Safe to sign" : feeOverrideOnly ? "Permitted with fee warning" : "Needs adjustment"} · {formatUsd(gateResult.estimated_cost_usd)} estimated network cost
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {totalChecks} checks run · {gateResult.estimated_gas?.toLocaleString() ?? "0"} gas estimate
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

              <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
                <SectionToggle
                  title="Blocking checks"
                  subtitle="These checks must clear before the action can be signed."
                  badge={failedGateConstraints.length ? `${failedGateConstraints.length} blockers` : "0 blockers"}
                  open={showBlockers}
                  onToggle={() => setShowBlockers((current) => !current)}
                />
                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                    showBlockers ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {failedGateConstraints.length ? (
                      <div className="space-y-2 pt-2">
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
                    ) : (
                      <div className="pt-2">
                        <div className="rounded-xl border border-emerald-500/10 bg-zinc-950/80 px-3 py-3 text-sm text-emerald-200">
                          No blockers on the current proposal.
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <SectionToggle
                  title="Warnings"
                  subtitle="Warnings do not stop signing, but they change the economics or confidence of the action."
                  badge={warningGateConstraints.length ? `${warningGateConstraints.length} warnings` : "0 warnings"}
                  open={showWarnings}
                  onToggle={() => setShowWarnings((current) => !current)}
                />
                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                    showWarnings ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {warningGateConstraints.length ? (
                      <div className="space-y-2 pt-2">
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
                      <div className="pt-2">
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-300">
                          No active warnings on the current proposal.
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <SectionToggle
                  title="Policy constraints"
                  subtitle="Liquidity, fees, gas reserve, sizing, and execution policy checks."
                  badge={`${policyChecks.length} checks`}
                  open={showPolicyChecks}
                  onToggle={() => setShowPolicyChecks((current) => !current)}
                />
                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                    showPolicyChecks ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="space-y-2 pt-2">
                      {policyChecks.map((item) => (
                        <ReviewItem
                          key={`${item.kind}-${item.name}-policy`}
                          title={item.name}
                          reason={item.reason}
                          label={item.passed ? (item.warning ? "Warning" : "Passed") : "Blocker"}
                          tone={item.passed ? (item.warning ? "warning" : "passed") : "blocked"}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <SectionToggle
                  title="zkML circuit checks"
                  subtitle="Circuit-level proofs and model attestations stay available, but off the main face."
                  badge={`${zkmlChecks.length} checks`}
                  open={showZkmlChecks}
                  onToggle={() => setShowZkmlChecks((current) => !current)}
                />
                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                    showZkmlChecks ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="space-y-2 pt-2">
                      {zkmlChecks.map((item) => (
                        <ReviewItem
                          key={`${item.kind}-${item.name}-zkml`}
                          title={item.name}
                          reason={item.reason}
                          label={item.passed ? (item.warning ? "Warning" : "Passed") : "Blocker"}
                          tone={item.passed ? (item.warning ? "warning" : "passed") : "blocked"}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
                <div className="text-xs text-zinc-500">Full matrix is still available when you need the raw check-by-check view.</div>
                <button
                  type="button"
                  onClick={onToggleFullMatrix}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                >
                  {showFullGateMatrix ? "Hide full report" : "View full report"}
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
