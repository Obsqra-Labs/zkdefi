"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ProofChainStrip } from "./ProofChainStrip";
import { ConnectButton } from "../ConnectButton";
import type { OverlayModeV2, VaultTab } from "@/lib/agentState";

export type OverlayMode = OverlayModeV2;

interface MissionControlLayoutProps {
  address: string | undefined;
  leftRail: ReactNode;
  centerStage: ReactNode;
  rightRail: ReactNode;
  overlay?: ReactNode;
  activeOverlay: OverlayMode;
  onOverlayChange: (mode: OverlayMode) => void;
  activeMode?: VaultTab;
  onModeChange?: (mode: VaultTab) => void;
}

export function MissionControlLayout({
  address,
  leftRail,
  centerStage,
  rightRail,
  overlay,
  activeOverlay,
  onOverlayChange,
  activeMode,
  onModeChange,
}: MissionControlLayoutProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Minimal top strip: logo + wallet connect */}
      <div className="h-8 flex-shrink-0 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between px-3">
        <Link href="/" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="zkde.fi" className="h-6 w-6 rounded object-contain" />
        </Link>
        <ConnectButton />
      </div>

      <ProofChainStrip />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Rail - Capital Ledger */}
        <aside className="w-[300px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          {leftRail}
        </aside>

        {/* Center Stage - Stream or Overlay */}
        <main className="flex-1 overflow-y-auto relative">
          {activeOverlay && overlay ? (
            <div className="absolute inset-0 z-20 bg-zinc-950">
              {overlay}
            </div>
          ) : (
            centerStage
          )}
        </main>

        {/* Right Rail - Control Plane */}
        {activeOverlay !== "circuit-board" && activeOverlay !== "brain" && (
          <aside className="w-[280px] flex-shrink-0 border-l border-zinc-800 overflow-y-auto">
            {rightRail}
          </aside>
        )}
      </div>
    </div>
  );
}
