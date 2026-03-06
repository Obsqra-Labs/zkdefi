"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";

export function LimitOrdersPanel() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="text-lg font-semibold text-zinc-100">Limit Orders</h3>
      <p className="mt-2 text-sm text-zinc-400">
        Limit-order panel shim active. The Private Swaps product page includes standalone request
        demos for route and execution payload checks.
      </p>
      <Link
        href="/products/private-swaps#standalone"
        className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200"
      >
        <FlaskConical className="h-4 w-4" />
        Run standalone trade demo
      </Link>
    </div>
  );
}
