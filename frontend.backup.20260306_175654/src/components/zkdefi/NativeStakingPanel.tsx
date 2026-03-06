"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";

export function NativeStakingPanel() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="text-lg font-semibold text-zinc-100">Native Staking</h3>
      <p className="mt-2 text-sm text-zinc-400">
        Staking panel shim active for compile compatibility. Use the standalone staking product
        demo for action testing.
      </p>
      <Link
        href="/products/private-staking#standalone"
        className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200"
      >
        <FlaskConical className="h-4 w-4" />
        Run standalone staking demo
      </Link>
    </div>
  );
}
