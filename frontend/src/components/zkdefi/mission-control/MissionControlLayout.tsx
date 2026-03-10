"use client";

import type { ReactNode } from "react";
import { HeaderStrip } from "./HeaderStrip";
import { ProofChainStrip } from "./ProofChainStrip";
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
      <HeaderStrip
        address={address}
        activeOverlay={activeOverlay}
        onOverlayChange={onOverlayChange}
        activeMode={activeMode}
        onModeChange={onModeChange}
      />

      <ProofChainStrip />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Rail - IdentityBadge */}
        <aside className="w-[300px] flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          {leftRail}
        </aside>

        {/* Center Stage - Tabs or Overlay */}
        <main className="flex-1 overflow-y-auto relative">
          {activeOverlay && overlay ? (
            <div className="absolute inset-0 z-20 bg-zinc-950">
              {overlay}
            </div>
          ) : (
            centerStage
          )}
        </main>

        {/* Right Rail - AgentControls */}
        {activeOverlay !== "circuit-board" && activeOverlay !== "brain" && (
          <aside className="w-[280px] flex-shrink-0 border-l border-zinc-800 overflow-y-auto">
            {rightRail}
          </aside>
        )}
      </div>
    </div>
  );
}
