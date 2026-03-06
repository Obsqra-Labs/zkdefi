"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { SiteHeader } from "@/components/marketing/SiteHeader";

type ProductStatus = "BUILT" | "READY" | "ADAPTER";

function ProductStatusChip({ status }: { status: ProductStatus }) {
  const isBuilt = status === "BUILT";
  const isReady = status === "READY";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
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

export interface ProductPageFrameProps {
  title: string;
  status: ProductStatus;
  summary: string;
  description: string;
  capabilities: string[];
  deepLinkHref: string;
  deepLinkLabel: string;
  docsHref?: string;
}

export function ProductPageFrame({
  title,
  status,
  summary,
  description,
  capabilities,
  deepLinkHref,
  deepLinkLabel,
  docsHref = "/docs",
}: ProductPageFrameProps) {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader compact />

      <section className="px-6 pt-12 pb-8 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto">
          <Link
            href="/products"
            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Products
          </Link>
          <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
              <p className="text-lg text-zinc-300 mt-3 max-w-3xl">{summary}</p>
            </div>
            <ProductStatusChip status={status} />
          </div>
        </div>
      </section>

      <section className="px-6 py-10">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
              <h2 className="text-xl font-semibold mb-3">What it does</h2>
              <p className="text-zinc-300 leading-relaxed">{description}</p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
              <h2 className="text-xl font-semibold mb-4">Current capabilities</h2>
              <ul className="space-y-2">
                {capabilities.map((capability) => (
                  <li key={capability} className="text-zinc-300 text-sm leading-relaxed">
                    • {capability}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h3 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Open product</h3>
              <Link
                href={deepLinkHref}
                prefetch={false}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 font-semibold transition-colors"
              >
                {deepLinkLabel}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <p className="text-xs text-zinc-500 mt-3 break-all">{deepLinkHref}</p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h3 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">References</h3>
              <Link
                href={docsHref}
                prefetch={false}
                className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200 transition-colors"
              >
                Documentation
                <ExternalLink className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
