"use client";

import { useMemo, useState } from "react";
import { X, LineChart, Shield } from "lucide-react";
import { TradeDesk } from "@/components/zkdefi/TradeDesk";
import { EkuboPositionsList } from "@/components/zkdefi/EkuboPositionsList";
import { PrivacyPoolsPanel } from "./PrivacyPoolsPanel";

export type DeployMode =
  | "trade_desk"
  | "privacy_pools"
  | "swap"
  | "lp"
  | "lend"
  | "stake"
  | "dca"
  | "limits";

export interface DeployOverlayProps {
  address: string | undefined;
  onClose: () => void;
  initialMode?: DeployMode;
}

type TabMode = "trade_desk" | "privacy_pools" | "legacy";

const LEGACY_REQUEST_MODES = new Set<DeployMode>(["swap", "lp", "lend", "stake", "dca", "limits"]);
const LEGACY_FLAG_ENABLED = process.env.NEXT_PUBLIC_DEPLOY_LEGACY_TABS === "1";

function normalizeInitialMode(initialMode: DeployMode | undefined): TabMode {
  if (initialMode === "privacy_pools") return "privacy_pools";
  if (initialMode && LEGACY_REQUEST_MODES.has(initialMode) && LEGACY_FLAG_ENABLED) return "legacy";
  return "trade_desk";
}

export function DeployOverlay({ address, onClose, initialMode = "trade_desk" }: DeployOverlayProps) {
  const [mode, setMode] = useState<TabMode>(() => normalizeInitialMode(initialMode));

  const tabs = useMemo(
    () => [
      { id: "trade_desk" as const, label: "Trade Desk", icon: LineChart },
      { id: "privacy_pools" as const, label: "Privacy Pools", icon: Shield },
      ...(LEGACY_FLAG_ENABLED ? [{ id: "legacy" as const, label: "Legacy", icon: LineChart }] : []),
    ],
    []
  );

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  mode === tab.id
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex-shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {mode === "trade_desk" && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="min-h-0 flex-1">
              <TradeDesk userAddress={address} autoRefresh={true} showMemoryLane={true} />
            </div>
            <section className="border-t border-zinc-800 p-4 flex-shrink-0">
              <h3 className="text-sm font-medium text-zinc-300 mb-2">Ekubo LP positions</h3>
              <EkuboPositionsList ownerAddress={address} />
            </section>
          </div>
        )}
        {mode === "privacy_pools" && <PrivacyPoolsPanel address={address} />}
        {mode === "legacy" && (
          <div className="h-full p-6">
            <div className="max-w-xl rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-100">Legacy Deploy Tabs</h3>
              <p className="text-sm text-zinc-400">
                Legacy Swap/LP/Lend/Stake/DCA/Limits panels are now feature-flagged. Keep this mode only for
                migration fallback; Trade Desk and Privacy Pools are the canonical surfaces.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
