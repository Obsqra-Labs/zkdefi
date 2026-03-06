"use client";

interface FicoPackProofPanelProps {
  address: string;
}

const PROOF_PACK = [
  "solvency_proof",
  "risk_passport",
  "performance",
  "strategy_integrity",
  "execution_integrity",
];

export function FicoPackProofPanel({ address }: FicoPackProofPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="text-sm font-semibold text-zinc-100">FICO Pack Proofs</h4>
      <p className="mt-2 text-sm text-zinc-400">
        Proof-pack shim active for compile safety. Connect to reputation proof routes for live status.
      </p>
      <ul className="mt-3 space-y-2">
        {PROOF_PACK.map((proof) => (
          <li
            key={proof}
            className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs"
          >
            <span className="text-zinc-300">{proof}</span>
            <span className="text-zinc-500">pending</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 break-all text-[11px] text-zinc-500">wallet: {address}</p>
    </section>
  );
}
