"use client";

import { useState, useEffect } from "react";
import { Activity } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { RiskProfileV2 } from "@/hooks/useProfile";
import { getExecutionGate } from "@/lib/trust/adapters";
import { isTrustSurfaceWiringEnabled } from "@/lib/trust/flags";
import { ConnectButton } from "../ConnectButton";
import type { OverlayModeV2 } from "@/lib/agentState";

interface HeaderStripProps {
  address: string | undefined;
  activeOverlay: OverlayModeV2;
  onOverlayChange: (mode: OverlayModeV2) => void;
}

interface AgentStatus {
  state: string;
  checks_completed?: number;
  actions_taken?: number;
}

export function HeaderStrip({ address, activeOverlay, onOverlayChange }: HeaderStripProps) {
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
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="zkde.fi" className="w-5 h-5 rounded object-contain" />
          <span className="font-semibold text-sm">zkde.fi</span>
        </a>
        <span className="text-zinc-600">/</span>
        <span className="text-zinc-400">Capital OS</span>
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

      {/* Right: Network + Tier + Shortcuts + Wallet */}
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
        <button
          onClick={() => onOverlayChange(activeOverlay === "circuit-board" ? null : "circuit-board")}
          className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "circuit-board" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          Design
        </button>
        <button
          onClick={() => onOverlayChange(activeOverlay === "brain" ? null : "brain")}
          className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "brain" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
        >
          Brain
        </button>
        <div className="w-px h-4 bg-zinc-700" />
        <ConnectButton />
      </div>
    </header>
  );
}
