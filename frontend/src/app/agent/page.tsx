"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import { useSearchParams } from "next/navigation";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { useRiskProfileV2 } from "@/hooks/useProfile";
import { toast } from "@/lib/toast";
import { Shield, X, ChevronDown, ChevronRight } from "lucide-react";
import { trackEvent } from "@/lib/telemetry";
import {
  MissionControlLayout,
  type OverlayMode,
  CircuitBoard,
} from "@/components/zkdefi/mission-control";
import { VaultCenterStage } from "@/components/zkdefi/mission-control/VaultCenterStage";
import { IdentityBadge } from "@/components/zkdefi/mission-control/IdentityBadge";
import { AgentControls } from "@/components/zkdefi/mission-control/AgentControls";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { OnboardingWizard } from "@/components/zkdefi/OnboardingWizard";
import {
  isOnboardingComplete,
  markOnboardingComplete,
  migrateLegacyOnboardingState,
} from "@/lib/trust/onboardingState";
import { useTrustFlowState } from "@/lib/trust/useTrustFlowState";
import { usePrivacyVault } from "@/hooks/usePrivacyVault";
import { useVaultV2 } from "@/hooks/useVaultV2";
import { DepositPanel } from "@/components/zkdefi/vault/DepositPanel";
import { FundVaultPanel } from "@/components/zkdefi/vault/FundVaultPanel";

import { WithdrawPanel } from "@/components/zkdefi/vault/WithdrawPanel";
import { FullPrivacyPoolPanel } from "@/components/zkdefi/FullPrivacyPoolPanel";
import { ShieldedPoolPanel } from "@/components/zkdefi/ShieldedPoolPanel";
import { ZkRagAgentConsole } from "@/components/zkdefi/ZkRagAgentConsole";
import { BrainVisualizer } from "@/components/zkdefi/BrainVisualizer";
import {
  AgentBuilderDrawer,
  type AgentBuilderDraft,
} from "@/components/zkdefi/mission-control/AgentBuilderDrawer";
import {
  SignalExecutionDrawer,
  type SignalForExecution,
} from "@/components/zkdefi/mission-control/SignalExecutionDrawer";
import {
  resolveViewParamV2,
  resolveViewOverlayV2,
  buildAgentUrl,
  type VaultTab,
  type SlideoutModeV2,
  type OverlayModeV2,
} from "@/lib/agentState";

const GUEST_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";

export default function AgentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <AgentPageInner />
    </Suspense>
  );
}

function AgentPageInner() {
  const { address: walletAddress, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<OverlayModeV2>(null);
  const [slideout, setSlideout] = useState<SlideoutModeV2>(null);
  const [slideoutPool, setSlideoutPool] = useState<string | undefined>(undefined);
  const [agentBuilderDraft, setAgentBuilderDraft] = useState<AgentBuilderDraft | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<SignalForExecution | null>(null);
  const showAdvancedPrivacyRails = process.env.NEXT_PUBLIC_ENABLE_ADVANCED_PRIVACY_RAILS === "1";

  const isGuest = guestMode && !isConnected;
  const address = isGuest ? GUEST_ADDRESS : walletAddress;
  const effectiveConnected = isConnected || isGuest;

  const { profile: profileV2 } = useRiskProfileV2(address);
  const trustFlow = useTrustFlowState(profileV2, address);

  const vault = usePrivacyVault(address);
  const v2 = useVaultV2(address);

  const resolvedV2 = resolveViewParamV2(searchParams.get("v"), searchParams.get("t"));
  const resolvedV2Overlay = resolveViewOverlayV2(searchParams.get("v"));
  const [vaultTab, setVaultTab] = useState<VaultTab>(resolvedV2.vaultTab ?? "home");

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("guest") === "1" || params.get("preview") === "1") {
        setGuestMode(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (resolvedV2Overlay.overlay) setActiveOverlay(resolvedV2Overlay.overlay as OverlayModeV2);
    if (resolvedV2Overlay.slideout) setSlideout(resolvedV2Overlay.slideout as SlideoutModeV2);
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVaultTabChange = useCallback((tab: VaultTab) => {
    setVaultTab((prev) => {
      trackEvent("vault_tab_change", { tab, from: prev });
      return tab;
    });
    if (typeof window !== "undefined") {
      const url = buildAgentUrl("vault", tab);
      window.history.replaceState(null, "", url);
    }
  }, []);

  const handleModeChange = useCallback((mode: VaultTab) => {
    setActiveOverlay(null);
    handleVaultTabChange(mode);
  }, [handleVaultTabChange]);

  useEffect(() => {
    if (!mounted || !isConnected || !walletAddress || isGuest) {
      setShowOnboarding(false);
      return;
    }

    migrateLegacyOnboardingState(walletAddress);
    const completed = isOnboardingComplete(walletAddress);
    if (trustFlow.readyForAgent && !completed) {
      markOnboardingComplete(walletAddress, "trust_flow_ready");
      setShowOnboarding(false);
      return;
    }

    setShowOnboarding(!completed);
  }, [mounted, isConnected, walletAddress, isGuest, trustFlow.readyForAgent]);

  const handleOnboardingComplete = useCallback(() => {
    if (walletAddress) markOnboardingComplete(walletAddress, "onboarding_wizard");
    setShowOnboarding(false);
  }, [walletAddress]);

  const handleOpenAgentBuilder = useCallback((draft: AgentBuilderDraft) => {
    trackEvent("slideout_open", { slideout: "agent-builder" });
    setAgentBuilderDraft(draft);
    setSlideout("agent-builder");
  }, []);

  const handleDeploy = useCallback((signal: SignalForExecution) => {
    trackEvent("slideout_open", { slideout: "execute", signal: signal.id });
    setSelectedSignal(signal);
    setSlideout("execute");
  }, []);

  const handlePostDepositHandoff = useCallback((payload: {
    amount: string;
    asset: "STRK" | "ETH" | "strkBTC";
    txHash: string;
    mode: "fund" | "deposit";
    pool?: "conservative" | "moderate" | "aggressive";
    expectedApy?: number;
  }) => {
    const poolMeta = payload.pool
      ? {
          conservative: { venue: "lending", risk: 30, apy: 5.5 },
          moderate: { venue: "ekubo", risk: 55, apy: 8.5 },
          aggressive: { venue: "ekubo", risk: 75, apy: 12.0 },
        }[payload.pool]
      : { venue: "ekubo", risk: 55, apy: payload.expectedApy ? payload.expectedApy * 100 : 9.0 };

    const signal: SignalForExecution = {
      id: `post-deposit-${Date.now()}`,
      name: `${payload.asset} post-deposit deployment`,
      suggestedAmount: Number(payload.amount) > 0 ? Number(payload.amount) : undefined,
      suggestedPrivacyLevel: "shielded",
      type: payload.mode === "fund" ? "vault_fund" : "vault_deposit",
      venue: poolMeta.venue,
      currentYield: poolMeta.apy,
      apy_bps: Math.round(poolMeta.apy * 100),
      riskScore: poolMeta.risk,
      signal_reason: payload.mode === "fund"
        ? `Vault funded with ${payload.amount} ${payload.asset}. Route to execution to deploy capital across adapters.`
        : `Deposit confirmed for ${payload.amount} ${payload.asset}${payload.pool ? ` (${payload.pool} pool)` : ""}. Continue with swap/deploy execution.`,
    };

    trackEvent("post_deposit_handoff", {
      mode: payload.mode,
      asset: payload.asset,
      pool: payload.pool,
      tx_hash: payload.txHash,
    });

    handleVaultTabChange("plan");
    handleDeploy(signal);
  }, [handleDeploy, handleVaultTabChange]);

  const openSlideout = useCallback((mode: NonNullable<SlideoutModeV2>, poolId?: string) => {
    trackEvent("slideout_open", { slideout: mode, pool: poolId });
    setSlideoutPool(poolId);
    setSlideout(mode);
  }, []);

  if (!mounted || (!effectiveConnected && !walletSettled)) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (showOnboarding && isConnected && !isGuest) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  if (!effectiveConnected) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4">
        <Shield className="w-16 h-16 text-zinc-600" />
        <h2 className="text-2xl font-bold text-white">Connect Wallet</h2>
        <p className="text-zinc-400">Connect your wallet to access Capital OS</p>
        <ConnectButton />
        <button
          onClick={() => setGuestMode(true)}
          className="mt-2 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors"
        >
          Preview as Guest
        </button>
      </div>
    );
  }

  const addr = address ?? "";

  let overlayContent: React.ReactNode = null;
  if (activeOverlay === "circuit-board") {
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
  }

  return (
    <>
      {isGuest && (
        <div className="bg-amber-900/90 border-b border-amber-700 px-4 py-2 flex items-center justify-between text-sm">
          <span className="text-amber-200">
            Guest preview — read-only mode with live data
          </span>
          <div className="flex items-center gap-3">
            <ConnectButton />
            <button
              onClick={() => setGuestMode(false)}
              className="text-amber-400 hover:text-amber-200 text-xs underline"
            >
              Exit
            </button>
          </div>
        </div>
      )}
      <div>
        <MissionControlLayout
          address={address}
          activeOverlay={activeOverlay}
          onOverlayChange={setActiveOverlay}
          leftRail={
            <IdentityBadge
              address={addr}
              onSlideout={isGuest ? () => toast("info", "Connect a wallet to fund or withdraw") : (m) => setSlideout(m as SlideoutModeV2)}
              isDemo={isGuest}
              profileV2={profileV2}
            />
          }
          centerStage={
            <VaultCenterStage
              address={addr}
              activeTab={vaultTab}
              onTabChange={handleVaultTabChange}
              onSlideout={isGuest ? () => toast("info", "Connect a wallet to deposit or withdraw") : (m, poolId) => openSlideout(m as NonNullable<SlideoutModeV2>, poolId)}
              onDeploy={isGuest ? undefined : handleDeploy}
              isDemo={isGuest}
              commitments={vault.commitments}
              walletBalance={String(vault.commitments.reduce((s, c) => s + Number(c.amount_wei), 0))}
            />
          }
          rightRail={
            <AgentControls address={addr} isDemo={isGuest} />
          }
          overlay={overlayContent}
          activeMode={vaultTab}
          onModeChange={handleModeChange}
        />
      </div>

      {slideout && (
        <div className="fixed inset-0 z-[60] flex">
          <div
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => { setSlideout(null); setSlideoutPool(undefined); }}
          />
          <div className={`w-full ${slideout === "zkrag" || slideout === "agent-builder" ? "max-w-2xl" : "max-w-lg"} bg-zinc-950 border-l border-zinc-800 overflow-y-auto thin-scroll p-6 animate-in slide-in-from-right`}>
            {slideout !== "execute" && (
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">
                {slideout === "fund" && "Fund Vault"}
                {slideout === "deposit" && (slideoutPool ? `Deposit to ${slideoutPool.charAt(0).toUpperCase() + slideoutPool.slice(1)} Pool` : "Deposit")}
                {slideout === "withdraw" && (slideoutPool ? `Withdraw from ${slideoutPool.charAt(0).toUpperCase() + slideoutPool.slice(1)}` : "Withdraw")}
                {slideout === "privacy" && "Advanced Privacy Pool"}
                {slideout === "shielded" && "Advanced Shield Rail"}
                {slideout === "zkrag" && "zkRAG Intelligence"}
                {slideout === "agent-builder" && "Agent Builder"}
              </h2>
              {slideoutPool && (slideout === "deposit" || slideout === "withdraw") && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-800/50 text-zinc-300 capitalize">
                  {slideoutPool} pool
                </span>
              )}
              <button
                onClick={() => { setSlideout(null); setSlideoutPool(undefined); }}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            )}
            {slideout === "fund" && (
              <FundVaultPanel
                method={vault.method}
                depositSteps={vault.depositSteps}
                setDepositSteps={vault.setDepositSteps}
                addCommitment={vault.addCommitment}
                address={address}
                onRecordDeposit={v2.recordDeposit}
                onFundConfirmed={(payload) => {
                  handlePostDepositHandoff({
                    ...payload,
                    mode: "fund",
                  });
                }}
              />
            )}
            {slideout === "deposit" && (
              <div>
                <DepositPanel
                  method={vault.method}
                  depositSteps={vault.depositSteps}
                  setDepositSteps={vault.setDepositSteps}
                  addCommitment={vault.addCommitment}
                  address={address}
                  initialPool={slideoutPool as "conservative" | "moderate" | "aggressive" | undefined}
                  fixedPoolId={slideoutPool as "conservative" | "moderate" | "aggressive" | undefined}
                  onRecordDeposit={v2.recordDeposit}
                  onDepositConfirmed={(payload) => {
                    handlePostDepositHandoff({
                      ...payload,
                      mode: "deposit",
                    });
                  }}
                />
                {(showAdvancedPrivacyRails) && (
                  <AdvancedDepositSection
                    onOpenPrivacy={() => setSlideout("privacy")}
                    onOpenShielded={() => setSlideout("shielded")}
                    showAdvancedPrivacyRails={showAdvancedPrivacyRails}
                  />
                )}
              </div>
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
                filterPool={slideoutPool}
                onRecordWithdrawal={v2.recordWithdrawal}
              />
            )}
            {showAdvancedPrivacyRails && slideout === "privacy" && <FullPrivacyPoolPanel />}
            {showAdvancedPrivacyRails && slideout === "shielded" && <ShieldedPoolPanel />}
            {slideout === "zkrag" && address && <ZkRagAgentConsole userAddress={address} />}
            {slideout === "agent-builder" && address && (
              <AgentBuilderDrawer userAddress={address} draft={agentBuilderDraft} />
            )}
            {slideout === "execute" && address && selectedSignal && (
              <SignalExecutionDrawer
                signal={selectedSignal}
                address={address}
                onClose={() => { setSlideout(null); setSelectedSignal(null); }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AdvancedDepositSection({
  onOpenPrivacy,
  onOpenShielded,
  showAdvancedPrivacyRails,
}: {
  onOpenPrivacy: () => void;
  onOpenShielded: () => void;
  showAdvancedPrivacyRails: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 border-t border-zinc-800/60 pt-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-full"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <span>Advanced Privacy Rails</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {showAdvancedPrivacyRails && (
            <>
              <button
                onClick={onOpenPrivacy}
                className="w-full text-left px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors"
              >
                <span className="font-medium">Full Privacy Pool</span>
                <span className="block text-[11px] text-zinc-500 mt-0.5">
                  Commitment-shield and nullifier-set rails
                </span>
              </button>
              <button
                onClick={onOpenShielded}
                className="w-full text-left px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors"
              >
                <span className="font-medium">Shielded Pool</span>
                <span className="block text-[11px] text-zinc-500 mt-0.5">
                  Advanced shield rail for privacy pool operations
                </span>
              </button>
            </>
          )}
          {!showAdvancedPrivacyRails && (
            <p className="text-xs text-zinc-600 px-1">
              Enable NEXT_PUBLIC_ENABLE_ADVANCED_PRIVACY_RAILS to unlock additional deposit rails.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
