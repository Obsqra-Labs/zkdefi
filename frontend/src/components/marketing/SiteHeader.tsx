"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, Menu, Shield, X } from "lucide-react";
import { useState } from "react";

type ProductLink = {
  label: string;
  href: string;
  description: string;
  status: "BUILT" | "READY" | "ADAPTER";
};

const PRODUCT_LINKS: ProductLink[] = [
  {
    label: "Private Vault",
    href: "/products/private-vault",
    description: "Shielded deposits, withdrawals, and policy-gated capital.",
    status: "BUILT",
  },
  {
    label: "Privacy Pools",
    href: "/products/privacy-pools",
    description: "Tiered commitment/nullifier privacy pools for capital entry and exit.",
    status: "BUILT",
  },
  {
    label: "Dark Ledger",
    href: "/products/dark-ledger",
    description: "Private internal settlement with no public transfer trail.",
    status: "BUILT",
  },
  {
    label: "Private Swaps",
    href: "/products/private-swaps",
    description: "Swap execution with private intent and slippage constraints.",
    status: "BUILT",
  },
  {
    label: "Private Lending",
    href: "/products/private-lending",
    description: "Supply and borrow with proof-backed eligibility paths.",
    status: "BUILT",
  },
  {
    label: "Private LP + Yield",
    href: "/products/private-lp-yield",
    description: "LP and yield paths with privacy tiers and risk checks.",
    status: "BUILT",
  },
  {
    label: "Private Staking",
    href: "/products/private-staking",
    description: "Stake with privacy controls and proof-aware policy enforcement.",
    status: "BUILT",
  },
  {
    label: "Risk Passport",
    href: "/products/risk-passport",
    description: "Portable attestations across trust, reputation, and compliance.",
    status: "READY",
  },
  {
    label: "Private Governance",
    href: "/products/private-governance",
    description: "Private voting and proposal workflows with ZK verification.",
    status: "READY",
  },
  {
    label: "Adapters",
    href: "/products/adapters",
    description: "Composable adapter layer for private strategy integrations.",
    status: "ADAPTER",
  },
];

function StatusChip({ status }: { status: ProductLink["status"] }) {
  const isBuilt = status === "BUILT";
  const isReady = status === "READY";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        isBuilt
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : isReady
            ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      {status}
    </span>
  );
}

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-b border-zinc-800 px-6 py-4 sticky top-0 z-50 bg-zinc-950/95 backdrop-blur">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-lg">zkde.fi</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          <div className="relative group">
            <button
              type="button"
              className="text-sm text-zinc-300 hover:text-white transition-colors inline-flex items-center gap-1"
              aria-haspopup="menu"
            >
              Products
              <ChevronDown className="w-4 h-4" />
            </button>
            <div className="absolute left-0 top-full mt-3 hidden min-w-[430px] rounded-xl border border-zinc-800 bg-zinc-950/95 p-2 shadow-xl group-hover:block">
              <div className="grid grid-cols-1 gap-1">
                {PRODUCT_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    className="rounded-lg px-3 py-2.5 hover:bg-zinc-900 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-zinc-200">{item.label}</span>
                      <StatusChip status={item.status} />
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">{item.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <Link href="/proofs" prefetch={false} className="text-sm text-zinc-400 hover:text-white transition-colors">
            Proofs
          </Link>
          <Link href="/docs/developers" prefetch={false} className="text-sm text-zinc-400 hover:text-white transition-colors">
            Developers
          </Link>
          <Link href="/docs" prefetch={false} className="text-sm text-zinc-400 hover:text-white transition-colors">
            Docs
          </Link>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {!compact && (
            <Link
              href="/products"
              prefetch={false}
              className="px-4 py-2 border border-zinc-700 hover:border-emerald-500/40 rounded-lg text-sm font-medium transition-colors"
            >
              All Products
            </Link>
          )}
          <Link
            href="/agent"
            prefetch={false}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-emerald-500/20 flex items-center gap-2"
          >
            Launch App
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <button
          type="button"
          className="md:hidden p-2 text-zinc-300 hover:text-white"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden max-w-7xl mx-auto mt-3 rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 space-y-2">
          <p className="text-xs uppercase tracking-wide text-zinc-500 px-1">Products</p>
          {PRODUCT_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              className="block rounded-lg px-3 py-2 hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-zinc-200">{item.label}</span>
                <StatusChip status={item.status} />
              </div>
            </Link>
          ))}
          <div className="pt-2 mt-2 border-t border-zinc-800 grid grid-cols-2 gap-2">
            <Link href="/proofs" prefetch={false} onClick={() => setMobileOpen(false)} className="text-sm text-zinc-400 hover:text-white px-3 py-2 rounded-lg hover:bg-zinc-900">
              Proofs
            </Link>
            <Link href="/docs" prefetch={false} onClick={() => setMobileOpen(false)} className="text-sm text-zinc-400 hover:text-white px-3 py-2 rounded-lg hover:bg-zinc-900">
              Docs
            </Link>
            <Link href="/products" prefetch={false} onClick={() => setMobileOpen(false)} className="text-sm text-zinc-400 hover:text-white px-3 py-2 rounded-lg hover:bg-zinc-900">
              All Products
            </Link>
            <Link href="/agent" prefetch={false} onClick={() => setMobileOpen(false)} className="text-sm text-emerald-300 hover:text-emerald-200 px-3 py-2 rounded-lg hover:bg-zinc-900">
              Launch App
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
