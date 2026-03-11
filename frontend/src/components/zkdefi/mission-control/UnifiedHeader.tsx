"use client";

/**
 * UnifiedHeader — Single 40px navigation + agent-status bar.
 *
 * Merges the former HeaderStrip (agent status, gate, tier, overlays, wallet)
 * with AppNavbar (in-app navigation links) into one slim header strip.
 *
 * Layout:
 *   [brand] [nav links…] │ [agent status] [gate] │ [tier] [overlays] [wallet]
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeftRight,
  Eye,
  LayoutDashboard,
  Lock,
  Menu,
  Shield,
  Store,
  TrendingUp,
  User,
  Wallet,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { RiskProfileV2 } from "@/hooks/useProfile";
import { getExecutionGate } from "@/lib/trust/adapters";
import { isTrustSurfaceWiringEnabled } from "@/lib/trust/flags";
import { ConnectButton } from "../ConnectButton";
import type { OverlayModeV2 } from "@/lib/agentState";

// ---------------------------------------------------------------------------
// Nav items (same set as AppNavbar)
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: "/agent", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trade", label: "Trade", icon: ArrowLeftRight },
  { href: "/marketplace", label: "Market", icon: Store },
  { href: "/lending", label: "Lending", icon: Wallet },
  { href: "/oracle", label: "Oracle", icon: Eye },
  { href: "/vault", label: "Vault", icon: Lock },
  { href: "/zkdefi/forecaster", label: "Forecaster", icon: TrendingUp },
  { href: "/profile", label: "Profile", icon: User },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UnifiedHeaderProps {
  address: string | undefined;
  activeOverlay: OverlayModeV2;
  onOverlayChange: (mode: OverlayModeV2) => void;
}

// ---------------------------------------------------------------------------
// Agent + gate data hooks
// ---------------------------------------------------------------------------

interface AgentStatus {
  state: string;
  checks_completed?: number;
  actions_taken?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnifiedHeader({ address, activeOverlay, onOverlayChange }: UnifiedHeaderProps) {
  const pathname = usePathname();
  const trustSurfaceWiringEnabled = isTrustSurfaceWiringEnabled();
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [gateStatus, setGateStatus] = useState<string>("--");
  const [tierData, setTierData] = useState<{ tier: number; tier_name: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    if (mobileMenuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileMenuOpen]);

  // Fetch agent status, gate status, tier data
  useEffect(() => {
    if (!address) return;

    apiFetch<any>(`/api/v1/zkdefi/rebalancer/autonomous/status/${address}`)
      .then((d) => setAgentStatus(d))
      .catch(() => setAgentStatus({ state: "offline" }));

    apiFetch<RiskProfileV2>(`/api/v1/zkdefi/risk_profile/v2/${address}`)
      .then((d) => {
        const tier = Number(d?.reputation?.tier ?? 0);
        const tierName = String(d?.reputation?.tier_name ?? "Strict");
        setTierData({ tier, tier_name: tierName });

        if (trustSurfaceWiringEnabled) {
          const execGate = getExecutionGate(d);
          if (execGate.mode === "block") setGateStatus("PAUSED");
          else if (execGate.mode === "allow") setGateStatus("PASS");
          else setGateStatus("READY");
        } else {
          setGateStatus("READY");
        }
      })
      .catch(() => {
        apiFetch<any>(`/api/v1/zkdefi/mc/execution/current/${address}`)
          .then((d) => {
            const exec = d?.steps?.execution;
            if (exec?.emergency_pause) setGateStatus("PAUSED");
            else if (exec?.status === "complete") setGateStatus("PASS");
            else setGateStatus("READY");
          })
          .catch(() => setGateStatus("--"));

        apiFetch<any>(`/api/v1/zkdefi/reputation/user/${address}`)
          .then((d) => {
            const tier = Number(d?.tier ?? d?.current_tier ?? 0);
            const tierName = String(d?.tier_name ?? `Tier ${tier}`);
            setTierData({ tier, tier_name: tierName });
          })
          .catch(() => {});
      });
  }, [address, trustSurfaceWiringEnabled]);

  const agentId =
    agentStatus?.state === "monitoring" || agentStatus?.state === "running"
      ? "STRC-8004"
      : "No Agent";

  const gateColor =
    gateStatus === "PASS"
      ? "text-emerald-400"
      : gateStatus === "PAUSED"
        ? "text-red-400"
        : "text-zinc-400";

  return (
    <header className="h-10 flex-shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-3 flex items-center justify-between text-xs relative z-30">
      {/* ── Left: Brand + Nav links (desktop) / hamburger (mobile) ── */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity shrink-0">
          <div className="w-5 h-5 rounded bg-emerald-600 flex items-center justify-center">
            <Shield className="w-3 h-3 text-white" />
          </div>
          <span className="font-semibold text-sm text-white hidden sm:inline">zkde.fi</span>
        </Link>

        <span className="text-zinc-700 hidden sm:inline">/</span>

        {/* Nav links — hidden below md, scrollable row on md+ */}
        <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto scrollbar-none">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1 px-2 py-1 rounded transition-colors whitespace-nowrap ${
                  active
                    ? "text-emerald-400 bg-zinc-800"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <Icon size={12} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      {/* ── Center: Agent + Gate (hidden on small screens) ── */}
      <div className="hidden lg:flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-zinc-500" />
          <span className="text-zinc-300">{agentId}</span>
        </div>
        <div className="w-px h-4 bg-zinc-700" />
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">Gate:</span>
          <span className={`font-medium ${gateColor}`}>{gateStatus}</span>
        </div>
      </div>

      {/* ── Right: Network + Tier + Overlays + Wallet ── */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-zinc-600 hidden sm:inline">Sepolia</span>
        {tierData && (
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium hidden sm:inline ${
              tierData.tier === 0
                ? "bg-zinc-700 text-zinc-300"
                : tierData.tier === 1
                  ? "bg-emerald-900/50 text-emerald-400"
                  : "bg-amber-900/50 text-amber-400"
            }`}
          >
            {tierData.tier_name}
          </span>
        )}
        <div className="w-px h-4 bg-zinc-700 hidden sm:block" />
        <button
          onClick={() =>
            onOverlayChange(activeOverlay === "circuit-board" ? null : "circuit-board")
          }
          className={`px-2 py-0.5 rounded transition-colors ${
            activeOverlay === "circuit-board"
              ? "bg-violet-600 text-white"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          Design
        </button>
        <button
          onClick={() =>
            onOverlayChange(activeOverlay === "brain" ? null : "brain")
          }
          className={`px-2 py-0.5 rounded transition-colors ${
            activeOverlay === "brain"
              ? "bg-indigo-600 text-white"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          Brain
        </button>
        <div className="w-px h-4 bg-zinc-700" />
        <ConnectButton />
      </div>

      {/* ── Mobile dropdown ── */}
      {mobileMenuOpen && (
        <div
          ref={menuRef}
          className="absolute top-10 left-0 right-0 bg-zinc-900 border-b border-zinc-800 shadow-xl md:hidden z-50"
        >
          <nav className="flex flex-col py-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname?.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    active
                      ? "text-emerald-400 bg-zinc-800/60"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  }`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
          {/* Agent + gate in mobile menu */}
          <div className="flex items-center gap-3 px-4 py-2 border-t border-zinc-800/60 text-xs">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-zinc-500" />
              <span className="text-zinc-300">{agentId}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Gate:</span>
              <span className={`font-medium ${gateColor}`}>{gateStatus}</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
