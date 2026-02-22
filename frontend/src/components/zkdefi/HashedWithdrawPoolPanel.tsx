"use client";

/** Pool D — Hashed withdraw. Placeholder so agent page builds; expand with relayer/claim flow as needed. */
export function HashedWithdrawPoolPanel({ onCommitmentsChange }: { onCommitmentsChange?: () => void }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-6">
      <h3 className="text-lg font-medium text-white mb-2">Pool D — Hashed Withdraw</h3>
      <p className="text-sm text-zinc-500">Relayer deposit and claim flow. Connect wallet to use.</p>
    </div>
  );
}
