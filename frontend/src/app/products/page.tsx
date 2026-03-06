"use client";

import Link from "next/link";
import { ArrowRight, Shield } from "lucide-react";
import { SiteHeader } from "@/components/marketing/SiteHeader";

type ProductCard = {
  title: string;
  href: string;
  status: "BUILT" | "READY" | "ADAPTER";
  summary: string;
  deepLink: string;
};

const PRODUCT_CARDS: ProductCard[] = [
  {
    title: "Private Vault",
    href: "/products/private-vault",
    status: "BUILT",
    summary: "Shielded vault operations with configurable privacy tiers and proof-gated policy checks.",
    deepLink: "/agent?v=vault",
  },
  {
    title: "Privacy Pools",
    href: "/products/privacy-pools",
    status: "BUILT",
    summary: "Tiered privacy pools using commitments and nullifiers for controlled capital privacy.",
    deepLink: "/agent?v=vault&sub=portfolio",
  },
  {
    title: "Dark Ledger",
    href: "/products/dark-ledger",
    status: "BUILT",
    summary: "Internal private settlement rail for capital movement without public transfer traces.",
    deepLink: "/agent?v=vault&sub=ledger",
  },
  {
    title: "Private Swaps",
    href: "/products/private-swaps",
    status: "BUILT",
    summary: "Swap and trade paths with hidden intent and enforced slippage/risk constraints.",
    deepLink: "/agent?v=vault&sub=trade",
  },
  {
    title: "Private Lending",
    href: "/products/private-lending",
    status: "BUILT",
    summary: "Supply/borrow flows backed by credit eligibility and liquidation safety proofs.",
    deepLink: "/agent?v=vault&sub=lending",
  },
  {
    title: "Private LP + Yield",
    href: "/products/private-lp-yield",
    status: "BUILT",
    summary: "LP and yield allocation with optimization, anomaly, and exposure controls.",
    deepLink: "/agent?v=vault&sub=yield",
  },
  {
    title: "Private Staking",
    href: "/products/private-staking",
    status: "BUILT",
    summary: "Proof-aware staking operations integrated into the private vault execution surface.",
    deepLink: "/agent?v=vault&sub=staking",
  },
  {
    title: "Risk Passport",
    href: "/products/risk-passport",
    status: "READY",
    summary: "Portable trust and risk attestations through profile, passport, and receipt rails.",
    deepLink: "/profile?tab=trust",
  },
  {
    title: "Private Governance",
    href: "/products/private-governance",
    status: "READY",
    summary: "Private proposal and voting workflows backed by zero-knowledge proofs.",
    deepLink: "/governance",
  },
  {
    title: "Adapters",
    href: "/products/adapters",
    status: "ADAPTER",
    summary: "Composable strategy adapters for protocol-specific private deployment paths.",
    deepLink: "/docs/developers",
  },
];

function StatusChip({ status }: { status: ProductCard["status"] }) {
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

export default function ProductsPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader compact />

      <section className="px-6 py-14 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <Shield className="w-3.5 h-3.5" />
            Product Surface Map
          </div>
          <h1 className="text-4xl font-bold tracking-tight mt-4">Products on zkde.fi</h1>
          <p className="text-zinc-300 text-lg mt-3 max-w-3xl">
            Productized surfaces for private DeFi execution, private settlement, and portable reputation. Each product routes to a live flow in the app.
          </p>
        </div>
      </section>

      <section className="px-6 py-10">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
          {PRODUCT_CARDS.map((card) => (
            <div key={card.href} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold">{card.title}</h2>
                <StatusChip status={card.status} />
              </div>
              <p className="text-zinc-400 text-sm mt-3 leading-relaxed">{card.summary}</p>
              <div className="mt-6 flex items-center gap-4">
                <Link
                  href={card.href}
                  prefetch={false}
                  className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 text-sm font-medium transition-colors"
                >
                  View product
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href={card.deepLink}
                  prefetch={false}
                  className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Open in app
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
