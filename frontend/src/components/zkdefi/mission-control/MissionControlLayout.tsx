"use client";

import type { ReactNode } from "react";
import { HeaderStrip } from "./HeaderStrip";
import { ProofChainStrip } from "./ProofChainStrip";
import type { VaultTab } from "@/lib/agentState";

export type OverlayMode = "deploy" | "circuit-board" | "governance" | "brain" | "execution-pipeline" | null;

interface MissionControlLayoutProps {
  address: string | undefined;
  leftRail: ReactNode;
  centerStage: ReactNode;
  rightRail: ReactNode;
  overlay?: ReactNode;
  activeOverlay: OverlayMode;
  onOverlayChange: (mode: OverlayMode) => void;
  /** V2: pass deposit/withdraw to HeaderStrip */
  featureV2?: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
  /** Active nav mode for header nav pills */
  activeMode?: VaultTab;
  /** Called when a header nav pill is clicked */
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
  featureV2,
  onDeposit,
  onWithdraw,
  activeMode,
  onModeChange,
}: MissionControlLayoutProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <HeaderStrip
        address={address}
        activeOverlay={activeOverlay}
        onOverlayChange={onOverlayChange}
        featureV2={featureV2}
        onDeposit={onDeposit}
        onWithdraw={onWithdraw}
        activeMode={activeMode}
        onModeChange={onModeChange}
      />

      <ProofChainStrip />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Rail - Capital Ledger (legacy) / IntelligenceSidebar (V2) */}
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
        {activeOverlay !== "circuit-board" && activeOverlay !== "brain" && activeOverlay !== "execution-pipeline" && (
          <aside className="w-[280px] flex-shrink-0 border-l border-zinc-800 overflow-y-auto">
            {rightRail}
          </aside>
        )}
      </div>
    </div>
  );
}
