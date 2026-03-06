"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, FlaskConical, LineChart, Wallet } from "lucide-react";

interface VaultSurfaceContainerProps {
  address?: string;
  initialSubTab?: string;
  isDemo?: boolean;
  onNavigateToTrade?: (sub?: string) => void;
  onNavigateToOracle?: () => void;
}

type VaultSubTab = "portfolio" | "trade" | "lending" | "staking" | "activity";

const SUB_TABS: VaultSubTab[] = ["portfolio", "trade", "lending", "staking", "activity"];

export function VaultSurfaceContainer({
  address,
  initialSubTab,
  isDemo = false,
  onNavigateToTrade,
  onNavigateToOracle,
}: VaultSurfaceContainerProps) {
  const normalizedInitial = SUB_TABS.includes((initialSubTab || "") as VaultSubTab)
    ? (initialSubTab as VaultSubTab)
    : "portfolio";

  const [subTab, setSubTab] = useState<VaultSubTab>(normalizedInitial);

  useEffect(() => {
    if (initialSubTab && SUB_TABS.includes(initialSubTab as VaultSubTab)) {
      setSubTab(initialSubTab as VaultSubTab);
    }
  }, [initialSubTab]);

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {SUB_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSubTab(tab)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                subTab === tab
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Vault Surface ({subTab})</h3>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              This surface is active and can be extended with deeper vault widgets. Product-grade
              standalone demos are available under the Products catalog.
            </p>
          </div>
          <Wallet className="h-5 w-5 text-emerald-400" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Address</p>
            <p className="mt-1 break-all text-sm text-zinc-200">{address || "Not connected"}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Mode</p>
            <p className="mt-1 text-sm text-zinc-200">{isDemo ? "Demo" : "Live"}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigateToTrade?.("trade")}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-500/40 hover:text-white"
          >
            <LineChart className="h-4 w-4" />
            Open Trade Tab
          </button>
          <button
            type="button"
            onClick={() => onNavigateToOracle?.()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-cyan-500/40 hover:text-white"
          >
            <ArrowRight className="h-4 w-4" />
            Open Oracle Surface
          </button>
          <Link
            href="/products/private-vault#standalone"
            className="inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200"
          >
            <FlaskConical className="h-4 w-4" />
            Run standalone vault demo
          </Link>
        </div>
      </article>
    </section>
  );
}
