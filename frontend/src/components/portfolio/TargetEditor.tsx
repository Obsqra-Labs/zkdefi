"use client";

import type { ReactNode } from "react";

import { assetAccentClasses, formatAssetAmount, formatPercent, formatUsd } from "./formatters";
import type { SupportedAsset } from "./types";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={className ?? "block"}>
      <span className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function AllocationRailRow({
  label,
  allocations,
  tone,
}: {
  label: string;
  allocations: Record<SupportedAsset, number>;
  tone: "current" | "user" | "ai";
}) {
  const labelTone =
    tone === "user" ? "text-cyan-200" : tone === "ai" ? "text-amber-200" : "text-zinc-300";
  const borderTone =
    tone === "user"
      ? "border-cyan-500/20 bg-cyan-500/5"
      : tone === "ai"
        ? "border-amber-500/20 bg-amber-500/5"
        : "border-zinc-800 bg-zinc-950/70";
  return (
    <div className={`rounded-2xl border px-3.5 py-3 ${borderTone} ${tone === "ai" ? "border-dashed" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[11px] uppercase tracking-[0.18em] ${labelTone}`}>{label}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
            <span key={`${label}-${asset}`}>
              {asset} {formatPercent(allocations[asset] ?? 0, 0)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-zinc-950">
        {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
          <div
            key={`${label}-${asset}-bar`}
            className={`h-full ${assetAccentClasses(asset)}`}
            style={{ width: `${Math.max(0, Math.min(100, allocations[asset] ?? 0))}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function AllocationOverviewAssetRow({
  asset,
  currentPct,
  targetPct,
  aiPct,
}: {
  asset: SupportedAsset;
  currentPct: number;
  targetPct: number;
  aiPct?: number;
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 px-4 py-3 md:grid-cols-[110px_repeat(4,minmax(0,1fr))] md:items-center">
      <div className="flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${assetAccentClasses(asset)}`} />
        <span className="text-sm font-medium text-white">{asset}</span>
      </div>
      <div className="flex items-center justify-between gap-3 md:block">
        <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 md:hidden">Current</span>
        <span className="text-sm text-zinc-300">{formatPercent(currentPct, 1)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 md:block">
        <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 md:hidden">Your target</span>
        <span className="text-sm font-medium text-cyan-200">{formatPercent(targetPct, 1)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 md:block">
        <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 md:hidden">AI target</span>
        <span className="text-sm text-amber-200">{typeof aiPct === "number" ? formatPercent(aiPct, 1) : "n/a"}</span>
      </div>
      <div className="flex items-center justify-between gap-3 md:block">
        <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 md:hidden">Move needed</span>
        <MovePill delta={targetPct - currentPct} />
      </div>
    </div>
  );
}

function AllocationOverviewCard({
  currentAllocations,
  userTargetAllocations,
  aiTargetAllocations,
}: {
  currentAllocations: Record<SupportedAsset, number>;
  userTargetAllocations: Record<SupportedAsset, number>;
  aiTargetAllocations: Record<SupportedAsset, number> | null;
}) {
  return (
    <div className="sm:col-span-2 rounded-[24px] border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Allocation overview</p>
          <p className="mt-1 text-sm text-zinc-300">Current, your target, and AI target in one decision surface.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
          <span className="rounded-full border border-zinc-700 px-3 py-1">Current</span>
          <span className="rounded-full border border-cyan-500/30 px-3 py-1 text-cyan-200">Your target</span>
          {aiTargetAllocations ? (
            <span className="rounded-full border border-amber-500/30 px-3 py-1 text-amber-200">AI target</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2.5">
        <AllocationRailRow label="Current" tone="current" allocations={currentAllocations} />
        <AllocationRailRow label="Your target" tone="user" allocations={userTargetAllocations} />
        {aiTargetAllocations ? <AllocationRailRow label="AI target" tone="ai" allocations={aiTargetAllocations} /> : null}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800">
        <div className="hidden grid-cols-[110px_repeat(4,minmax(0,1fr))] bg-zinc-900/90 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500 md:grid">
          <span>Asset</span>
          <span>Current</span>
          <span>Your target</span>
          <span>AI target</span>
          <span>Move needed</span>
        </div>
        <div className="space-y-2 bg-zinc-950/85 p-2">
          {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
            <AllocationOverviewAssetRow
              key={`overview-${asset}`}
              asset={asset}
              currentPct={currentAllocations[asset]}
              targetPct={userTargetAllocations[asset]}
              aiPct={aiTargetAllocations?.[asset]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MovePill({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.1) {
    return (
      <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
        Hold
      </span>
    );
  }
  const tone =
    delta > 0
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
      : "border-amber-500/20 bg-amber-500/10 text-amber-200";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${tone}`}>
      {delta > 0 ? "Add" : "Trim"} {formatPercent(Math.abs(delta), 1)}
    </span>
  );
}

function TargetEditorRow({
  asset,
  balanceLabel,
  currentPct,
  targetPct,
  aiPct,
  onChange,
}: {
  asset: SupportedAsset;
  balanceLabel: string;
  currentPct: number;
  targetPct: number;
  aiPct?: number;
  onChange: (value: string) => void;
}) {
  const delta = targetPct - currentPct;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/55 px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[150px_110px_minmax(0,1fr)_96px] lg:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${assetAccentClasses(asset)}`} />
            <p className="text-sm font-medium text-white">{asset}</p>
            <MovePill delta={delta} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{balanceLabel}</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Current</p>
          <p className="mt-1 text-sm font-medium text-white">{formatPercent(currentPct, 1)}</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            <span>Your target</span>
            {typeof aiPct === "number" ? (
              <span className="text-amber-200">AI target {formatPercent(aiPct, 1)}</span>
            ) : null}
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={targetPct}
              onChange={(event) => onChange(event.target.value)}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-400"
            />
            <span className="w-12 text-right text-xs text-zinc-500">{Math.round(targetPct)}%</span>
          </div>
        </div>

        <div>
          <input
            value={Number.isFinite(targetPct) ? String(targetPct) : ""}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </div>
      </div>
    </div>
  );
}

type RebalancePreset = {
  id: string;
  label: string;
  allocations: Record<SupportedAsset, number>;
};

type Props = {
  actionType: "swap" | "rebalance";
  swapAssetIn: SupportedAsset;
  swapAssetOut: SupportedAsset;
  onSwapAssetInChange: (asset: SupportedAsset) => void;
  onSwapAssetOutChange: (asset: SupportedAsset) => void;
  swapAmount: string;
  onSwapAmountChange: (value: string) => void;
  onSwapAmountPercent: (percent: number) => void;
  swapAmountPercent: number;
  swapAvailableAmount: number;
  swapAvailableUsd: number;
  minSwapAmount: number;
  isBelowMinSwap: boolean;
  slippageBps: string;
  onSlippageChange: (value: string) => void;
  assetSummary: Record<SupportedAsset, { amount: number; valueUsd: number }>;
  currentAllocations: Record<SupportedAsset, number>;
  userTargetAllocations: Record<SupportedAsset, number>;
  aiTargetAllocations: Record<SupportedAsset, number> | null;
  rebalancePresets: RebalancePreset[];
  onApplyPreset: (allocations: Record<SupportedAsset, number>) => void;
  targetWeights: Record<SupportedAsset, string>;
  onTargetChange: (asset: SupportedAsset, value: string) => void;
  targetWeightSum: number;
  draftGuidance?: {
    tone: "good" | "neutral" | "warning";
    title: string;
    body: string;
    stats?: Array<{
      label: string;
      value: string;
    }>;
  } | null;
  suggestedSwapFallback?: {
    label: string;
    detail: string;
  } | null;
  onUseSuggestedSwap?: () => void;
};

export function TargetEditor(props: Props) {
  const {
    actionType,
    swapAssetIn,
    swapAssetOut,
    onSwapAssetInChange,
    onSwapAssetOutChange,
    swapAmount,
    onSwapAmountChange,
    onSwapAmountPercent,
    swapAmountPercent,
    swapAvailableAmount,
    swapAvailableUsd,
    minSwapAmount,
    isBelowMinSwap,
    slippageBps,
    onSlippageChange,
    assetSummary,
    currentAllocations,
    userTargetAllocations,
    aiTargetAllocations,
    rebalancePresets,
    onApplyPreset,
    targetWeights,
    onTargetChange,
    targetWeightSum,
    draftGuidance,
    suggestedSwapFallback,
    onUseSuggestedSwap,
  } = props;

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {actionType === "swap" ? (
        <>
          <Field label="Sell">
            <select
              value={swapAssetIn}
              onChange={(event) => onSwapAssetInChange(event.target.value as SupportedAsset)}
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-sm text-zinc-100"
            >
              {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
              <span>Available</span>
              <span>{formatAssetAmount(swapAvailableAmount, swapAssetIn)}</span>
            </div>
          </Field>
          <Field label="Buy">
            <select
              value={swapAssetOut}
              onChange={(event) => onSwapAssetOutChange(event.target.value as SupportedAsset)}
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-sm text-zinc-100"
            >
              {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
              <span>Current balance</span>
              <span>{formatAssetAmount(assetSummary[swapAssetOut].amount, swapAssetOut)}</span>
            </div>
          </Field>
          <Field label="Amount" className="sm:col-span-2">
            <div className="rounded-[24px] border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-white">Trade ticket</p>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                  Spot swap
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <input
                  value={swapAmount}
                  onChange={(event) => onSwapAmountChange(event.target.value)}
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-sm text-zinc-100"
                />
                <div className="min-w-[88px] rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-right text-sm text-zinc-300">
                  {swapAssetIn}
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {[25, 50, 75, 100].map((percent) => (
                  <button
                    key={percent}
                    type="button"
                    onClick={() => onSwapAmountPercent(percent)}
                    className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-400/50 hover:text-white"
                  >
                    {percent}%
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={swapAmountPercent}
                  onChange={(event) => onSwapAmountPercent(Number.parseFloat(event.target.value) || 0)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-emerald-400"
                />
                <div className="mt-1.5 flex items-center justify-between text-xs text-zinc-500">
                  <span>{swapAmountPercent.toFixed(0)}% of available {swapAssetIn}</span>
                  <span>{formatUsd(swapAvailableUsd)}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-zinc-500">
                  <span>Minimum effective amount</span>
                  <span>{formatAssetAmount(minSwapAmount, swapAssetIn)}</span>
                </div>
                {isBelowMinSwap ? (
                  <p className="mt-1.5 text-xs text-amber-300">
                    Amount is likely too small to route reliably. Try at least {formatAssetAmount(minSwapAmount, swapAssetIn)}.
                  </p>
                ) : null}
              </div>
            </div>
          </Field>
          <Field label="Max slippage (bps)">
            <input
              value={slippageBps}
              onChange={(event) => onSlippageChange(event.target.value)}
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-sm text-zinc-100"
            />
          </Field>
        </>
      ) : (
        <>
          <AllocationOverviewCard
            currentAllocations={currentAllocations}
            userTargetAllocations={userTargetAllocations}
            aiTargetAllocations={aiTargetAllocations}
          />

          <div className="sm:col-span-2 rounded-[24px] border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Target editor</p>
                <p className="mt-1 text-sm text-zinc-300">Edit your owned target directly, or start from a preset.</p>
              </div>
              <div
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                  Math.abs(targetWeightSum - 100) <= 1
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-500/20 bg-amber-500/10 text-amber-200"
                }`}
              >
                Target total {targetWeightSum.toFixed(1)}%
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {rebalancePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onApplyPreset(preset.allocations)}
                  className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-400/50 hover:text-white"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {draftGuidance ? (
              <div
                className={`mt-3 rounded-2xl border px-3.5 py-3 text-sm ${
                  draftGuidance.tone === "good"
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                    : draftGuidance.tone === "warning"
                      ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
                      : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"
                }`}
              >
                <p className="font-medium text-white">{draftGuidance.title}</p>
                <p className="mt-1 text-xs text-zinc-300/85">{draftGuidance.body}</p>
                {draftGuidance.stats?.length ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {draftGuidance.stats.map((stat) => (
                      <div
                        key={`${stat.label}-${stat.value}`}
                        className="rounded-xl border border-white/10 bg-zinc-950/45 px-3 py-2"
                      >
                        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{stat.label}</p>
                        <p className="mt-1 text-sm font-medium text-white">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {suggestedSwapFallback && onUseSuggestedSwap ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-950/45 px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium text-white">{suggestedSwapFallback.label}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">{suggestedSwapFallback.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={onUseSuggestedSwap}
                      className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-cyan-100 hover:border-cyan-400/50 hover:bg-cyan-500/20"
                    >
                      Use simpler swap
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
                <TargetEditorRow
                  key={asset}
                  asset={asset}
                  balanceLabel={formatAssetAmount(assetSummary[asset].amount, asset)}
                  currentPct={currentAllocations[asset]}
                  targetPct={Number.parseFloat(targetWeights[asset]) || 0}
                  aiPct={aiTargetAllocations?.[asset]}
                  onChange={(value) => onTargetChange(asset, value)}
                />
              ))}
            </div>
            <div className="mt-3 grid gap-2.5 md:grid-cols-[1fr_170px]">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3.5 py-3 text-xs text-zinc-500">
                The desk normalizes at execution, but staying close to 100% keeps the plan easier to trust.
              </div>
              <Field label="Max slippage (bps)">
                <input
                  value={slippageBps}
                  onChange={(event) => onSlippageChange(event.target.value)}
                  className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-sm text-zinc-100"
                />
              </Field>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
