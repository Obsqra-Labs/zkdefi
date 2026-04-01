"use client";

import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { PortfolioDisconnectedState } from "@/components/portfolio/PortfolioDisconnectedState";
import { PortfolioErrorBanner } from "@/components/portfolio/PortfolioErrorBanner";
import { PortfolioHeaderStrip } from "@/components/portfolio/PortfolioHeaderStrip";
import { PortfolioMainDesk } from "@/components/portfolio/PortfolioMainDesk";
import { PortfolioRightRail } from "@/components/portfolio/PortfolioRightRail";
import { usePortfolioPageShell } from "@/components/portfolio/usePortfolioPageShell";

export default function PortfolioPage() {
  const {
    address,
    isConnected,
    error,
    hasSupportedCapital,
    unsupportedAssets,
    headerProps,
    mainDeskProps,
    rightRailProps,
  } = usePortfolioPageShell();

  if (!isConnected || !address) {
    return (
      <>
        <AppNavbar />
        <PortfolioDisconnectedState />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <AppNavbar />
      <div className="px-5 py-6 sm:px-6 lg:px-8">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="mx-auto max-w-7xl space-y-4">
        <PortfolioHeaderStrip {...headerProps} />

        {error ? <PortfolioErrorBanner message={error} /> : null}

        {!hasSupportedCapital ? (
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
          </section>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <PortfolioMainDesk {...mainDeskProps} />
          <PortfolioRightRail {...rightRailProps} />
        </div>
      </div>
      </div>
    </main>
  );
}
