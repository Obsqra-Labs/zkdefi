"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";

interface LiquidityTabProps {
  userAddress: string;
  onNavigate?: () => void;
}

export function LiquidityTab({ userAddress, onNavigate }: LiquidityTabProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="text-lg font-semibold text-zinc-100">Liquidity</h3>
      <p className="mt-2 text-sm text-zinc-400">
        LP panel shim active. Use standalone LP + Yield demos for productized routing checks.
      </p>
      <p className="mt-2 break-all text-xs text-zinc-500">wallet: {userAddress}</p>
      <div className="mt-4 flex items-center gap-3">
        <Link
          href="/products/private-lp-yield#standalone"
          className="inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200"
        >
          <FlaskConical className="h-4 w-4" />
          Run standalone LP demo
        </Link>
        <button
          type="button"
          onClick={onNavigate}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
