"use client";

import { ArrowRightLeft } from "lucide-react";

import { formatAssetAmount, formatUsd } from "./formatters";
import type { SwapStep, SupportedAsset } from "./types";

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <p className="mt-2 text-sm text-zinc-500">{body}</p>
    </div>
  );
}

function PlanStepRow({
  index,
  label,
  value,
  meta,
}: {
  index: number;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-[10px] text-zinc-400">
            {index}
          </span>
          <div>
            <p className="text-sm font-medium text-white">{label}</p>
            <p className="mt-1 text-xs text-zinc-500">{meta}</p>
          </div>
        </div>
        <span className="text-sm text-zinc-300">{value}</span>
      </div>
    </div>
  );
}

type PreparedCallPreview = {
  step: SwapStep;
  execution_adapter?: string;
  route?: string[];
};

type Props = {
  actionType: "swap" | "rebalance";
  gateSwapSteps: SwapStep[];
  pendingPreparedCalls: PreparedCallPreview[] | null;
  pendingRouteLabel: string | null;
  lastPreparedAdapter: string | null;
  fromWei: (amountWei: number, asset: SupportedAsset) => number;
};

export function ExecutionPlanCard({
  actionType,
  gateSwapSteps,
  pendingPreparedCalls,
  pendingRouteLabel,
  lastPreparedAdapter,
  fromWei,
}: Props) {
  const activeSteps = pendingPreparedCalls?.length ? pendingPreparedCalls.map((item) => item.step) : gateSwapSteps;
  const totalMovedUsd = activeSteps.reduce((sum, step) => sum + (Number(step.value_usd) || 0), 0);
  const routeLabel = (pendingRouteLabel ?? lastPreparedAdapter)?.toUpperCase() ?? "BEST ROUTE";

  return (
    <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Execution plan</p>
          <h2 className="mt-1 text-lg font-semibold text-white">What will change if you sign</h2>
          <p className="mt-1.5 text-sm text-zinc-400">Read the exact spot path before wallet signing.</p>
        </div>
        <span className="rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-400">
          {routeLabel}
        </span>
      </div>

      <div className="mt-3.5 grid gap-2.5 rounded-[22px] border border-zinc-800/80 bg-zinc-900/55 p-3.5 sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Trades</p>
          <p className="mt-1.5 text-lg font-semibold text-white">{activeSteps.length}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Value moved</p>
          <p className="mt-1.5 text-lg font-semibold text-white">{formatUsd(totalMovedUsd)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Gas reserve</p>
          <p className="mt-1.5 text-lg font-semibold text-emerald-200">STRK preserved</p>
        </div>
      </div>

      {actionType === "rebalance" && pendingPreparedCalls?.length ? (
        <div className="mt-3.5 space-y-2">
          {pendingPreparedCalls.map((step, idx) => (
            <PlanStepRow
              index={idx + 1}
              key={`${step.step.from_asset}-${step.step.to_asset}-${idx}-prepared`}
              label={`Sell ${step.step.from_asset}, buy ${step.step.to_asset}`}
              value={formatAssetAmount(fromWei(Number(step.step.amount_wei), step.step.from_asset), step.step.from_asset)}
              meta={`${(step.execution_adapter ?? "best").toUpperCase()} • ${step.route?.length ? step.route.join(" → ") : "direct route"}`}
            />
          ))}
        </div>
      ) : gateSwapSteps.length ? (
        <div className="mt-3.5 space-y-2">
          {gateSwapSteps.map((step, index) => (
            <PlanStepRow
              index={index + 1}
              key={`${step.from_asset}-${step.to_asset}-${index}`}
              label={`Sell ${step.from_asset}, buy ${step.to_asset}`}
              value={formatUsd(step.value_usd)}
              meta={`${routeLabel} • expected receive in ${step.to_asset}`}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No plan yet" body="Set a target or trade amount and the exact path will appear here." />
      )}
    </section>
  );
}
