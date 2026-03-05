"use client";

import { useState, useEffect } from "react";
import { Info, PauseCircle, AlertTriangle, X } from "lucide-react";

export interface VaultBannerProps {
  vaultState: "ACTIVE" | "COOLDOWN" | "PENDING_REBALANCE" | "PAUSED" | "EMERGENCY";
  degradedAdapter?: string;
}

type BannerConfig = {
  icon: React.ReactNode;
  message: string;
  className: string;
  severity: "info" | "warning" | "error";
} | null;

export function VaultBanner({ vaultState, degradedAdapter }: VaultBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Reset dismissed state when vaultState changes
  useEffect(() => {
    setDismissed(false);
  }, [vaultState]);

  const getBanner = (): BannerConfig => {
    if (dismissed) return null;
    if (degradedAdapter) {
      return {
        icon: <AlertTriangle className="w-4 h-4 shrink-0" />,
        message: "Strategy health degraded — rebalancing when cooldown ends",
        className: "bg-amber-500/10 border-amber-500/30 text-amber-400",
        severity: "warning",
      };
    }
    switch (vaultState) {
      case "ACTIVE":
      case "COOLDOWN":
        return null;
      case "PENDING_REBALANCE":
        return {
          icon: <Info className="w-4 h-4 shrink-0" />,
          message: "Rebalance pending... protected from front-running",
          className: "bg-blue-500/10 border-blue-500/30 text-blue-400",
          severity: "info",
        };
      case "PAUSED":
        return {
          icon: <PauseCircle className="w-4 h-4 shrink-0" />,
          message: "Rebalance blocked — your constitution prevents the required move",
          className: "bg-zinc-500/10 border-zinc-500/30 text-zinc-400",
          severity: "info",
        };
      case "EMERGENCY":
        return {
          icon: <AlertTriangle className="w-4 h-4 shrink-0" />,
          message: "Emergency: capital returning to vault",
          className: "bg-red-500/10 border-red-500/30 text-red-400",
          severity: "error",
        };
      default:
        return null;
    }
  };

  const banner = getBanner();
  if (!banner) return null;

  return (
    <div
      role={banner.severity === "error" ? "alert" : "status"}
      aria-live={banner.severity === "error" ? "assertive" : "polite"}
      className={`flex items-center justify-between gap-3 w-full rounded-lg border px-4 py-2.5 transition-all duration-300 ${
        mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      } ${banner.className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {banner.icon}
        <span className="text-sm font-medium break-words sm:truncate">{banner.message}</span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
        aria-label="Dismiss banner"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
