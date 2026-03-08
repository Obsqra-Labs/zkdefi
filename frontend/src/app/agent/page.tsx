"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { Shield, X } from "lucide-react";
import {
  MissionControlLayout,
  type OverlayMode,
  CapitalLedger,
  ControlPlane,
  CircuitBoard,
} from "@/components/zkdefi/mission-control";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { OnboardingWizard } from "@/components/zkdefi/OnboardingWizard";
import { usePrivacyVault } from "@/hooks/usePrivacyVault";
import { DepositPanel } from "@/components/zkdefi/vault/DepositPanel";
import { WithdrawPanel } from "@/components/zkdefi/vault/WithdrawPanel";
import { FullPrivacyPoolPanel } from "@/components/zkdefi/FullPrivacyPoolPanel";
import { ShieldedPoolPanel } from "@/components/zkdefi/ShieldedPoolPanel";
import { ZkRagAgentConsole } from "@/components/zkdefi/ZkRagAgentConsole";
import { BrainVisualizer } from "@/components/zkdefi/BrainVisualizer";
import { DeployOverlay } from "@/components/zkdefi/mission-control/DeployOverlay";
import { GovernanceOverlay } from "@/components/zkdefi/mission-control/GovernanceOverlay";
import { CenterStageModes } from "@/components/zkdefi/mission-control/CenterStageModes";
import {
  AgentBuilderDrawer,
  type AgentBuilderDraft,
} from "@/components/zkdefi/mission-control/AgentBuilderDrawer";

type SlideoutMode = null | "deposit" | "withdraw" | "privacy" | "shielded" | "zkrag" | "agent-builder";

export default function AgentPage() {
  const { address, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<OverlayMode>(null);
  const [slideout, setSlideout] = useState<SlideoutMode>(null);
  const [agentBuilderDraft, setAgentBuilderDraft] = useState<AgentBuilderDraft | null>(null);

  const vault = usePrivacyVault(address);

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

  const handleOpenCircuitBoard = useCallback(() => {
    setActiveOverlay("circuit-board");
  }, []);

  const handleOpenAgentBuilder = useCallback((draft: AgentBuilderDraft) => {
    setAgentBuilderDraft(draft);
    setSlideout("agent-builder");
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

  let overlayContent: React.ReactNode = null;
  if (activeOverlay === "deploy") {
    overlayContent = (
      <DeployOverlay
        address={address}
        onClose={() => setActiveOverlay(null)}
      />
    );
  } else if (activeOverlay === "circuit-board") {
    overlayContent = (
      <CircuitBoard
        address={address}
        onOpenAgentBuilder={handleOpenAgentBuilder}
        onClose={() => setActiveOverlay(null)}
      />
    );
  } else if (activeOverlay === "brain") {
    overlayContent = (
      <div className="flex h-full flex-col bg-zinc-950">
        <header className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4">
          <span className="font-semibold text-sm text-zinc-100">Brain -- zkML Check</span>
          <button
            onClick={() => setActiveOverlay(null)}
            className="flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700 text-zinc-200"
          >
            <X className="w-3 h-3" /> Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {address && <BrainVisualizer userAddress={address} />}
        </div>
      </div>
    );
  } else if (activeOverlay === "governance") {
    overlayContent = (
      <GovernanceOverlay
        address={address}
        onClose={() => setActiveOverlay(null)}
      />
    );
  }

  return (
    <>
      <MissionControlLayout
        address={address}
        activeOverlay={activeOverlay}
        onOverlayChange={setActiveOverlay}
        leftRail={
          <CapitalLedger
            address={address}
            onDeposit={() => setSlideout("deposit")}
            onWithdraw={() => setSlideout("withdraw")}
            onImportDarkLedger={() => setSlideout("privacy")}
          />
        }
        centerStage={
          <CenterStageModes
            address={address}
            onDeploy={() => setActiveOverlay("deploy")}
            onOpenGovernance={() => setActiveOverlay("governance")}
            onOpenCircuitBoard={() => setActiveOverlay("circuit-board")}
            onOpenZkRag={() => setSlideout("zkrag")}
          />
        }
        rightRail={
          <ControlPlane
            address={address}
            onOpenCircuitBoard={handleOpenCircuitBoard}
            onOpenBrain={() => setActiveOverlay("brain")}
            onOpenZkRag={() => setSlideout("zkrag")}
          />
        }
        overlay={overlayContent}
      />

      {slideout && (
        <div className="fixed inset-0 z-[60] flex">
          <div
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setSlideout(null)}
          />
          <div className={`w-full ${slideout === "zkrag" || slideout === "agent-builder" ? "max-w-2xl" : "max-w-lg"} bg-zinc-950 border-l border-zinc-800 overflow-y-auto p-6 animate-in slide-in-from-right`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">
                {slideout === "deposit" && "Deposit"}
                {slideout === "withdraw" && "Withdraw"}
                {slideout === "privacy" && "Full Privacy Pool"}
                {slideout === "shielded" && "Shielded Pool"}
                {slideout === "zkrag" && "zkRAG Intelligence"}
                {slideout === "agent-builder" && "Agent Builder"}
              </h2>
              <button
                onClick={() => setSlideout(null)}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {slideout === "deposit" && (
              <DepositPanel
                method={vault.method}
                setMethod={vault.setMethod}
                depositSteps={vault.depositSteps}
                setDepositSteps={vault.setDepositSteps}
                addCommitment={vault.addCommitment}
                address={address}
              />
            )}
            {slideout === "withdraw" && (
              <WithdrawPanel
                method={vault.method}
                setMethod={vault.setMethod}
                commitments={vault.commitments}
                removeCommitment={vault.removeCommitment}
                withdrawSteps={vault.withdrawSteps}
                setWithdrawSteps={vault.setWithdrawSteps}
                address={address}
              />
            )}
            {slideout === "privacy" && <FullPrivacyPoolPanel />}
            {slideout === "shielded" && <ShieldedPoolPanel />}
            {slideout === "zkrag" && address && <ZkRagAgentConsole userAddress={address} />}
            {slideout === "agent-builder" && address && (
              <AgentBuilderDrawer userAddress={address} draft={agentBuilderDraft} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
