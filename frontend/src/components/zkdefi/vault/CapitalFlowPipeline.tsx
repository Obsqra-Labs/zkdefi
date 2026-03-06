"use client";

import { useState } from "react";
import { Wallet, Shield, Lock, BarChart3, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CapitalFlowPipelineProps {
  walletBalance: string;
  shieldedBalance: string;
  deployedBalance: string;
  idleBalance: string;
  activeNode?: "wallet" | "shield" | "vault" | "strategies";
}

type NodeId = "wallet" | "shield" | "vault" | "strategies";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBalance(value: string): string {
  const n = parseFloat(value || "0");
  return `${n.toFixed(2)} ETH`;
}

// Default strategies (matches PositionsOverview deployment pattern)
const DEFAULT_STRATEGIES = [
  { name: "Ekubo LP", yieldPct: 12.5 },
  { name: "Lending", yieldPct: 8.2 },
  { name: "Staking", yieldPct: 6.0 },
  { name: "Idle", yieldPct: 0 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CapitalFlowPipeline({
  walletBalance,
  shieldedBalance,
  deployedBalance,
  idleBalance,
  activeNode: controlledActiveNode,
}: CapitalFlowPipelineProps) {
  const [openDrawer, setOpenDrawer] = useState<NodeId | null>(
    controlledActiveNode ?? null,
  );

  const activeNode = controlledActiveNode ?? openDrawer;

  const nodes: { id: NodeId; label: string; icon: typeof Wallet; balance: string }[] = [
    { id: "wallet", label: "Wallet", icon: Wallet, balance: walletBalance },
    { id: "shield", label: "Shield", icon: Shield, balance: shieldedBalance },
    {
      id: "vault",
      label: "Vault",
      icon: Lock,
      balance: (parseFloat(deployedBalance) + parseFloat(idleBalance)).toFixed(2),
    },
    {
      id: "strategies",
      label: "Strategies",
      icon: BarChart3,
      balance: deployedBalance,
    },
  ];

  const handleNodeClick = (id: NodeId) => {
    setOpenDrawer((prev) => (prev === id ? null : id));
  };

  const totalDeployed = parseFloat(deployedBalance) + parseFloat(idleBalance);
  const allocationSummary = totalDeployed > 0
    ? [
        { label: "Deployed", value: deployedBalance, pct: (parseFloat(deployedBalance) / totalDeployed) * 100 },
        { label: "Idle", value: idleBalance, pct: (parseFloat(idleBalance) / totalDeployed) * 100 },
      ]
    : [];

  return (
    <div className="border border-white/10 rounded-xl bg-zinc-900/50 p-5 space-y-4">
      {/* Pipeline row: horizontal on desktop, vertical on mobile */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-center gap-0 md:gap-0">
        {nodes.map((node, idx) => (
          <div
            key={node.id}
            className="flex flex-col md:flex-row items-center md:flex-1"
          >
            <button
              type="button"
              onClick={() => handleNodeClick(node.id)}
              className={`
                flex flex-col items-center gap-1.5 w-full min-w-[80px] md:min-w-0 md:max-w-[120px] p-3 rounded-lg
                border transition-colors
                hover:bg-white/[0.04]
                ${activeNode === node.id
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-white/10 bg-white/[0.02]"
                }
              `}
            >
              <node.icon
                size={24}
                className={activeNode === node.id ? "text-blue-400" : "text-white/60"}
              />
              <span className="text-xs font-medium text-white/80">{node.label}</span>
              <span className="text-xs text-white/50 font-mono">
                {formatBalance(node.balance)}
              </span>
            </button>
            {idx < nodes.length - 1 && (
              <>
                <div className="hidden md:flex items-center px-1 flex-shrink-0">
                  <ChevronRight size={20} className="text-white/30" />
                </div>
                <div className="flex md:hidden justify-center py-1">
                  <ChevronRight size={16} className="text-white/30 rotate-90" />
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-zinc-500 text-center">
        Your capital is aggregated with others. Individual allocations are not traceable.
      </p>

      {/* Drawers (accordion) */}
      <div className="space-y-0">
        {openDrawer === "wallet" && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h4 className="text-xs font-semibold text-white/80 mb-2">Wallet</h4>
            {parseFloat(walletBalance) > 0 ? (
              <p className="text-sm text-white/60">
                Balance: <span className="font-mono text-white">{formatBalance(walletBalance)}</span>
              </p>
            ) : (
              <p className="text-sm text-white/40">
                Connect your wallet to see balance
              </p>
            )}
          </div>
        )}

        {openDrawer === "shield" && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h4 className="text-xs font-semibold text-white/80 mb-2">Shield</h4>
            <div className="space-y-2 text-sm">
              <p className="text-white/60">
                Privacy tier: <span className="text-white">Nullifier Set</span>
              </p>
              <p className="text-white/60">
                Deposit count: <span className="text-white font-mono">—</span>
              </p>
              <a
                href="#"
                className="inline-block text-blue-400 hover:text-blue-300 text-xs font-medium"
              >
                Withdraw →
              </a>
            </div>
          </div>
        )}

        {openDrawer === "vault" && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h4 className="text-xs font-semibold text-white/80 mb-2">Vault</h4>
            <p className="text-sm text-white/60 mb-3">
              Capital deployed across strategies
            </p>
            {allocationSummary.length > 0 ? (
              <div className="space-y-2">
                {allocationSummary.map((a) => (
                  <div key={a.label} className="flex items-center justify-between text-xs">
                    <span className="text-white/60">{a.label}</span>
                    <span className="text-white font-mono">
                      {formatBalance(a.value)} ({a.pct.toFixed(0)}%)
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/40">No capital deployed yet</p>
            )}
          </div>
        )}

        {openDrawer === "strategies" && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h4 className="text-xs font-semibold text-white/80 mb-2">Strategies</h4>
            <div className="space-y-2">
              {DEFAULT_STRATEGIES.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between text-sm py-1.5 border-b border-white/5 last:border-0"
                >
                  <span className="text-white/80">{s.name}</span>
                  <span className="text-emerald-400 font-mono text-xs">
                    {s.yieldPct > 0 ? `${s.yieldPct}% APY` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
