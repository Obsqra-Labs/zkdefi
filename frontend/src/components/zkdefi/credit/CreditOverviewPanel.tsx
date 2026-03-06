"use client";

interface CreditOverviewPanelProps {
  address: string;
}

export function CreditOverviewPanel({ address }: CreditOverviewPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="text-sm font-semibold text-zinc-100">Credit Overview</h4>
      <p className="mt-2 text-sm text-zinc-400">
        Overview shim active. Wallet-scoped credit details are available through profile decision APIs.
      </p>
      <code className="mt-3 block break-all rounded border border-zinc-800 bg-zinc-950/70 p-2 text-xs text-zinc-300">
        {address}
      </code>
    </section>
  );
}
