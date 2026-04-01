"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Archive,
  ShieldCheck,
  Menu,
  X,
  Briefcase,
  Fingerprint,
} from "lucide-react";
import { ConnectButton } from "./ConnectButton";

const NAV_ITEMS = [
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/archive", label: "Archive", icon: Archive },
  { href: "/verify", label: "Verify", icon: ShieldCheck },
  { href: "/passport", label: "Passport", icon: Fingerprint },
] as const;

/**
 * Shared in-app navigation bar for authenticated pages.
 *
 * Renders a thin 40px strip consistent with HeaderStrip's design:
 * zinc-900 bg, zinc-800 border, xs text size.
 */
export function AppNavbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="h-10 flex-shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-4 flex items-center justify-between text-xs relative">
      {/* Left: Brand + nav links */}
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="font-semibold text-white tracking-tight mr-2"
        >
          zkde.fi
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                  active
                    ? "text-emerald-400 bg-zinc-800"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <Icon size={14} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="sm:hidden text-zinc-400 hover:text-zinc-200"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Right: Wallet connect */}
      <ConnectButton />

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="absolute top-10 left-0 right-0 z-50 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur-sm p-3 sm:hidden">
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname?.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${
                    active
                      ? "text-emerald-400 bg-zinc-800"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
