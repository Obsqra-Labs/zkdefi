"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Store,
  Shield,
  User,
  Eye,
  Wallet,
} from "lucide-react";
import { ConnectButton } from "./ConnectButton";

const NAV_ITEMS = [
  { href: "/agent", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trade", label: "Trade", icon: ArrowLeftRight },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/lending", label: "Lending", icon: Wallet },
  { href: "/oracle", label: "Oracle", icon: Eye },
  { href: "/privacy", label: "Privacy", icon: Shield },
  { href: "/profile", label: "Profile", icon: User },
] as const;

/**
 * Shared in-app navigation bar for authenticated pages.
 *
 * Renders a thin 40px strip consistent with HeaderStrip's design:
 * zinc-900 bg, zinc-800 border, xs text size.
 */
export function AppNavbar() {
  const pathname = usePathname();

  return (
    <nav className="h-10 flex-shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-4 flex items-center justify-between text-xs">
      {/* Left: Brand + nav links */}
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="font-semibold text-white tracking-tight mr-2"
        >
          zkde.fi
        </Link>

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

      {/* Right: Wallet connect */}
      <ConnectButton />
    </nav>
  );
}
