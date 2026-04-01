"use client";

import { ShieldCheck, Zap, BarChart3, Lock } from "lucide-react";

import { ConnectButton } from "@/components/zkdefi/ConnectButton";

export function PortfolioDisconnectedState() {
  return (
    <main className="relative min-h-[calc(100vh-56px)] bg-zinc-950 px-6 py-16 text-zinc-100">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-4xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-cyan-400/70">zkde.fi · Mainnet</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Proof-gated DeFi
          <br />
          <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
            on Starknet.
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
          Connect your wallet to manage portfolio allocations, run the 13-circuit safety gate,
          and execute swaps — all verified by zero-knowledge proofs on-chain.
        </p>

        <div className="mt-10 flex items-center gap-4">
          <ConnectButton />
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            Proof-gated
          </span>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            { icon: BarChart3, label: "Portfolio Intelligence", desc: "AI-driven allocation with ZKML-verified recommendations" },
            { icon: Lock, label: "13-Circuit Gate", desc: "Constraint checks run before every trade — enforced by proofs" },
            { icon: Zap, label: "On-Chain Receipts", desc: "Every execution minted as a verifiable receipt on Starknet mainnet" },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5">
              <Icon className="h-5 w-5 text-cyan-400" />
              <p className="mt-3 text-sm font-medium text-white">{label}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
