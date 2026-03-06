import Link from "next/link";
import { ArrowRight, Shield, Sparkles } from "lucide-react";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { PRODUCT_CATEGORIES, PRODUCTS, PRODUCTS_BY_CATEGORY } from "@/lib/products/catalog";

const FEATURED_PRODUCTS = PRODUCTS.filter((product) => product.featured).slice(0, 8);

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-zinc-800 px-6 py-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.18),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(6,182,212,0.16),transparent_35%)]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <Shield className="h-3.5 w-3.5" />
            Private Finance Stack
          </div>

          <h1 className="mt-6 max-w-5xl text-5xl font-bold tracking-tight">
            Productized private finance across ledger, DeFi, trust, and automation.
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-zinc-300">
            zkde.fi ships standalone product surfaces with runnable API demos. Explore the catalog by
            category and test live capabilities without onboarding into the full app.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/products"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 font-semibold transition-colors hover:bg-emerald-500"
            >
              Explore products
              <ArrowRight className="h-4 w-4" />
            </Link>
            {FEATURED_PRODUCTS[0] && (
              <Link
                href={`/products/${FEATURED_PRODUCTS[0].slug}#standalone`}
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-3 font-semibold text-zinc-200 transition-colors hover:border-cyan-500/40 hover:text-white"
              >
                Run first standalone demo
                <Sparkles className="h-4 w-4" />
              </Link>
            )}
          </div>

          <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
            {PRODUCT_CATEGORIES.map((category) => {
              const count = (PRODUCTS_BY_CATEGORY[category.id] || []).length;
              return (
                <div key={category.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">{category.title}</p>
                  <p className="mt-1 text-xl font-semibold text-zinc-100">{count}</p>
                  <p className="text-xs text-zinc-400">products</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="mx-auto max-w-6xl space-y-8">
          {PRODUCT_CATEGORIES.map((category) => {
            const products = PRODUCTS_BY_CATEGORY[category.id] || [];
            return (
              <section key={category.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold">{category.title}</h2>
                    <p className="mt-1 text-sm text-zinc-400">{category.description}</p>
                  </div>
                  <Link
                    href={`/products#${category.id}`}
                    prefetch={false}
                    className="text-sm text-cyan-300 transition-colors hover:text-cyan-200"
                  >
                    View all
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {products.slice(0, 3).map((product) => (
                    <article key={product.slug} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                      <h3 className="text-lg font-semibold text-zinc-100">{product.title}</h3>
                      <p className="mt-2 text-sm text-zinc-400">{product.summary}</p>
                      <div className="mt-4 flex items-center gap-3">
                        <Link
                          href={`/products/${product.slug}#standalone`}
                          prefetch={false}
                          className="text-sm font-medium text-emerald-300 transition-colors hover:text-emerald-200"
                        >
                          Run standalone demo
                        </Link>
                        <Link
                          href={`/products/${product.slug}`}
                          prefetch={false}
                          className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                          Details
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
