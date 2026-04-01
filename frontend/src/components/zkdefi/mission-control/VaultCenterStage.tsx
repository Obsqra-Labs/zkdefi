"use client";

import {
  LayoutDashboard,
  Droplets,
  Activity,
  TrendingUp,
  Settings,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { VaultTab } from "@/lib/agentState";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import type { SignalForExecution } from "@/components/zkdefi/mission-control/SignalExecutionDrawer";
import { OverviewTab } from "@/components/zkdefi/tabs/OverviewTab";
import { MarketsTab } from "@/components/zkdefi/tabs/MarketsTab";
import { CapitalTab } from "@/components/zkdefi/tabs/CapitalTab";
import { ActivityTab } from "@/components/zkdefi/tabs/ActivityTab";
import { SettingsTab } from "@/components/zkdefi/tabs/SettingsTab";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";

export interface VaultCenterStageProps {
  address: string;
  activeTab: VaultTab;
  onTabChange: (tab: VaultTab) => void;
  onSlideout: (mode: string, poolId?: string) => void;
  onDeploy?: (signal: SignalForExecution) => void;
  isDemo?: boolean;
  commitments?: VaultCommitment[];
  walletBalance?: string;
}

const TABS = [
  { id: "home" as const, label: "Home", icon: LayoutDashboard },
  { id: "plan" as const, label: "Plan", icon: TrendingUp },
  { id: "portfolio" as const, label: "Portfolio", icon: Droplets },
  { id: "history" as const, label: "History", icon: Activity },
  { id: "settings" as const, label: "Settings", icon: Settings },
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
            {activeTab === "home" && (
              <ErrorBoundary>
                <OverviewTab address={address} isDemo={isDemo} commitments={commitments} walletBalance={walletBalance} onDeploy={onDeploy} />
              </ErrorBoundary>
            )}
            {activeTab === "plan" && (
              <ErrorBoundary>
                <MarketsTab onDeploy={onDeploy} />
              </ErrorBoundary>
            )}
            {activeTab === "portfolio" && (
              <ErrorBoundary>
                <CapitalTab address={address} onSlideout={onSlideout} isDemo={isDemo} commitments={commitments} />
              </ErrorBoundary>
            )}
            {activeTab === "history" && (
              <ErrorBoundary>
                <ActivityTab address={address} />
              </ErrorBoundary>
            )}
            {activeTab === "settings" && (
              <ErrorBoundary>
                <SettingsTab address={address} />
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
