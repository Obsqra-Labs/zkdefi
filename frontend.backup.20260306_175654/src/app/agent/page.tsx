"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { Shield } from "lucide-react";
import {
  MissionControlLayout,
  type OverlayMode,
  CapitalLedger,
  ControlPlane,
  UnifiedStream,
} from "@/components/zkdefi/mission-control";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { OnboardingWizard } from "@/components/zkdefi/OnboardingWizard";

export default function AgentPage() {
  const { address, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<OverlayMode>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && isConnected && address) {
      const onboarded = localStorage.getItem(`zkdefi_onboarded_${address}`);
      if (!onboarded) setShowOnboarding(true);
    }
  }, [mounted, isConnected, address]);

  const handleOnboardingComplete = useCallback(() => {
    if (address) localStorage.setItem(`zkdefi_onboarded_${address}`, "true");
    setShowOnboarding(false);
  }, [address]);

  const handleDeploy = useCallback((_opportunityId?: string) => {
    setActiveOverlay("deploy");
  }, []);

  const handleOpenGovernance = useCallback(() => {
    setActiveOverlay("governance");
  }, []);

  const handleOpenCircuitBoard = useCallback(() => {
    setActiveOverlay("circuit-board");
  }, []);

  if (!mounted || (!isConnected && !walletSettled)) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (showOnboarding && isConnected) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4">
        <Shield className="w-16 h-16 text-zinc-600" />
        <h2 className="text-2xl font-bold text-white">Connect Wallet</h2>
        <p className="text-zinc-400">Connect your wallet to access Capital OS</p>
        <ConnectButton />
      </div>
    );
  }

  // Build overlay content based on activeOverlay
  let overlayContent: React.ReactNode = null;
  if (activeOverlay === "deploy") {
    overlayContent = (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">Deploy Capital</h2>
          <button
            onClick={() => setActiveOverlay(null)}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Close
          </button>
        </div>
        <div className="flex-1 p-4 text-zinc-400 text-sm">
          <p>Deploy overlay — Swap, LP, Lend/Borrow, Stake, DCA, Limits</p>
          <p className="mt-2 text-zinc-500">Full implementation in B4.</p>
        </div>
      </div>
    );
  } else if (activeOverlay === "circuit-board") {
    overlayContent = (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">Circuit Board</h2>
          <button
            onClick={() => setActiveOverlay(null)}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Close
          </button>
        </div>
        <div className="flex-1 p-4 text-zinc-400 text-sm">
          <p>Circuit Board — deterministic policy composer</p>
          <p className="mt-2 text-zinc-500">Full implementation in B5.</p>
        </div>
      </div>
    );
  } else if (activeOverlay === "governance") {
    overlayContent = (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">Governance</h2>
          <button
            onClick={() => setActiveOverlay(null)}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Close
          </button>
        </div>
        <div className="flex-1 p-4 text-zinc-400 text-sm">
          <p>Governance — proposals, ZK voting, DAO lending</p>
          <p className="mt-2 text-zinc-500">Full implementation in B6.</p>
        </div>
      </div>
    );
  }

  return (
    <MissionControlLayout
      address={address}
      activeOverlay={activeOverlay}
      onOverlayChange={setActiveOverlay}
      leftRail={
        <CapitalLedger
          address={address}
          onDeposit={() => {/* deposit slideout - future */}}
          onWithdraw={() => {/* withdraw slideout - future */}}
        />
      }
      centerStage={
        <UnifiedStream
          address={address}
          onDeploy={handleDeploy}
          onOpenGovernance={handleOpenGovernance}
          onOpenCircuitBoard={handleOpenCircuitBoard}
        />
      }
      rightRail={
        <ControlPlane
          address={address}
          onOpenCircuitBoard={handleOpenCircuitBoard}
        />
      }
      overlay={overlayContent}
    />
  );
}
