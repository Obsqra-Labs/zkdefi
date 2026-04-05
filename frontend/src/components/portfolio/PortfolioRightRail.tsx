"use client";

import { useState, type ReactNode } from "react";
import { Loader2, RefreshCcw, ShieldCheck } from "lucide-react";

import { formatPercent, formatUsd } from "./formatters";
import { MixBar } from "./PortfolioMainDesk";
import type { ActivityItem, PolicyDraft, PolicySnapshot, SupportedAsset } from "./types";
import type { PortfolioAuthTelemetrySummary } from "./api";

type GateGuardResult = {
  passed: boolean;
  warning?: boolean;
  reason: string;
};

function RailKeyValue({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-800/70 py-2 last:border-b-0 last:pb-0 first:pt-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-right text-sm ${valueClassName ?? "text-zinc-200"}`}>{value}</span>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

type Props = {
  totalTrackedValue: number;
  currentAllocations: Record<SupportedAsset, number>;
  unsupportedAssets: string[];
  proposalTurnoverPct: number | null;
  feeGuardResult: GateGuardResult | null;
  gasReserveResult: GateGuardResult | null;
  recentActivity: ActivityItem[];
  policy: PolicySnapshot | null;
  policyDraft: PolicyDraft | null;
  showPolicyEditor: boolean;
  policyDirty: boolean;
  checking: boolean;
  authTelemetrySummary: PortfolioAuthTelemetrySummary | null;
  authTelemetryLoading: boolean;
  onRefreshAuthTelemetry: () => void;
  onTogglePolicyEditor: () => void;
  onPolicyFieldChange: (field: "maxValueUsd" | "maxSlippageBps" | "cooldownSeconds" | "maxSwaps" | "maxFeeSharePct", value: string) => void;
  onPolicyMinAmountChange: (asset: SupportedAsset, value: string) => void;
  onSavePolicy: () => void;
  workflowMode?: string;
  automatedProfileFallback?: Record<string, unknown>;
  governedExecutionDisarmed?: boolean;
  onToggleGovernedExecution?: () => void;
};

export function PortfolioRightRail({
  totalTrackedValue,
  currentAllocations,
  unsupportedAssets,
  proposalTurnoverPct,
  feeGuardResult,
  gasReserveResult,
  recentActivity,
  policy,
  policyDraft,
  showPolicyEditor,
  policyDirty,
  checking,
  authTelemetrySummary,
  authTelemetryLoading,
  onRefreshAuthTelemetry,
  onTogglePolicyEditor,
  onPolicyFieldChange,
  onPolicyMinAmountChange,
  onSavePolicy,
}: Props) {
  const assetsByWeight = (Object.entries(currentAllocations) as Array<[SupportedAsset, number]>).sort((a, b) => b[1] - a[1]);
  const topAsset = assetsByWeight[0]?.[0] ?? "ETH";
  const topWeight = assetsByWeight[0]?.[1] ?? 0;

  const [activityExpanded, setActivityExpanded] = useState(false);
  const visibleActivity = activityExpanded ? recentActivity : recentActivity.slice(0, 4);

  const statusColor = (status: string) => {
    if (status === "confirmed") return "text-emerald-300";
    if (status === "submitted" || status === "accepted") return "text-cyan-300";
    if (status === "failed" || status === "blocked") return "text-red-300";
    if (status === "ready to sign") return "text-amber-300";
    return "text-zinc-500";
  };

  const privacyClassColor = (classification?: string | null) => {
    if (classification === "private_execution") return "text-emerald-300";
    if (classification === "private_settlement") return "text-cyan-300";
    if (classification === "private_funding") return "text-amber-300";
    return "text-zinc-500";
  };

  const telemetrySuccessRate = authTelemetrySummary?.totals.success_rate_pct;
  const telemetryP95Total = authTelemetrySummary?.latency_ms.total.p95;
  const telemetryP95Sign = authTelemetrySummary?.latency_ms.sign.p95;
  const walletSignatureFailures = authTelemetrySummary?.failures.by_stage.wallet_signature ?? 0;
  const api401 = authTelemetrySummary?.failures.by_status["401"] ?? 0;
  const api404 = authTelemetrySummary?.failures.by_status["404"] ?? 0;

  return (
    <aside className="space-y-3 xl:sticky xl:top-6">
      {/* ── Section 1: Portfolio Mix ── */}
      <section className="rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Portfolio</p>
        <div className="mt-2 space-y-1">
          <RailKeyValue label="Tracked value" value={formatUsd(totalTrackedValue)} />
          <RailKeyValue label="Largest weight" value={`${topAsset} ${formatPercent(topWeight, 1)}`} />
          <RailKeyValue
            label="Draft turnover"
            value={proposalTurnoverPct == null ? "—" : formatPercent(proposalTurnoverPct, 1)}
            valueClassName={proposalTurnoverPct != null && proposalTurnoverPct >= 40 ? "text-amber-200" : "text-zinc-200"}
          />
        </div>
        {unsupportedAssets.length ? (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Unsupported: {unsupportedAssets.join(", ")}
          </div>
        ) : null}
        <div className="mt-3">
          <MixBar label="Current mix" allocations={currentAllocations} emphasis="current" />
        </div>
      </section>

      {/* ── Section 2: Guards ── */}
      <section className="rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Guards</p>
        <div className="mt-2 space-y-1">
          <RailKeyValue
            label="Fee gate"
            value={
              feeGuardResult
                ? feeGuardResult.passed
                  ? feeGuardResult.warning ? "Warning" : "Clear"
                  : "Blocked"
                : "—"
            }
            valueClassName={
              feeGuardResult
                ? feeGuardResult.passed
                  ? feeGuardResult.warning ? "text-amber-200" : "text-emerald-200"
                  : "text-red-300"
                : "text-zinc-500"
            }
          />
          <RailKeyValue
            label="Gas reserve"
            value={
              gasReserveResult
                ? gasReserveResult.passed ? "OK" : "Low"
                : "—"
            }
            valueClassName={
              gasReserveResult
                ? gasReserveResult.passed ? "text-emerald-200" : "text-amber-200"
                : "text-zinc-500"
            }
          />
          {policy ? (
            <>
              <RailKeyValue label="Slippage limit" value={`${policy.max_slippage_bps} bps`} />
              <RailKeyValue label="Max action" value={formatUsd(policy.max_value_per_action_usd)} />
              <RailKeyValue label="Fee threshold" value={`${policy.max_fee_share_pct}%`} />
            </>
          ) : (
            <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={onTogglePolicyEditor}
            className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
          >
            {showPolicyEditor ? "Close editor" : "Edit limits"}
          </button>
        </div>

        {showPolicyEditor && policyDraft ? (
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Max value (USD)">
                <input
                  value={policyDraft.maxValueUsd}
                  onChange={(e) => onPolicyFieldChange("maxValueUsd", e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </Field>
              <Field label="Slippage (bps)">
                <input
                  value={policyDraft.maxSlippageBps}
                  onChange={(e) => onPolicyFieldChange("maxSlippageBps", e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </Field>
              <Field label="Fee threshold (%)">
                <input
                  value={policyDraft.maxFeeSharePct}
                  onChange={(e) => onPolicyFieldChange("maxFeeSharePct", e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </Field>
              <Field label="Cooldown (s)">
                <input
                  value={policyDraft.cooldownSeconds}
                  onChange={(e) => onPolicyFieldChange("cooldownSeconds", e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </Field>
            </div>
            <button
              onClick={onSavePolicy}
              disabled={!policyDirty || checking}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Save
            </button>
          </div>
        ) : null}
      </section>

      {/* ── Section 3: Auth telemetry ── */}
      <section className="rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Auth telemetry · 24h</p>
          <button
            type="button"
            onClick={onRefreshAuthTelemetry}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            {authTelemetryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            Refresh
          </button>
        </div>
        <div className="mt-2 space-y-1">
          <RailKeyValue
            label="Success rate"
            value={telemetrySuccessRate == null ? "—" : `${telemetrySuccessRate.toFixed(1)}%`}
            valueClassName={telemetrySuccessRate != null && telemetrySuccessRate >= 90 ? "text-emerald-200" : "text-amber-200"}
          />
          <RailKeyValue
            label="p95 total"
            value={telemetryP95Total == null ? "—" : `${Math.round(telemetryP95Total)} ms`}
            valueClassName={telemetryP95Total != null && telemetryP95Total > 5000 ? "text-amber-200" : "text-zinc-200"}
          />
          <RailKeyValue
            label="p95 signature"
            value={telemetryP95Sign == null ? "—" : `${Math.round(telemetryP95Sign)} ms`}
            valueClassName={telemetryP95Sign != null && telemetryP95Sign > 3500 ? "text-amber-200" : "text-zinc-200"}
          />
          <RailKeyValue
            label="Wallet-sign failures"
            value={String(walletSignatureFailures)}
            valueClassName={walletSignatureFailures > 2 ? "text-amber-200" : "text-zinc-300"}
          />
          <RailKeyValue
            label="API 401 / 404"
            value={`${api401} / ${api404}`}
            valueClassName={api401 > 0 || api404 > 0 ? "text-amber-200" : "text-zinc-300"}
          />
        </div>
        {authTelemetrySummary?.alerts?.length ? (
          <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            {authTelemetrySummary.alerts[0].message}
          </div>
        ) : null}
      </section>

      {/* ── Section 4: Activity ── */}
      <section className="rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Activity</p>
        <div className="mt-2 space-y-1.5">
          {visibleActivity.length ? (
            visibleActivity.map((item) => (
              <div key={item.id} className="rounded-lg border border-zinc-800/70 bg-zinc-900/50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-white">{item.title}</p>
                  <span className="shrink-0 text-[10px] text-zinc-600">{item.timestamp}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase tracking-[0.14em] ${statusColor(item.status)}`}>{item.status}</span>
                    {item.privacyLabel ? (
                      <span className={`text-[10px] uppercase tracking-[0.14em] ${privacyClassColor(item.privacyClassification)}`}>
                        {item.privacyLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    {item.receiptHref ? <a href={item.receiptHref} className="text-emerald-400 hover:text-emerald-300">Receipt</a> : null}
                    {item.txHref ? <a href={item.txHref} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200">Tx</a> : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="py-4 text-center text-xs text-zinc-600">No activity yet</p>
          )}

          {recentActivity.length > 4 && (
            <button
              type="button"
              onClick={() => setActivityExpanded((c) => !c)}
              className="block w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
            >
              {activityExpanded ? "Show less" : `Show all ${recentActivity.length}`}
            </button>
          )}

          {recentActivity.length > 0 && (
            <a href="/archive" className="block text-center text-xs text-zinc-500 hover:text-zinc-300">
              View archive →
            </a>
          )}
        </div>
      </section>
    </aside>
  );
}
