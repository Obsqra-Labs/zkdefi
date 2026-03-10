"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import { useSearchParams } from "next/navigation";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { useRiskProfileV2 } from "@/hooks/useProfile";
import { apiFetch } from "@/lib/api/client";
import { Shield, X, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { trackEvent } from "@/lib/telemetry";
import {
  MissionControlLayout,
  type OverlayMode,
  CapitalLedger,
  ControlPlane,
  CircuitBoard,
} from "@/components/zkdefi/mission-control";
import { CenterStageModes } from "@/components/zkdefi/mission-control/CenterStageModes";
import { IntelligenceSidebar } from "@/components/zkdefi/mission-control/IntelligenceSidebar";
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
import { VaultStrategyDeposit } from "@/components/zkdefi/vault/VaultStrategyDeposit";
import { WithdrawPanel } from "@/components/zkdefi/vault/WithdrawPanel";
import { FullPrivacyPoolPanel } from "@/components/zkdefi/FullPrivacyPoolPanel";
import { ShieldedPoolPanel } from "@/components/zkdefi/ShieldedPoolPanel";
import { ZkRagAgentConsole } from "@/components/zkdefi/ZkRagAgentConsole";
import { BrainVisualizer } from "@/components/zkdefi/BrainVisualizer";
import { DeployOverlay } from "@/components/zkdefi/mission-control/DeployOverlay";
import { GovernanceOverlay } from "@/components/zkdefi/mission-control/GovernanceOverlay";
import { LendingConsole } from "@/components/zkdefi/LendingConsole";
import { MarketplaceConsole } from "@/components/zkdefi/MarketplaceConsole";
import { OracleConsole } from "@/components/zkdefi/OracleConsole";
import {
  AgentBuilderDrawer,
  type AgentBuilderDraft,
} from "@/components/zkdefi/mission-control/AgentBuilderDrawer";
import {
  isCapitalOSV2Enabled,
  resolveViewParamV2,
  resolveViewOverlayV2,
  buildAgentUrl,
  type VaultTab,
  type CenterModeV2,
  type SlideoutModeV2,
} from "@/lib/agentState";

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
  const { address, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const { profile: profileV2 } = useRiskProfileV2(address);
  const trustFlow = useTrustFlowState(profileV2, address);
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<OverlayMode>(null);
  const [slideout, setSlideout] = useState<SlideoutModeV2>(null);
  const [agentBuilderDraft, setAgentBuilderDraft] = useState<AgentBuilderDraft | null>(null);
  const [depositMode, setDepositMode] = useState<"privacy" | "strategy">("privacy");
  const showAdvancedPrivacyRails = process.env.NEXT_PUBLIC_ENABLE_ADVANCED_PRIVACY_RAILS === "1";

  // Capital OS V2 feature flag
  const v2Enabled = isCapitalOSV2Enabled();

  const vault = usePrivacyVault(address);
  const v2 = useVaultV2(address);

  // --- V2 URL resolution ---
  const resolvedV2 = resolveViewParamV2(searchParams.get("v"), searchParams.get("t"));
  const resolvedV2Overlay = resolveViewOverlayV2(searchParams.get("v"));
  const [vaultTab, setVaultTab] = useState<VaultTab>(resolvedV2.vaultTab ?? "overview");

  useEffect(() => setMounted(true), []);

  // Apply initial overlay/slideout from ?v= param on mount
  useEffect(() => {
    if (!mounted) return;
    if (resolvedV2Overlay.overlay) setActiveOverlay(resolvedV2Overlay.overlay as OverlayMode);
    if (resolvedV2Overlay.slideout) setSlideout(resolvedV2Overlay.slideout as SlideoutModeV2);
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  /** V2: callback when vault tab changes — sync URL shallow */
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

  /** Header nav pill: switch vault tab + dismiss overlay */
  const handleModeChange = useCallback((mode: VaultTab) => {
    setActiveOverlay(null);
    handleVaultTabChange(mode);
  }, [handleVaultTabChange]);

  useEffect(() => {
    if (!mounted || !isConnected || !address) {
      setShowOnboarding(false);
      return;
    }

    migrateLegacyOnboardingState(address);
    const completed = isOnboardingComplete(address);
    if (trustFlow.readyForAgent && !completed) {
      markOnboardingComplete(address, "trust_flow_ready");
      setShowOnboarding(false);
      return;
    }

    setShowOnboarding(!completed);
  }, [mounted, isConnected, address, trustFlow.readyForAgent]);

  const handleOnboardingComplete = useCallback(() => {
    if (address) markOnboardingComplete(address, "onboarding_wizard");
    setShowOnboarding(false);
  }, [address]);

  const handleOpenCircuitBoard = useCallback(() => {
    trackEvent("overlay_open", { overlay: "circuit-board" });
    setActiveOverlay("circuit-board");
  }, []);

  const handleOpenAgentBuilder = useCallback((draft: AgentBuilderDraft) => {
    trackEvent("slideout_open", { slideout: "agent-builder" });
    setAgentBuilderDraft(draft);
    setSlideout("agent-builder");
  }, []);

  /** Tracked slideout opener */
  const openSlideout = useCallback((mode: NonNullable<SlideoutModeV2>) => {
    trackEvent("slideout_open", { slideout: mode });
    setSlideout(mode);
  }, []);

  /** Tracked overlay opener */
  const openOverlay = useCallback((mode: NonNullable<OverlayMode>) => {
    trackEvent("overlay_open", { overlay: mode });
    setActiveOverlay(mode);
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
  } else if (activeOverlay === "execution-pipeline") {
    overlayContent = (
      <div className="flex h-full flex-col bg-zinc-950">
        <header className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4">
          <span className="font-semibold text-sm text-zinc-100">Execution Pipeline</span>
          <button
            onClick={() => setActiveOverlay(null)}
            className="flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700 text-zinc-200"
          >
            <X className="w-3 h-3" /> Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <ExecutionPipelineOverlay address={address} />
        </div>
      </div>
    );
  }

  return (
    <>
      <MissionControlLayout
        address={address}
        activeOverlay={activeOverlay}
        onOverlayChange={setActiveOverlay}
        leftRail={
          v2Enabled ? (
            <IntelligenceSidebar
              address={address}
              onDeposit={() => openSlideout("deposit")}
              onWithdraw={() => openSlideout("withdraw")}
              onOpenPolicy={() => openOverlay("governance")}
              onOpenCompose={() => openOverlay("circuit-board")}
            />
          ) : (
            <CapitalLedger
              address={address}
              privacyCommitments={vault.commitments}
              onDeposit={() => openSlideout("deposit")}
              onWithdraw={() => openSlideout("withdraw")}
              onImportDarkLedger={showAdvancedPrivacyRails ? () => openSlideout("privacy") : undefined}
              onOpenShielded={showAdvancedPrivacyRails ? () => openSlideout("shielded") : undefined}
              v2={v2}
            />
          )
        }
        centerStage={
          <CenterStageModes
            address={address}
            onDeploy={() => openOverlay("deploy")}
            onOpenGovernance={() => openOverlay("governance")}
            onOpenCircuitBoard={() => openOverlay("circuit-board")}
            onOpenZkRag={() => openSlideout("zkrag")}
            vaultProps={{
              method: vault.method,
              setMethod: vault.setMethod,
              commitments: vault.commitments,
              addCommitment: vault.addCommitment,
              removeCommitment: vault.removeCommitment,
              depositSteps: vault.depositSteps,
              withdrawSteps: vault.withdrawSteps,
              setDepositSteps: vault.setDepositSteps,
              setWithdrawSteps: vault.setWithdrawSteps,
            }}
            v2={v2}
            onDeposit={() => openSlideout("deposit")}
            onWithdraw={() => openSlideout("withdraw")}
            /* V2 props */
            initialModeV2={resolvedV2.mode}
            initialVaultTab={vaultTab}
            onVaultTabChange={handleVaultTabChange}
          />
        }
        rightRail={
          <ControlPlane
            address={address}
            onOpenCircuitBoard={handleOpenCircuitBoard}
            onOpenBrain={() => openOverlay("brain")}
            onOpenZkRag={() => openSlideout("zkrag")}
            onOpenPolicy={() => openSlideout("oracle")}
          />
        }
        overlay={overlayContent}
        onDeposit={() => openSlideout("deposit")}
        onWithdraw={() => openSlideout("withdraw")}
        featureV2={v2Enabled}
        activeMode={vaultTab}
        onModeChange={handleModeChange}
      />

      {slideout && (
        <div className="fixed inset-0 z-[60] flex">
          <div
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setSlideout(null)}
          />
          <div className={`w-full ${slideout === "zkrag" || slideout === "agent-builder" || slideout === "lending" || slideout === "marketplace" || slideout === "oracle" ? "max-w-2xl" : "max-w-lg"} bg-zinc-950 border-l border-zinc-800 overflow-y-auto p-6 animate-in slide-in-from-right`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">
                {slideout === "deposit" && (
                  v2Enabled
                    ? (depositMode === "strategy" ? "Direct to Pool" : "Fund Vault")
                    : (depositMode === "strategy" ? "Personal Strategy Deposit" : "Deposit to Privacy Pool")
                )}
                {slideout === "withdraw" && "Withdraw"}
                {slideout === "privacy" && "Advanced Privacy Pool"}
                {slideout === "shielded" && "Advanced Shield Rail"}
                {slideout === "zkrag" && "zkRAG Intelligence"}
                {slideout === "agent-builder" && "Agent Builder"}
                {slideout === "lending" && "P2P Lending"}
                {slideout === "marketplace" && "zkML Marketplace"}
                {slideout === "oracle" && "Oracle Policy Editor"}
              </h2>
              <button
                onClick={() => setSlideout(null)}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {slideout === "deposit" && (
              <div>
                {/* Deposit mode toggle: V2 = Fund Vault / Direct to Pool; Legacy = Privacy Pool / Strategy */}
                <div className="flex items-center gap-1.5 mb-5 p-1 rounded-full bg-zinc-800/60 border border-zinc-700/50">
                  <button
                    onClick={() => setDepositMode("privacy")}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-full transition-colors ${
                      depositMode === "privacy"
                        ? "bg-emerald-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {v2Enabled ? "Fund Vault" : "Privacy Pool"}
                  </button>
                  <button
                    onClick={() => setDepositMode("strategy")}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-full transition-colors ${
                      depositMode === "strategy"
                        ? "bg-violet-600 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {v2Enabled ? "Direct to Pool" : "Personal Strategy"}
                  </button>
                </div>
                {depositMode === "privacy" ? (
                  <DepositPanel
                    method={vault.method}
                    depositSteps={vault.depositSteps}
                    setDepositSteps={vault.setDepositSteps}
                    addCommitment={vault.addCommitment}
                    address={address}
                    onRecordDeposit={v2.recordDeposit}
                  />
                ) : (
                  <VaultStrategyDeposit
                    method={vault.method}
                    depositSteps={vault.depositSteps}
                    setDepositSteps={vault.setDepositSteps}
                    addCommitment={vault.addCommitment}
                    address={address}
                    onRecordDeposit={v2.recordDeposit}
                  />
                )}
                {/* Collapsible Advanced section for legacy privacy rails */}
                {(showAdvancedPrivacyRails || v2Enabled) && (
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
                onRecordWithdrawal={v2.recordWithdrawal}
              />
            )}
            {showAdvancedPrivacyRails && slideout === "privacy" && <FullPrivacyPoolPanel />}
            {showAdvancedPrivacyRails && slideout === "shielded" && <ShieldedPoolPanel />}
            {slideout === "zkrag" && address && <ZkRagAgentConsole userAddress={address} />}
            {slideout === "agent-builder" && address && (
              <AgentBuilderDrawer userAddress={address} draft={agentBuilderDraft} />
            )}
            {slideout === "lending" && address && (
              <LendingConsole address={address} />
            )}
            {slideout === "marketplace" && address && (
              <MarketplaceConsole address={address} />
            )}
            {slideout === "oracle" && (
              <OracleConsole address={address} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Advanced Deposit Section
// ---------------------------------------------------------------------------

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
                  Advanced shield rail for dark ledger operations
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

// ---------------------------------------------------------------------------
// Execution Pipeline Overlay — 7-step pipeline visualization
// ---------------------------------------------------------------------------

function ExecutionPipelineOverlay({ address }: { address: string | undefined }) {
  const [loading, setLoading] = useState(true);
  const [steps, setSteps] = useState<Record<string, any>>({});
  const [timestamp, setTimestamp] = useState<string>("");

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const data = await apiFetch<any>(
          `/api/v1/zkdefi/mc/execution/current/${address}`,
        );
        if (!cancelled) {
          setSteps(data?.steps || {});
          setTimestamp(data?.timestamp || "");
        }
      } catch {
        if (!cancelled) {
          setSteps({});
          setTimestamp("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [address]);

  if (!address) {
    return (
      <div className="text-zinc-500 text-sm">
        Connect wallet to view execution pipeline.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 text-zinc-600 animate-spin" />
      </div>
    );
  }

  const ordered = [
    "intent",
    "policy",
    "proof_package",
    "agent",
    "strategy",
    "execution",
    "receipt",
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 mb-4">
        Real-time execution pipeline status — each step must pass before the next begins.
      </p>
      {ordered.map((key, idx) => {
        const step = steps?.[key] || {};
        const status = String(step.status || "pending");
        const statusColor =
          status === "complete"
            ? "bg-emerald-500"
            : status === "failed"
              ? "bg-red-500"
              : status === "waiting"
                ? "bg-amber-500"
                : "bg-zinc-600";
        return (
          <div
            key={key}
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
          >
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${statusColor}`} />
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                Step {idx + 1}
              </span>
              <span className="text-sm font-medium text-zinc-200 capitalize">
                {key.replace(/_/g, " ")}
              </span>
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  status === "complete"
                    ? "bg-emerald-900/40 text-emerald-400"
                    : status === "failed"
                      ? "bg-red-900/40 text-red-400"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {status}
              </span>
            </div>
            {Object.keys(step).length > 1 && (
              <pre className="mt-2 text-xs text-zinc-500 whitespace-pre-wrap break-all bg-zinc-950/50 rounded p-2">
                {JSON.stringify(step, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
      {timestamp && (
        <div className="text-xs text-zinc-600 pt-2">
          Last updated: {new Date(timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
}
