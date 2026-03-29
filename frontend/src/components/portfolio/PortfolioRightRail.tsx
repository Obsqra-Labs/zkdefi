"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, ShieldCheck } from "lucide-react";

import { formatUsd } from "./formatters";
import type { ActivityItem, PolicyDraft, PolicySnapshot, SupportedAsset } from "./types";

type GateGuardResult = {
  passed: boolean;
  warning?: boolean;
  reason: string;
};

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center">
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
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className ?? "block"}>
      <span className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function RailSection({
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
    <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-4 text-left xl:pointer-events-none"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">{eyebrow}</p>
          <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
          {summary ? <p className="mt-2 text-sm text-zinc-500">{summary}</p> : null}
        </div>
        <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 transition-transform duration-300 xl:hidden">
          <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
          open ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-3 grid-rows-[0fr] opacity-70"
        } xl:mt-4 xl:grid-rows-[1fr] xl:opacity-100`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}

function allocationToneClass(tone: "clear" | "watch" | "adjust") {
  if (tone === "clear") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (tone === "adjust") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-cyan-500/30 bg-cyan-500/10 text-cyan-100";
}

function AllocationChecksSection({
  totalTrackedValue,
  currentAllocations,
  unsupportedAssets,
  proposalTurnoverPct,
  feeGuardResult,
  gasReserveResult,
}: {
  totalTrackedValue: number;
  currentAllocations: Record<SupportedAsset, number>;
  unsupportedAssets: string[];
  proposalTurnoverPct: number | null;
  feeGuardResult: GateGuardResult | null;
  gasReserveResult: GateGuardResult | null;
}) {
  const entries = (Object.entries(currentAllocations) as Array<[SupportedAsset, number]>).sort((a, b) => b[1] - a[1]);
  const [largestAsset, largestWeight] = entries[0] ?? ["ETH", 0];

  const checks = [
    {
      label: "Concentration",
      state: largestWeight >= 60 ? ("adjust" as const) : largestWeight >= 45 ? ("watch" as const) : ("clear" as const),
      detail: `${largestAsset} is ${largestWeight.toFixed(1)}% of tracked capital.`,
    },
    {
      label: "Supported assets",
      state: unsupportedAssets.length ? ("adjust" as const) : ("clear" as const),
      detail: unsupportedAssets.length
        ? `${unsupportedAssets.join(", ")} are outside the mainnet-v1 execution path.`
        : `${formatUsd(totalTrackedValue)} is inside the supported asset set.`,
    },
    {
      label: "Turnover",
      state:
        proposalTurnoverPct == null ? ("watch" as const) : proposalTurnoverPct >= 40 ? ("watch" as const) : ("clear" as const),
      detail:
        proposalTurnoverPct == null
          ? "Run a fresh check to score turnover on the current draft."
          : `${proposalTurnoverPct.toFixed(1)}% of tracked value would move if you signed this plan.`,
    },
    {
      label: "Fee efficiency",
      state: feeGuardResult ? (feeGuardResult.passed ? (feeGuardResult.warning ? "watch" : "clear") : "adjust") : "watch",
      detail: feeGuardResult ? feeGuardResult.reason : "No fee-efficiency read yet.",
    },
    {
      label: "STRK gas reserve",
      state:
        gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed."
          ? ("adjust" as const)
          : ("clear" as const),
      detail:
        gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed."
          ? gasReserveResult.reason
          : "No gas-reserve stress is active.",
    },
  ];

  const clearCount = checks.filter((item) => item.state === "clear").length;
  const watchCount = checks.filter((item) => item.state === "watch").length;
  const adjustCount = checks.filter((item) => item.state === "adjust").length;
  const tone: "clear" | "watch" | "adjust" = adjustCount > 0 ? "adjust" : watchCount > 0 ? "watch" : "clear";
  const headline =
    tone === "adjust"
      ? "Some checks need adjustment"
      : tone === "watch"
        ? "A few checks need watching"
        : "Allocation checks are clear";

  return (
    <div className="space-y-3.5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Allocation checks</p>
            <p className="mt-1 text-sm font-medium text-white">{headline}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${allocationToneClass(tone)}`}>
            {tone === "adjust" ? "Adjust" : tone === "watch" ? "Watch" : "Clear"}
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Specific checks for this wallet mix and the current draft, not a general account profile readout.
        </p>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Clear</p>
          <p className="mt-2 text-lg font-semibold text-white">{clearCount}</p>
          <p className="mt-1 text-xs text-zinc-500">Checks with no current concern.</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Watch</p>
          <p className="mt-2 text-lg font-semibold text-white">{watchCount}</p>
          <p className="mt-1 text-xs text-zinc-500">Checks worth reviewing before signing.</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Adjust</p>
          <p className="mt-2 text-lg font-semibold text-white">{adjustCount}</p>
          <p className="mt-1 text-xs text-zinc-500">Checks actively blocking or pressuring the draft.</p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current check details</p>
        <div className="mt-3 space-y-2">
          {checks.map((check) => (
            <div key={check.label} className="rounded-xl border border-zinc-800/80 bg-zinc-950/70 px-3 py-2">
              <div className="flex items-start gap-3">
                {check.state === "clear" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                ) : check.state === "adjust" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                )}
                <div>
                  <p className="text-sm font-medium text-white">{check.label}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">{check.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
  return (
    <aside className="space-y-4 xl:sticky xl:top-6">
      <RailSection
        eyebrow="Allocation checks"
        title="Checks for this wallet mix"
        summary="Specific checks on concentration, supported assets, turnover, fees, and gas reserve."
        defaultOpen
      >
        <AllocationChecksSection
          totalTrackedValue={totalTrackedValue}
          currentAllocations={currentAllocations}
          unsupportedAssets={unsupportedAssets}
          proposalTurnoverPct={proposalTurnoverPct}
          feeGuardResult={feeGuardResult}
          gasReserveResult={gasReserveResult}
        />
      </RailSection>

      <RailSection
        eyebrow="Guardrails"
        title="Trading limits"
        summary={
          policy
            ? `${policy.allowed_assets.join(", ")} · ${policy.max_slippage_bps} bps · ${policy.paused ? "Paused" : "Active"}`
            : "Loading the current guardrails."
        }
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onTogglePolicyEditor}
            className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            {showPolicyEditor ? "Hide" : "Adjust"}
          </button>
        </div>

        {!policy ? (
          <div className="mt-3">
            <LoadingLine label="Loading guardrails" />
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-500">A compact summary of what the desk will allow before anything reaches wallet signing.</p>
            <div className="mt-3 space-y-1">
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
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={onSavePolicy}
                    disabled={!policyDirty || checking}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Save guardrails
                  </button>
                  {policyDirty ? <span className="text-xs text-amber-300">Unsaved changes</span> : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </RailSection>

      <RailSection
        eyebrow="Recent activity"
        title="Last actions"
        summary={
          recentActivity.length
            ? `${Math.min(3, recentActivity.length)} recent item${recentActivity.length === 1 ? "" : "s"} ready to review.`
            : "Recent gate checks and signed actions will show up here."
        }
      >
        <div className="mt-3 space-y-2">
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
      </RailSection>
    </aside>
  );
}
