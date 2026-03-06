"use client";

interface SystemPerksPanelProps {
  completedProofs: string[];
  tier: number;
}

export function SystemPerksPanel({ completedProofs, tier }: SystemPerksPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="text-sm font-semibold text-zinc-100">System Perks</h4>
      <p className="mt-2 text-sm text-zinc-400">Tier: {tier}</p>

      <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/70 p-3">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Completed Proofs</p>
        {completedProofs.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-400">No completed proofs yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {completedProofs.map((proof) => (
              <li key={proof} className="text-xs text-zinc-300">
                • {proof}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
