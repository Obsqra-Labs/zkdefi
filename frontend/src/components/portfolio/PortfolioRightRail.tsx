"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";

import { formatPercent, formatUsd } from "./formatters";
import type { ActivityItem, PolicyDraft, PolicySnapshot, SupportedAsset } from "./types";

type GateGuardResult = {
  passed: boolean;
  warning?: boolean;
  reason: string;
};

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-8 text-center">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <p className="mt-2 text-sm text-zinc-500">{body}</p>
    </div>
  );
}

function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}...
    </div>
  );
}

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

function CompactSection({
  eyebrow,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  eyebrow: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">{eyebrow}</p>
          <h3 className="mt-1 text-sm font-semibold text-white">{title}</h3>
          {summary ? <p className="mt-1.5 text-xs leading-5 text-zinc-500">{summary}</p> : null}
        </div>
        <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 transition-transform duration-300">
          <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
          open ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
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
  onTogglePolicyEditor: () => void;
  onPolicyFieldChange: (field: "maxValueUsd" | "maxSlippageBps" | "cooldownSeconds" | "maxSwaps", value: string) => void;
  onPolicyMinAmountChange: (asset: SupportedAsset, value: string) => void;
  onSavePolicy: () => void;
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
  onTogglePolicyEditor,
  onPolicyFieldChange,
  onPolicyMinAmountChange,
  onSavePolicy,
}: Props) {
  const assetsByWeight = (Object.entries(currentAllocations) as Array<[SupportedAsset, number]>).sort((a, b) => b[1] - a[1]);
  const topAsset = assetsByWeight[0]?.[0] ?? "ETH";
  const topWeight = assetsByWeight[0]?.[1] ?? 0;

  return (
    <aside className="space-y-3 xl:sticky xl:top-6">
      <section className="rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Wallet</p>
        <h3 className="mt-1 text-sm font-semibold text-white">Compact wallet view</h3>
        <div className="mt-3 space-y-1">
          <RailKeyValue label="Tracked value" value={formatUsd(totalTrackedValue)} />
          <RailKeyValue label="Largest weight" value={`${topAsset} ${formatPercent(topWeight, 1)}`} />
          <RailKeyValue
            label="Draft turnover"
            value={proposalTurnoverPct == null ? "Pending" : formatPercent(proposalTurnoverPct, 1)}
            valueClassName={proposalTurnoverPct != null && proposalTurnoverPct >= 40 ? "text-amber-200" : "text-zinc-200"}
          />
          <RailKeyValue
            label="Fee"
            value={
              feeGuardResult
                ? feeGuardResult.passed
                  ? feeGuardResult.warning
                    ? "Warning"
                    : "Clear"
                  : "Blocked"
                : "Pending"
            }
            valueClassName={
              feeGuardResult
                ? feeGuardResult.passed
                  ? feeGuardResult.warning
                    ? "text-amber-200"
                    : "text-emerald-200"
                  : "text-amber-200"
                : "text-zinc-200"
            }
          />
        </div>
        {unsupportedAssets.length ? (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100">
            Unsupported: {unsupportedAssets.join(", ")}
          </div>
        ) : null}
        {gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed." ? (
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs text-zinc-300">
            {gasReserveResult.reason}
          </div>
        ) : null}
      </section>

      <CompactSection
        eyebrow="Guardrails"
        title="Trading limits"
        summary={
          policy
            ? `${policy.max_slippage_bps} bps · ${formatUsd(policy.max_value_per_action_usd)} max action · ${policy.paused ? "Paused" : "Active"}`
            : "Loading the current guardrails."
        }
      >
        {!policy ? (
          <div className="mt-1">
            <LoadingLine label="Loading guardrails" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <RailKeyValue label="Allowed assets" value={policy.allowed_assets.join(", ")} />
              <RailKeyValue label="Max slippage" value={`${policy.max_slippage_bps} bps`} />
              <RailKeyValue label="Cooldown" value={`${policy.cooldown_seconds}s`} />
              <RailKeyValue label="Max action size" value={formatUsd(policy.max_value_per_action_usd)} />
              <RailKeyValue
                label="Pause state"
                value={policy.paused ? "Paused" : "Active"}
                valueClassName={policy.paused ? "text-red-300" : "text-emerald-300"}
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={onTogglePolicyEditor}
                className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
              >
                {showPolicyEditor ? "Hide editor" : "Edit guardrails"}
              </button>
              {policyDirty ? <span className="text-xs text-amber-300">Unsaved changes</span> : null}
            </div>

            {showPolicyEditor && policyDraft ? (
              <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Field label="Max action value (USD)">
                    <input
                      value={policyDraft.maxValueUsd}
                      onChange={(event) => onPolicyFieldChange("maxValueUsd", event.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </Field>
                  <Field label="Max slippage (bps)">
                    <input
                      value={policyDraft.maxSlippageBps}
                      onChange={(event) => onPolicyFieldChange("maxSlippageBps", event.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </Field>
                  <Field label="Cooldown (seconds)">
                    <input
                      value={policyDraft.cooldownSeconds}
                      onChange={(event) => onPolicyFieldChange("cooldownSeconds", event.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </Field>
                  <Field label="Rebalance swap cap">
                    <input
                      value={policyDraft.maxSwaps}
                      onChange={(event) => onPolicyFieldChange("maxSwaps", event.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </Field>
                </div>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                  {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
                    <Field key={asset} label={`Min ${asset}`}>
                      <input
                        value={policyDraft.minAmounts[asset]}
                        onChange={(event) => onPolicyMinAmountChange(asset, event.target.value)}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                      />
                    </Field>
                  ))}
                </div>
                <button
                  onClick={onSavePolicy}
                  disabled={!policyDirty || checking}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Save guardrails
                </button>
              </div>
            ) : null}
          </>
        )}
      </CompactSection>

      <CompactSection
        eyebrow="Recent activity"
        title="Last actions"
        summary={
          recentActivity.length
            ? `${Math.min(3, recentActivity.length)} recent item${recentActivity.length === 1 ? "" : "s"}`
            : "Recent gate checks and signed actions will show up here."
        }
      >
        <div className="space-y-2">
          {recentActivity.length ? (
            recentActivity.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">{item.summary}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-400">{item.status}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                  <span>{item.timestamp}</span>
                  {item.txHref ? (
                    <a
                      href={item.txHref}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-200 underline underline-offset-4 hover:text-cyan-100"
                    >
                      View tx
                    </a>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <EmptyState title="No recent activity" body="Recent gate checks and signed actions will show up here." />
          )}
        </div>
      </CompactSection>
    </aside>
  );
}
