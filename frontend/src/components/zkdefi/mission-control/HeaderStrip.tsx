"use client";

import { useState, useEffect } from "react";
import { Shield, Activity } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { RiskProfileV2 } from "@/hooks/useProfile";
import { getExecutionGate } from "@/lib/trust/adapters";
import { isTrustSurfaceWiringEnabled } from "@/lib/trust/flags";
import { ConnectButton } from "../ConnectButton";
import type { OverlayMode } from "./MissionControlLayout";
import type { VaultTab } from "@/lib/agentState";

const NAV_ITEMS = [
  { id: "overview", label: "Dashboard" },
  { id: "trade", label: "Trade" },
  { id: "pools", label: "Vault" },
  { id: "oracle", label: "Oracle" },
  { id: "lending", label: "Lending" },
  { id: "marketplace", label: "Marketplace" },
] as const;

interface HeaderStripProps {
  address: string | undefined;
  activeOverlay: OverlayMode;
  onOverlayChange: (mode: OverlayMode) => void;
  /** V2: show Fund/Withdraw actions in header */
  featureV2?: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
  /** Active nav mode (maps to VaultTab) */
  activeMode?: VaultTab;
  /** Called when a nav pill is clicked */
  onModeChange?: (mode: VaultTab) => void;
}

interface AgentStatus {
  state: string;
  checks_completed?: number;
  actions_taken?: number;
}

export function HeaderStrip({ address, activeOverlay, onOverlayChange, featureV2, onDeposit, onWithdraw, activeMode, onModeChange }: HeaderStripProps) {
  const trustSurfaceWiringEnabled = isTrustSurfaceWiringEnabled();
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [gateStatus, setGateStatus] = useState<string>("--");
  const [tierData, setTierData] = useState<{ tier: number; tier_name: string } | null>(null);

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

  const agentId = agentStatus?.state === "monitoring" || agentStatus?.state === "running"
    ? "STRC-8004"
    : "No Agent";

  const gateColor = gateStatus === "PASS" ? "text-emerald-400" : gateStatus === "PAUSED" ? "text-red-400" : "text-zinc-400";

  return (
    <header className="h-10 flex-shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-4 flex items-center justify-between text-xs">
      {/* Left: Brand + Nav */}
      <div className="flex items-center gap-3">
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-5 h-5 rounded bg-emerald-600 flex items-center justify-center">
            <Shield className="w-3 h-3 text-white" />
          </div>
          <span className="font-semibold text-sm">zkde.fi</span>
        </a>
        <span className="text-zinc-600">/</span>
        <span className="text-zinc-400">Capital OS</span>

        {onModeChange && (
          <>
            <div className="w-px h-4 bg-zinc-700" />
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onModeChange(item.id as VaultTab)}
                  className={`px-2.5 py-0.5 rounded-full transition-colors font-medium ${
                    activeMode === item.id
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>

      {/* Center: Agent + Gate */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-zinc-500" />
          <span className="text-zinc-300">{agentId}</span>
        </div>
        <div className="w-px h-4 bg-zinc-700" />
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Gate:</span>
          <span className={`font-medium ${gateColor}`}>{gateStatus}</span>
        </div>
      </div>

      {/* Right: Network + Tier + V2 Actions + Shortcuts + Wallet */}
      <div className="flex items-center gap-3">
        <span className="text-zinc-500">Sepolia</span>
        {tierData && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            tierData.tier === 0 ? "bg-zinc-700 text-zinc-300" :
            tierData.tier === 1 ? "bg-emerald-900/50 text-emerald-400" :
            "bg-amber-900/50 text-amber-400"
          }`}>
            {tierData.tier_name}
          </span>
        )}
        <div className="w-px h-4 bg-zinc-700" />
        {featureV2 && (
          <>
            <button
              onClick={onDeposit}
              className="px-2 py-0.5 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30 transition-colors font-medium"
            >
              Fund
            </button>
            <button
              onClick={onWithdraw}
              className="px-2 py-0.5 rounded text-amber-400 hover:text-amber-300 hover:bg-amber-900/30 transition-colors font-medium"
            >
              Withdraw
            </button>
            <div className="w-px h-4 bg-zinc-700" />
          </>
        )}
        <button
          onClick={() => onOverlayChange(activeOverlay === "deploy" ? null : "deploy")}
          className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "deploy" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          Deploy
        </button>
        <button
          onClick={() => onOverlayChange(activeOverlay === "circuit-board" ? null : "circuit-board")}
          className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "circuit-board" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          Design
        </button>
        <button
          onClick={() => onOverlayChange(activeOverlay === "governance" ? null : "governance")}
          className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "governance" ? "bg-cyan-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          Govern
        </button>
        <button
          onClick={() => onOverlayChange(activeOverlay === "brain" ? null : "brain")}
          className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "brain" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          Brain
        </button>
        {featureV2 && (
          <button
            onClick={() => onOverlayChange(activeOverlay === "execution-pipeline" ? null : "execution-pipeline")}
            className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "execution-pipeline" ? "bg-rose-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
          >
            Pipeline
          </button>
        )}
        <div className="w-px h-4 bg-zinc-700" />
        <ConnectButton />
      </div>
    </header>
  );
}
