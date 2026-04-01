"use client";

import { ShieldCheck, Gauge, Lock, Wallet } from "lucide-react";

interface SettingsTabProps {
  address: string;
}

export function SettingsTab({ address }: SettingsTabProps) {
  return (
    <div className="space-y-4 p-4">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-zinc-300" />
          <h3 className="text-sm font-semibold text-zinc-100">Wallet Session</h3>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Connected as <span className="font-mono text-zinc-300">{address}</span>. Use the right rail to grant or renew session permissions.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <Gauge className="h-4 w-4 text-amber-400" />
            <h4 className="text-sm font-semibold">Execution Limits</h4>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Configure max notional per action, slippage bounds, and approved venues before enabling autonomous execution.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2 text-zinc-100">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h4 className="text-sm font-semibold">Proof Policy</h4>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Every recommendation runs through policy, risk, and proof gates before execution is allowed.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center gap-2 text-zinc-100">
          <Lock className="h-4 w-4 text-cyan-400" />
          <h4 className="text-sm font-semibold">Privacy Mode</h4>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Privacy and receipt issuance remain backend-enforced. Adjust advanced rail usage from execution drawers when available.
        </p>
      </section>
    </div>
  );
}
