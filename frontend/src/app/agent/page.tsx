"use client";

/**
 * AgentPage — shell router for the three canonical surfaces.
 *
 * Responsibilities (and *only* these):
 * - Surface selection via ?v=vault|oracle|brain (+ legacy ?tab= compat)
 * - Wallet connection / onboarding guard orchestration
 * - Surface container mounting inside an error boundary
 * - Top-level header with navigation
 *
 * All business data fetching, polling, and feature rendering lives in
 * the surface containers under components/zkdefi/surfaces/.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { OnboardingWizard } from "@/components/zkdefi/OnboardingWizard";
import { useAccount } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { Shield, Brain, ArrowDownUp, Wallet, Activity } from "lucide-react";
import { CapitalOSStrip } from "@/components/zkdefi/CapitalOSStrip";
import type { CapitalOSStripIdentity, CapitalOSStripGate, CapitalOSStripLedger, CapitalOSStripNextStep, CapitalOSStripAIInsight } from "@/components/zkdefi/CapitalOSStrip";
import { useVaultController } from "@/hooks/useVaultController";
import { API_BASE } from "@/lib/api/client";
import { DEMO_STRIP, DEMO_NEXT_STEP, DEMO_AI_INSIGHT, DEMO_ADDRESS as DEMO_ADDRESS_CONST } from "@/lib/demoCapitalOS";

// Surface containers
import { VaultSurfaceContainer } from "@/components/zkdefi/surfaces/VaultSurfaceContainer";
import { OracleSurfaceContainer } from "@/components/zkdefi/surfaces/OracleSurfaceContainer";
import { BrainSurfaceContainer } from "@/components/zkdefi/surfaces/BrainSurfaceContainer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Surface = "vault" | "oracle" | "brain";

/** Map legacy ?tab= values to canonical surfaces. Execution (swap/lp/limits/staking) → vault; discovery (markets) → oracle. */
const LEGACY_TAB_MAP: Record<string, { surface: Surface; sub?: string }> = {
  vault: { surface: "vault", sub: "portfolio" },
  portfolio: { surface: "vault", sub: "portfolio" },
  dashboard: { surface: "vault", sub: "deploy" },
  deploy: { surface: "vault", sub: "deploy" },
  pools: { surface: "vault", sub: "deploy" },
  yield: { surface: "vault", sub: "performance" },
  ledger: { surface: "vault", sub: "ledger" },
  lending: { surface: "vault", sub: "lending" },
  private_yield: { surface: "vault", sub: "private_yield" },
  trade: { surface: "oracle", sub: "signals" },
  markets: { surface: "oracle", sub: "signals" },
  dex: { surface: "vault", sub: "trade" },
  swap: { surface: "vault", sub: "trade" },
  lp: { surface: "vault", sub: "trade" },
  limits: { surface: "vault", sub: "trade" },
  staking: { surface: "vault", sub: "staking" },
  agent: { surface: "brain", sub: "agent" },
  models: { surface: "brain", sub: "models" },
  pipeline: { surface: "brain", sub: "pipeline" },
  agents: { surface: "brain", sub: "agents" },
  disclosure: { surface: "brain", sub: "pipeline" },
  privacy: { surface: "brain", sub: "pipeline" },
  identity: { surface: "brain", sub: "agents" },
  "my-agents": { surface: "brain", sub: "agents" },
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function AgentPage() {
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();

  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [surface, setSurface] = useState<Surface>("vault");
  const [subTabOverride, setSubTabOverride] = useState<string | undefined>(undefined);
  const [loadingBailout, setLoadingBailout] = useState(false);
  const [loadingStuckHint, setLoadingStuckHint] = useState(false);

  const [shellSessionCount, setShellSessionCount] = useState(0);
  const [shellAgentStatus, setShellAgentStatus] = useState<"idle" | "monitoring" | "executing">("idle");
  const [shellAiInsight, setShellAiInsight] = useState<string | null>(null);
  const [shellCommitmentCount, setShellCommitmentCount] = useState(0);
  const [stripData, setStripData] = useState<{
    identity: CapitalOSStripIdentity;
    gate: CapitalOSStripGate;
    ledger: CapitalOSStripLedger;
  } | null>(null);
  const [gatePopoverOpen, setGatePopoverOpen] = useState(false);

  const router = useRouter();

  useEffect(() => setMounted(true), []);

  const demoMode = searchParams.get("mode") === "demo";
  const demoAddress = DEMO_ADDRESS_CONST;
  const hasAccount = isConnected && !!address;
  const showLoading = !demoMode && (!mounted || (!hasAccount && !walletSettled && !loadingBailout));
  const showConnectGate = !demoMode && mounted && !hasAccount && (walletSettled || loadingBailout);

  const effectiveAddress = address || (demoMode ? demoAddress : undefined);
  const { proofsState, pendingProposal } = useVaultController(effectiveAddress);

  // Loading bailout — prevent permanent spinner
  useEffect(() => {
    if (!showLoading) { setLoadingBailout(false); setLoadingStuckHint(false); return; }
    const t = setTimeout(() => setLoadingBailout(true), 1500);
    return () => clearTimeout(t);
  }, [showLoading]);

  useEffect(() => {
    if (!showLoading) return;
    const t = setTimeout(() => setLoadingStuckHint(true), 5000);
    return () => clearTimeout(t);
  }, [showLoading]);

  // Deep-link routing: canonical ?v= and legacy ?tab= compat
  useEffect(() => {
    if (!mounted) return;
    // Canonical: ?v=vault|oracle|brain (v=trade redirects to oracle)
    const v = searchParams.get("v");
    if (v === "trade") {
      setSurface("oracle");
      setSubTabOverride(searchParams.get("sub") ?? "signals");
      return;
    }
    if (v && ["vault", "oracle", "brain"].includes(v)) {
      setSurface(v as Surface);
      setSubTabOverride(searchParams.get("sub") ?? undefined);
      return;
    }
    // Legacy: ?tab=*
    const tab = searchParams.get("tab");
    if (tab === "onboarding") { setShowOnboarding(true); setHasOnboarded(false); return; }
    if (tab && LEGACY_TAB_MAP[tab]) {
      const mapped = LEGACY_TAB_MAP[tab];
      setSurface(mapped.surface);
      setSubTabOverride(mapped.sub);
      return;
    }
    // Hash #deploy-to-ekubo -> vault dashboard
    const highlight = searchParams.get("highlight");
    if (highlight === "deploy") {
      setSurface("vault");
      setSubTabOverride("deploy");
    }
  }, [mounted, searchParams]);

  // URL sync: reflect surface and sub in ?v= and &sub= (replaceState to avoid history spam)
  const VAULT_SUBS = ["portfolio", "yield", "trade", "lending", "staking", "activity", "deploy", "performance", "ledger", "private_yield"];
  const ORACLE_SUBS = ["signals", "radar", "genome"];
  const BRAIN_SUBS = ["agent", "models", "pipeline", "agents"];
  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const currentV = params.get("v");
    const currentSub = params.get("sub");
    const wantV = surface;
    const wantSub = subTabOverride;
    const validSub =
      wantV === "vault" && wantSub && VAULT_SUBS.includes(wantSub)
        ? wantSub
        : wantV === "oracle" && wantSub && ORACLE_SUBS.includes(wantSub)
          ? wantSub
          : wantV === "brain" && wantSub && BRAIN_SUBS.includes(wantSub)
            ? wantSub
            : undefined;
    if (currentV === wantV && currentSub === (validSub ?? null)) return;
    params.set("v", wantV);
    if (validSub) params.set("sub", validSub);
    else params.delete("sub");
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- vault/oracle/brain subs are stable
  }, [mounted, surface, subTabOverride]);

  // Ledger click: when switching to vault + activity, scroll to Activity section once mounted
  useEffect(() => {
    if (surface !== "vault" || subTabOverride !== "activity") return;
    const t = setTimeout(() => {
      document.getElementById("vault-activity-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(t);
  }, [surface, subTabOverride]);

  // Onboarding check
  useEffect(() => {
    if (mounted && isConnected && address && !searchParams.get("tab") && !searchParams.get("v")) {
      const onboarded = localStorage.getItem(`zkdefi_onboarded_${address}`);
      if (!onboarded) setShowOnboarding(true);
      else setHasOnboarded(true);
    }
  }, [mounted, isConnected, address, searchParams]);

  // Shell-level lightweight data for CapitalFlowStrip
  useEffect(() => {
    if (!effectiveAddress) return;
    let dead = false;

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/zkdefi/session_keys/list/${effectiveAddress}`,
          { signal: AbortSignal.timeout(6000) },
        );
        if (res.ok && !dead) {
          const data = await res.json();
          const sessions: Array<{ revoked_at?: string | null; expires_at?: string }> =
            Array.isArray(data?.sessions) ? data.sessions : [];
          const now = Date.now();
          const active = sessions.filter((s) => {
            if (s.revoked_at) return false;
            if (s.expires_at && new Date(s.expires_at).getTime() < now) return false;
            return true;
          });
          setShellSessionCount(active.length);
        }
      } catch { /* best effort */ }

      try {
        const insightRes = await fetch(`${API_BASE}/api/v1/strategies/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_address: effectiveAddress, risk_profile: "balanced", amount: 1000 }),
          signal: AbortSignal.timeout(8000),
        });
        if (insightRes.ok && !dead) {
          const data = await insightRes.json();
          const text = data.ai_reasoning || data.portfolio_risk_assessment || data.recommendation || null;
          if (text) setShellAiInsight(text);
        }
      } catch { /* best effort */ }
    })();

    return () => { dead = true; };
  }, [effectiveAddress]);

  // Capital OS Strip data: risk passport v2 + receipts/activity. Demo = seeded fixture.
  useEffect(() => {
    if (demoMode) {
      setStripData(DEMO_STRIP);
      return;
    }
    if (!effectiveAddress) {
      setStripData(null);
      return;
    }
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_passport/user/${effectiveAddress}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (dead) return;
        const passport = res.ok ? await res.json() : null;
        const receipts: unknown[] = Array.isArray(passport?.proof_receipts) ? passport.proof_receipts : [];
        const tierName = passport?.tier_name ?? (passport?.tier !== undefined ? (passport.tier === 0 ? "Strict" : passport.tier === 1 ? "Standard" : "Pathfinder") : "Standard");
        const lastEntry =
          receipts.length > 0 && receipts[0] && typeof receipts[0] === "object" && "action_type" in (receipts[0] as object)
            ? String((receipts[0] as { action_type?: string }).action_type || "Activity")
            : "No activity yet";
        setStripData({
          identity: {
            addressOrId: effectiveAddress,
            tier: tierName,
            proofCount: receipts.length,
          },
          gate: {
            riskTolerance: "Moderate",
            allowedCount: 4,
            totalCount: 6,
            status: "ok",
          },
          ledger: {
            lastEntryLabel: lastEntry,
            receiptCount: receipts.length,
          },
        });
      } catch {
        if (!dead) {
          setStripData({
            identity: { addressOrId: effectiveAddress, tier: "—", proofCount: 0 },
            gate: { riskTolerance: "—", allowedCount: 0, totalCount: 0, status: "warn" },
            ledger: { lastEntryLabel: "Unable to load", receiptCount: 0 },
          });
        }
      }
    })();
    return () => { dead = true; };
  }, [effectiveAddress, demoMode]);

  const handleOnboardingComplete = () => {
    if (address) localStorage.setItem(`zkdefi_onboarded_${address}`, "true");
    setShowOnboarding(false);
    setHasOnboarded(true);
  };

  // -----------------------------------------------------------------------
  // Error fallback
  // -----------------------------------------------------------------------
  const errorFallback = (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 py-12 bg-zinc-950 text-white">
      <p className="text-lg font-medium text-zinc-200">Surface failed to load</p>
      <p className="text-sm text-zinc-500 max-w-md text-center">An error occurred while rendering. Try reloading.</p>
      <button type="button" onClick={() => window.location.reload()} className="px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium">
        Reload page
      </button>
    </div>
  );

  // -----------------------------------------------------------------------
  // Onboarding gate
  // -----------------------------------------------------------------------
  if (showOnboarding && hasAccount) {
    return (
      <ErrorBoundary fallback={errorFallback}>
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      </ErrorBoundary>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">zkde.fi</h1>
                <p className="text-xs text-zinc-400">Reputation-tiered private DeFi</p>
              </div>
            </Link>
            <nav className="hidden md:flex items-center gap-1 ml-4">
              <Link href="/agent" prefetch={false} className="px-3 py-1.5 text-sm font-medium text-white bg-zinc-800 rounded-lg">App</Link>
              <Link href="/profile" prefetch={false} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all">Identity</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <ConnectButton />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {showLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-500">Connecting to Starknet…</p>
            {loadingStuckHint && (
              <button type="button" onClick={() => window.location.reload()} className="text-sm text-emerald-400 hover:text-emerald-300 underline mt-2">
                Reload the page
              </button>
            )}
          </div>
        ) : showConnectGate ? (
          <div className="text-center py-20">
            <Shield className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
            <h2 className="text-2xl font-bold mb-2">Connect Wallet</h2>
            <p className="text-zinc-400 mb-6">Connect your wallet to access the autonomous agent</p>
            <ConnectButton />
          </div>
        ) : (
          <ErrorBoundary fallback={errorFallback}>
            {/* Capital OS Strip — Identity | Gate | Ledger | Next Step | AI Insight */}
            <div className="mb-4 relative">
              {stripData && (
                <CapitalOSStrip
                  identity={stripData.identity}
                  gate={stripData.gate}
                  ledger={stripData.ledger}
                  nextStep={demoMode ? DEMO_NEXT_STEP : undefined}
                  aiInsight={demoMode ? DEMO_AI_INSIGHT : (shellAiInsight ? { message: shellAiInsight } : undefined)}
                  isDemo={demoMode}
                  onIdentityClick={() => router.push("/profile")}
                  onGateClick={() => setGatePopoverOpen((o) => !o)}
                  onLedgerClick={() => {
                    setSurface("vault");
                    setSubTabOverride("activity");
                  }}
                  onNextStepClick={() => {
                    const action = demoMode ? DEMO_NEXT_STEP.action : undefined;
                    if (action === "oracle") {
                      setSurface("oracle");
                      setSubTabOverride("signals");
                    } else if (action === "vault") {
                      setSurface("vault");
                      setSubTabOverride("portfolio");
                    } else if (action === "brain") {
                      setSurface("brain");
                      setSubTabOverride("agent");
                    }
                  }}
                />
              )}
              {!stripData && !demoMode && effectiveAddress && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 text-zinc-500 text-sm">
                  Loading strip…
                </div>
              )}
              {gatePopoverOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close gate popover"
                    className="fixed inset-0 z-10"
                    onClick={() => setGatePopoverOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-1 z-20 min-w-[220px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-lg">
                    <p className="text-xs font-medium text-zinc-300 mb-2">Gate</p>
                    {stripData && (
                      <>
                        {stripData.gate.allowedList?.length || stripData.gate.blockedList?.length ? (
                          <>
                            {stripData.gate.allowedList?.length ? (
                              <div className="mb-2">
                                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Allowed strategies</p>
                                <ul className="text-xs text-zinc-300 space-y-0.5">
                                  {stripData.gate.allowedList.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {stripData.gate.blockedList?.length ? (
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Blocked</p>
                                <ul className="text-xs text-red-400/90 space-y-0.5">
                                  {stripData.gate.blockedList.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-zinc-400">Risk tolerance: {stripData.gate.riskTolerance}</p>
                            <p className="text-xs text-zinc-400 mt-1">Policy: {stripData.gate.allowedCount}/{stripData.gate.totalCount} strategies allowed</p>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Surface tabs: Vault | Oracle | Brain */}
            <div className="flex gap-2 mb-6 border-b border-zinc-800 pb-4">
              <button
                onClick={() => { setSurface("vault"); setSubTabOverride(undefined); }}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${surface === "vault" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
              >
                <Wallet className="w-4 h-4" /> Vault
              </button>
              <button
                onClick={() => { setSurface("oracle"); setSubTabOverride(undefined); }}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${surface === "oracle" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
              >
                <Activity className="w-4 h-4" /> Oracle
              </button>
              <button
                onClick={() => { setSurface("brain"); setSubTabOverride(undefined); }}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${surface === "brain" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
              >
                <Brain className="w-4 h-4" /> Brain
              </button>
            </div>

            {/* Surface containers */}
            {surface === "vault" && (
              <VaultSurfaceContainer
                address={address || (demoMode ? demoAddress : undefined)}
                initialSubTab={subTabOverride ?? undefined}
                isDemo={demoMode}
                onNavigateToTrade={(sub) => {
                  setSurface("vault");
                  setSubTabOverride(sub ?? "trade");
                }}
                onNavigateToOracle={() => {
                  setSurface("oracle");
                  setSubTabOverride(undefined);
                }}
              />
            )}
            {surface === "oracle" && (
              <OracleSurfaceContainer
                address={address || (demoMode ? demoAddress : undefined)}
                initialSubTab={(subTabOverride as "signals" | "radar" | "genome") ?? "signals"}
                onNavigateToVault={(sub) => {
                  setSurface("vault");
                  setSubTabOverride(sub || "trade");
                }}
              />
            )}
            {surface === "brain" && (
              <BrainSurfaceContainer
                address={address || (demoMode ? demoAddress : undefined)}
                initialSubTab={subTabOverride as "agent" | "models" | "pipeline" | "agents" | undefined}
              />
            )}
          </ErrorBoundary>
        )}
      </div>
    </main>
  );
}
