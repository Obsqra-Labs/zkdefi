"use client";

import {
  LayoutDashboard,
  Droplets,
  Landmark,
  Vote,
  Activity,
  TrendingUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { VaultTab } from "@/lib/agentState";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { OverviewTab } from "@/components/zkdefi/tabs/OverviewTab";
import { MarketsTab } from "@/components/zkdefi/tabs/MarketsTab";
import { CapitalTab } from "@/components/zkdefi/tabs/CapitalTab";
import { LendTab } from "@/components/zkdefi/tabs/LendTab";
import { GovernTab } from "@/components/zkdefi/tabs/GovernTab";
import { ActivityTab } from "@/components/zkdefi/tabs/ActivityTab";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";

export interface VaultCenterStageProps {
  address: string;
  activeTab: VaultTab;
  onTabChange: (tab: VaultTab) => void;
  onSlideout: (mode: string, poolId?: string) => void;
  onDeploy?: (signal: any) => void;
  isDemo?: boolean;
  commitments?: VaultCommitment[];
  walletBalance?: string;
}

const TABS = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "markets" as const, label: "Markets", icon: TrendingUp },
  { id: "capital" as const, label: "Capital", icon: Droplets },
  { id: "lend" as const, label: "Lend", icon: Landmark },
  { id: "govern" as const, label: "Govern", icon: Vote },
  { id: "activity" as const, label: "Activity", icon: Activity },
];

export function VaultCenterStage({
  address,
  activeTab,
  onTabChange,
  onSlideout,
  onDeploy,
  isDemo,
  commitments,
  walletBalance,
}: VaultCenterStageProps) {
  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex-shrink-0 px-3 py-1.5 flex items-center gap-1 border-b border-zinc-800/60 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="p-0"
          >
            {activeTab === "overview" && (
              <ErrorBoundary>
                <OverviewTab address={address} isDemo={isDemo} commitments={commitments} walletBalance={walletBalance} onDeploy={onDeploy} />
              </ErrorBoundary>
            )}
            {activeTab === "markets" && (
              <ErrorBoundary>
                <MarketsTab onDeploy={onDeploy} />
              </ErrorBoundary>
            )}
            {activeTab === "capital" && (
              <ErrorBoundary>
                <CapitalTab address={address} onSlideout={onSlideout} isDemo={isDemo} commitments={commitments} />
              </ErrorBoundary>
            )}
            {activeTab === "lend" && (
              <ErrorBoundary>
                <LendTab address={address} />
              </ErrorBoundary>
            )}
            {activeTab === "govern" && (
              <ErrorBoundary>
                <GovernTab address={address} />
              </ErrorBoundary>
            )}
            {activeTab === "activity" && (
              <ErrorBoundary>
                <ActivityTab address={address} />
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
