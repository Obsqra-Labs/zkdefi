"use client";

import { PortfolioCapitalOverview } from "@/components/portfolio/PortfolioCapitalOverview";
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
    supportedAssets,
    assetSummary,
    currentAllocations,
    hasSupportedCapital,
    unsupportedAssets,
    headerProps,
    mainDeskProps,
    rightRailProps,
  } = usePortfolioPageShell();

  if (!isConnected || !address) {
    return <PortfolioDisconnectedState />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-100 sm:px-6 lg:px-8">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="mx-auto max-w-7xl space-y-5">
        <PortfolioHeaderStrip {...headerProps} />

        {error ? <PortfolioErrorBanner message={error} /> : null}

        <PortfolioCapitalOverview
          supportedAssets={supportedAssets}
          assetSummary={assetSummary}
          currentAllocations={currentAllocations}
          hasSupportedCapital={hasSupportedCapital}
          unsupportedAssets={unsupportedAssets}
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <PortfolioMainDesk {...mainDeskProps} />
          <PortfolioRightRail {...rightRailProps} />
        </div>
      </div>
    </main>
  );
}
