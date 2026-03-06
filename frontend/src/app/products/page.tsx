import Link from "next/link";
import { ArrowRight, FlaskConical, Shield } from "lucide-react";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { PRODUCT_CATEGORIES, PRODUCTS_BY_CATEGORY, PRODUCTS } from "@/lib/products/catalog";
import { ProductStatus } from "@/lib/products/types";

function StatusChip({ status }: { status: ProductStatus }) {
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

      <section className="border-b border-zinc-800 px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <Shield className="h-3.5 w-3.5" />
            Product Catalog
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">Category-first product surface</h1>
          <p className="mt-3 max-w-4xl text-lg text-zinc-300">
            Standalone products grouped by operating domain. Every product page includes runnable API
            sandbox actions, with optional advanced app links when deeper controls are useful.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {PRODUCT_CATEGORIES.map((category) => {
              const count = (PRODUCTS_BY_CATEGORY[category.id] || []).length;
              return (
                <Link
                  key={category.id}
                  href={`#${category.id}`}
                  className="rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-white"
                >
                  {category.title} ({count})
                </Link>
              );
            })}
            <span className="rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-500">
              Total products: {PRODUCTS.length}
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-10 px-6 py-10">
        <div className="mx-auto max-w-6xl space-y-10">
          {PRODUCT_CATEGORIES.map((category) => {
            const products = PRODUCTS_BY_CATEGORY[category.id] || [];
            return (
              <section
                key={category.id}
                id={category.id}
                className="scroll-mt-28 rounded-2xl border border-zinc-800 bg-zinc-900/25 p-6"
              >
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800 pb-4">
                  <div>
                    <h2 className="text-2xl font-semibold text-zinc-100">{category.title}</h2>
                    <p className="mt-1 max-w-3xl text-sm text-zinc-400">{category.description}</p>
                  </div>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
                    {products.length} products
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {products.map((product) => (
                    <article
                      key={product.slug}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold text-zinc-100">{product.title}</h3>
                        <StatusChip status={product.status} />
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{product.summary}</p>
                      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                          Problem this product solves
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                          {product.description}
                        </p>
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-4">
                        <Link
                          href={`/products/${product.slug}#standalone`}
                          prefetch={false}
                          className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300 transition-colors hover:text-emerald-200"
                        >
                          <FlaskConical className="h-3.5 w-3.5" />
                          Run standalone demo
                        </Link>
                        <Link
                          href={`/products/${product.slug}`}
                          prefetch={false}
                          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
                        >
                          View product
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                        {product.advancedLink && (
                          <Link
                            href={product.advancedLink.href}
                            prefetch={false}
                            className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
                          >
                            {product.advancedLink.label}
                          </Link>
                        )}
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
