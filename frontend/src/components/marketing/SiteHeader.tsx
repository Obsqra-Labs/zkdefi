"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, Menu, Shield, X } from "lucide-react";
import { useMemo, useState } from "react";

import { PRODUCT_CATEGORIES, PRODUCTS_BY_CATEGORY } from "@/lib/products/catalog";
import { ProductStatus } from "@/lib/products/types";

interface SiteHeaderProps {
  compact?: boolean;
}

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

export function SiteHeader({ compact = false }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const groupedProducts = useMemo(
    () =>
      PRODUCT_CATEGORIES.map((category) => ({
        category,
        products: PRODUCTS_BY_CATEGORY[category.id] || [],
      })),
    [],
  );

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 px-6 py-4 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-90">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold">zkde.fi</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <div className="group relative">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm text-zinc-300 transition-colors hover:text-white"
              aria-haspopup="menu"
            >
              Products
              <ChevronDown className="h-4 w-4" />
            </button>

            <div className="absolute left-0 top-full mt-3 hidden w-[820px] rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-xl group-hover:block">
              <div className="grid grid-cols-2 gap-3">
                {groupedProducts.map(({ category, products }) => (
                  <div key={category.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                        {category.title}
                      </p>
                      <span className="text-[11px] text-zinc-500">{products.length}</span>
                    </div>
                    <div className="space-y-1">
                      {products.map((item) => (
                        <Link
                          key={item.slug}
                          href={`/products/${item.slug}`}
                          prefetch={false}
                          className="block rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-900"
                        >
                          <div className="mb-0.5 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-zinc-200">{item.title}</span>
                            <StatusChip status={item.status} />
                          </div>
                          <p className="line-clamp-1 text-[11px] text-zinc-500">{item.summary}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Link
            href="/docs/developers"
            prefetch={false}
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            Developers
          </Link>
          <Link
            href="/docs"
            prefetch={false}
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            Docs
          </Link>
          <a
            href="https://starknet.obsqra.fi/forge"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            Proof Chain
          </a>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {!compact && (
            <Link
              href="/products"
              prefetch={false}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium transition-colors hover:border-emerald-500/40"
            >
              All Products
            </Link>
          )}
          <Link
            href="/agent"
            prefetch={false}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 font-medium transition-all hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20"
          >
            Launch App
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <button
          type="button"
          className="p-2 text-zinc-300 hover:text-white md:hidden"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="mx-auto mt-3 max-w-7xl space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 md:hidden">
          {groupedProducts.map(({ category, products }) => (
            <div key={category.id}>
              <p className="mb-1 px-1 text-[11px] uppercase tracking-wide text-zinc-500">{category.title}</p>
              <div className="space-y-1">
                {products.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/products/${item.slug}`}
                    prefetch={false}
                    onClick={() => setMobileOpen(false)}
                    className="block rounded-lg px-3 py-2 hover:bg-zinc-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-200">{item.title}</span>
                      <StatusChip status={item.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 pt-2">
            <Link
              href="/docs"
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              Docs
            </Link>
            <Link
              href="/docs/developers"
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              Developers
            </Link>
            <Link
              href="/products"
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              All Products
            </Link>
            <Link
              href="/agent"
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-emerald-300 hover:bg-zinc-900 hover:text-emerald-200"
            >
              Launch App
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
