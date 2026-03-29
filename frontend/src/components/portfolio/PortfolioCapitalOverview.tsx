"use client";

import { assetAccentClasses, formatPercent, formatUsd } from "./formatters";
import type { SupportedAsset } from "./types";

type Props = {
  supportedAssets: SupportedAsset[];
  assetSummary: Record<SupportedAsset, { amount: number; valueUsd: number }>;
  currentAllocations: Record<SupportedAsset, number>;
  hasSupportedCapital: boolean;
  unsupportedAssets: string[];
};

export function PortfolioCapitalOverview({
  supportedAssets,
  assetSummary,
  currentAllocations,
  hasSupportedCapital,
  unsupportedAssets,
}: Props) {
  if (!hasSupportedCapital) {
    return (
      <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Current allocation</p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {unsupportedAssets.length ? "Unsupported wallet mix" : "No portfolio yet"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              {unsupportedAssets.length
                ? "/portfolio mainnet-v1 currently supports ETH, STRK, and USDC only. Unsupported holdings stay outside the main execution path for now."
                : "Wallet balances will appear here after the next scan. The desk stays visible so the flow still makes sense before funds land."}
            </p>
          </div>
          <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
            ETH · STRK · USDC
          </span>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-[22px] border border-dashed border-zinc-800/80 bg-zinc-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">Allocation shell</p>
                <p className="mt-1 text-xs text-zinc-500">Tracked balances will fill this view once the wallet scan returns supported assets.</p>
              </div>
              <span className="rounded-full border border-zinc-700 bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
                Waiting for balances
              </span>
            </div>

            <div className="mt-4 overflow-hidden rounded-full bg-zinc-950">
              <div className="flex h-4">
                {supportedAssets.map((asset) => (
                  <div
                    key={`${asset}-overview-shell`}
                    className={`${assetAccentClasses(asset)} opacity-30`}
                    style={{ width: `${100 / supportedAssets.length}%` }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {supportedAssets.map((asset) => (
                <div key={`${asset}-shell`} className="rounded-2xl border border-dashed border-zinc-800/80 bg-zinc-950/65 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${assetAccentClasses(asset)} opacity-60`} />
                    <span className="text-sm font-medium text-white">{asset}</span>
                  </div>
                  <p className="mt-3 text-lg font-semibold text-zinc-400">0%</p>
                  <p className="mt-1 text-xs text-zinc-500">$0.00</p>
                </div>
              ))}
            </div>
          </div>
          {unsupportedAssets.length ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <p className="text-sm font-medium text-amber-100">Unsupported holdings stay separate</p>
              <p className="mt-1 text-xs text-amber-100/80">{unsupportedAssets.join(", ")}</p>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Current allocation</p>
          <h2 className="mt-1 text-xl font-semibold text-white">What you hold now</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            A clean read of the wallet mix before you decide whether to swap or rebalance.
          </p>
        </div>
        <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
          {supportedAssets.length} tracked assets
        </span>
      </div>

      <div className="mt-5">
        <div className="rounded-[22px] border border-zinc-800/80 bg-zinc-900/55 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">Mix at a glance</p>
              <p className="mt-1 text-xs text-zinc-500">Current weights stay consistent with the target editor and plan.</p>
            </div>
            <span className="rounded-full border border-zinc-700 bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
              Current mix
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-full bg-zinc-950">
            <div className="flex h-4">
              {supportedAssets.map((asset) => (
                <div
                  key={`${asset}-overview-bar`}
                  className={assetAccentClasses(asset)}
                  style={{ width: `${currentAllocations[asset]}%` }}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {supportedAssets.map((asset) => (
              <div key={`${asset}-stat`} className="rounded-2xl border border-zinc-800/80 bg-zinc-950/65 p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${assetAccentClasses(asset)}`} />
                  <span className="text-sm font-medium text-white">{asset}</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{formatPercent(currentAllocations[asset], 1)}</p>
                <p className="mt-1 text-xs text-zinc-500">{formatUsd(assetSummary[asset].valueUsd)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
