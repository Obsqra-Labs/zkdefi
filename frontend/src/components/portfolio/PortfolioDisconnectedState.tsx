"use client";

import { ShieldCheck } from "lucide-react";

import { ConnectButton } from "@/components/zkdefi/ConnectButton";

export function PortfolioDisconnectedState() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="mx-auto max-w-4xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">Mainnet V1</p>
        <h1 className="mt-4 max-w-2xl font-serif text-4xl font-bold tracking-tight text-white sm:text-5xl">
          One clean portfolio surface for proof-gated execution.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
          Connect a Starknet wallet to load live portfolio state, inspect policy, run the 13-circuit gate,
          and preview swaps or rebalances without falling back into the old `/agent` shell.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <ConnectButton />
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            Proof-gated
          </span>
        </div>
      </div>
    </main>
  );
}
