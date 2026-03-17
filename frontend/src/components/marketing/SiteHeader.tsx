"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ExternalLink, Menu, X } from "lucide-react";
import { useState, useEffect } from "react";

interface SiteHeaderProps {
  compact?: boolean;
}

export function SiteHeader({ compact = false }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-50 border-b bg-zinc-950/90 px-6 py-4 backdrop-blur-sm transition-[border-color,box-shadow] duration-300 ${
      scrolled
        ? "border-zinc-700/50 shadow-lg shadow-black/20"
        : "border-zinc-800/50"
    }`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-90">
          <Image src="/logo.png" alt="zkde.fi" width={32} height={32} className="rounded-lg object-contain" priority />
          <span className="font-serif text-lg font-bold tracking-tight">zkde.fi</span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-6 md:flex">
          <a
            href="/#capital-os"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            The Loop
          </a>
          <a
            href="/test"
            className="text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
          >
            Live Proof
          </a>
          <Link
            href="/docs"
            prefetch={false}
            className="text-sm text-zinc-400 transition-colors hover:text-white"
          >
            Docs
          </Link>
          <a
            href="https://github.com/Obsqra-Labs/zkdefi"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            GitHub
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">(opens in new tab)</span>
          </a>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/agent"
            prefetch={false}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 font-medium transition-all hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20"
          >
            Launch App
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <button
          type="button"
          className="p-2 text-zinc-300 hover:text-white md:hidden"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <nav aria-label="Mobile navigation" className="mx-auto mt-3 max-w-7xl space-y-1 rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 md:hidden">
          <a
            href="/#capital-os"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
          >
            The Loop
          </a>
          <a
            href="/test"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm font-medium text-emerald-400 hover:bg-zinc-900"
          >
            Live Proof
          </a>
          <Link
            href="/docs"
            prefetch={false}
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
          >
            Docs
          </Link>
          <a
            href="https://github.com/Obsqra-Labs/zkdefi"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
          >
            GitHub
          </a>
          <div className="border-t border-zinc-800 pt-2">
            <Link
              href="/agent"
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-emerald-300 hover:bg-zinc-900 hover:text-emerald-200"
            >
              Launch App →
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
