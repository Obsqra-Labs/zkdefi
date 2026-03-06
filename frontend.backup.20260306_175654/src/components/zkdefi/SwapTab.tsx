"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";

export function SwapTab({ userAddress }: { userAddress: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="text-lg font-semibold text-zinc-100">Swap</h3>
      <p className="mt-2 text-sm text-zinc-400">
        Swap panel shim active. Use the standalone Private Swaps product demo for full quote and
        calldata testing.
      </p>
      <p className="mt-2 break-all text-xs text-zinc-500">wallet: {userAddress}</p>
      <Link
        href="/products/private-swaps#standalone"
        className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200"
      >
        <FlaskConical className="h-4 w-4" />
        Run standalone swaps demo
      </Link>
    </div>
  );
}
