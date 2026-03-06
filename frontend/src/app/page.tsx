import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, FileCheck, Layers, Shield } from "lucide-react";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { PRODUCT_CATEGORIES, PRODUCTS_BY_CATEGORY } from "@/lib/products/catalog";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-zinc-800 px-6 py-24">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-950/30 via-transparent to-cyan-950/30" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(16,185,129,0.16),transparent_52%)]" />

        <div className="relative mx-auto max-w-5xl text-center">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">
            Starknet Re{"{define}"} Hackathon · Privacy track
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">
            <span className="text-sm font-mono text-emerald-400">zkDE + GATE</span>
            <span className="text-xs text-zinc-500">
              Zero-Knowledge Deterministic Engine + Governed Autonomous Trustless Execution
            </span>
          </div>

          <h1 className="mt-8 text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
            <span className="bg-gradient-to-r from-white via-emerald-100 to-white bg-clip-text text-transparent">
              Private DeFi.
            </span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              Verifiable execution.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-lg text-zinc-300">
            Our zkML coprocessor runs inference and proofs off-chain, then the chain verifies before
            execution. Delegate with session keys once. No proof, no execution.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/agent"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 font-semibold transition-colors hover:bg-emerald-500"
            >
              Launch App
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/products"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-medium text-zinc-200 transition-colors hover:border-emerald-500/50 hover:text-white"
            >
              Explore Products
            </Link>
            <Link
              href="/docs"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-medium text-zinc-200 transition-colors hover:border-cyan-500/50 hover:text-white"
            >
              Docs
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Product Categories</h2>
            <p className="mx-auto mt-3 max-w-2xl text-zinc-400">
              Focused surfaces for private ledger operations, DeFi execution, trust primitives, and
              automation infrastructure.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {PRODUCT_CATEGORIES.map((category) => {
              const count = (PRODUCTS_BY_CATEGORY[category.id] || []).length;
              return (
                <article
                  key={category.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-emerald-500/30"
                >
                  <p className="text-xs uppercase tracking-wider text-zinc-500">{category.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{category.description}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-300">
                      <span className="font-semibold text-zinc-100">{count}</span> products
                    </span>
                    <Link
                      href={`/products#${category.id}`}
                      prefetch={false}
                      className="text-sm font-medium text-cyan-300 transition-colors hover:text-cyan-200"
                    >
                      View category
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-800 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Two Core Concepts</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              The zkML coprocessor powers trustless execution and verifiable AI without exposing strategy
              internals.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
            <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600/20">
                <FileCheck className="h-6 w-6 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold">Trustless Execution</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                We prove policy and inference predicates before the contract executes. The on-chain slice
                remains deterministic and auditable.
              </p>
            </article>

            <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600/20">
                <Layers className="h-6 w-6 text-cyan-300" />
              </div>
              <h3 className="text-xl font-semibold">Verifiable AI</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Model outputs stay private while proof statements are validated on-chain, enabling
                compliance guarantees without leaking raw strategy context.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-3xl font-bold md:text-4xl">How It Works</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
            <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
              <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold">
                1
              </div>
              <h3 className="font-semibold">Set Constraints</h3>
              <p className="mt-2 text-sm text-zinc-400">
                Configure protocols, exposure, and policy limits with session-key delegation.
              </p>
            </article>
            <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
              <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold">
                2
              </div>
              <h3 className="font-semibold">Inference + Proof</h3>
              <p className="mt-2 text-sm text-zinc-400">
                Risk and strategy predicates are proven before any action can be accepted.
              </p>
            </article>
            <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
              <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold">
                3
              </div>
              <h3 className="font-semibold">Verified Execution</h3>
              <p className="mt-2 text-sm text-zinc-400">
                The contract checks proofs on-chain and writes an auditable execution receipt.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="px-6 py-10">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Starknet</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Open Source</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Integrity + Garaga</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-400" />
              <span>zkDE + GATE</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
