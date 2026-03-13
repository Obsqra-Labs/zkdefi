"use client";

import { useState, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import {
  Wallet,
  ArrowRight,
  Layers,
  Zap,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Fingerprint,
  Activity,
  Lock,
  ShieldCheck,
  Key,
  TrendingUp,
  Star,
  Brain,
  Eye,
  Cpu,
} from "lucide-react";
import { WalletModal } from "@/components/zkdefi/WalletModal";
import { ReputationProfile, type ReputationData } from "@/components/marketing/ReputationProfile";
import { CapitalOSHome, type L3Identity } from "@/components/marketing/CapitalOSHome";
import { StrategyCompare } from "@/components/marketing/StrategyCompare";
import { PnLTracker } from "@/components/marketing/PnLTracker";
import { SessionWallet, type SessionKeyInfo } from "@/components/marketing/SessionWallet";
import { IntelligentStream } from "@/components/marketing/IntelligentStream";
import { DarkVaultPanel } from "@/components/marketing/DarkVaultPanel";
import { ProofOfPerformance } from "@/components/marketing/ProofOfPerformance";
import { MultiPanelLayout, type PanelDef } from "@/components/marketing/MultiPanelLayout";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

interface SnapshotInfo {
  snapshot_id: string;
  session_id: string;
  total_value_usd: number;
  total_pnl_usd: number;
  position_count: number;
  snapshot_hash: string;
}

interface L3Settlement {
  fact_hash: string;
  batch_item_id: string;
  status: string;
  snapshot_hash: string;
}

interface ExecutionResult {
  session_id: string;
  positions_opened: number;
  position_ids: string[];
  snapshot: SnapshotInfo;
  l3_settlement: L3Settlement;
  proposal_hash: string;
}

interface SimulateAndExecuteResponse {
  portfolio: {
    wallet_address: string;
    total_value_usd: number;
    position_count: number;
    protocols_found: string[];
  };
  proposal: {
    risk_profile: string;
    expected_blended_apy: number;
    expected_annual_yield_usd: number;
    reasoning: string;
    proposal_hash: string;
    moves: unknown[];
    portfolio_value_usd?: number;
  };
  execution: ExecutionResult;
  is_hypothetical?: boolean;
}

interface OnboardResponse {
  status: string;
  wallet_address: string;
  l3_address: string;
  session_id: string;
  session_created_at: string;
  reputation: ReputationData | null;
  session_key?: SessionKeyInfo | null;
}

/**
 * Unified demo phases:
 *  discover    → walletless AI Brain + pool analysis
 *  onboarding  → calling /onboard (reputation + L3 address + session)
 *  home        → multi-panel identity + strategy selection
 *  executing   → paper executing the selected strategy
 *  live        → full Capital OS terminal panels
 */
type DemoPhase = "discover" | "onboarding" | "home" | "executing" | "live";

/* ─── guest mode seeded data ───────────────────────────────────────── */

const GUEST_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";

const GUEST_IDENTITY: L3Identity = {
  wallet_address: GUEST_ADDRESS,
  l3_address: "0x0474b940f499ca60d2aebce5c6b0b0c4e8b0947e",
  session_id: "guest-session-demo-001",
  session_created_at: new Date().toISOString(),
  fico_score: 720,
  fico_tier: "Good",
  credit_class: "A",
  credit_confidence: 0.87,
  defi_veteran_score: 68,
  recommended_tier: 3,
  tier_reasoning:
    "Active multi-protocol user with strong repayment history and diverse LP positions",
  profile_hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  ezkl_ready: true,
};

const GUEST_REPUTATION: ReputationData = {
  wallet_address: GUEST_ADDRESS,
  scanned_at: new Date().toISOString(),
  account_type: "contract",
  nonce: 47,
  account_exists: true,
  is_contract_deployer: false,
  total_capital_usd: 12_450,
  capital_by_protocol: { ekubo: 5200, vesu: 3800, nostra: 2100, endur: 1350 },
  protocol_count: 4,
  position_count: 7,
  signals: [
    { signal: "active_user", value: 0.92, label: "Active User", evidence: "47 on-chain transactions in 90 days", category: "activity" },
    { signal: "diversified", value: 0.85, label: "Diversified", evidence: "Capital across 4 protocols", category: "diversity" },
    { signal: "liquidity_provider", value: 0.88, label: "LP Provider", evidence: "3 active LP positions on Ekubo", category: "capital" },
    { signal: "diamond_hands", value: 0.78, label: "Diamond Hands", evidence: "Positions held through 2 drawdowns", category: "resilience" },
    { signal: "defi_experienced", value: 0.90, label: "DeFi Veteran", evidence: "Multi-protocol DeFi veteran", category: "activity" },
  ] as ReputationData["signals"],
  defi_veteran_score: 68,
  conviction_score: 72,
  activity_score: 85,
  diversity_score: 78,
  capital_score: 62,
  resilience_score: 70,
  recommended_tier: 3,
  tier_reasoning:
    "Active multi-protocol user with strong repayment history and diverse LP positions",
  profile_hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  scan_duration_ms: 0,
  errors: [],
  fico_score: 720,
  fico_tier: "Good",
  credit_class: "A",
  credit_confidence: 0.87,
  ezkl_ready: true,
};

const GUEST_SESSION_KEY: SessionKeyInfo = {
  key_id: "sk_guest_demo_001",
  signing_key_prefix: "0x04ab…c3f8",
  permissions: ["paper_trade", "view_portfolio", "generate_proofs", "deposit_vault"],
  expires_at: Math.floor(Date.now() / 1000) + 7200,
  ttl_seconds: 7200,
  status: "active",
};

const GUEST_EXECUTION: ExecutionResult = {
  session_id: "guest-session-demo-001",
  positions_opened: 4,
  position_ids: ["pos_demo_1", "pos_demo_2", "pos_demo_3", "pos_demo_4"],
  snapshot: {
    snapshot_id: "snap_demo_001",
    session_id: "guest-session-demo-001",
    total_value_usd: 10_000,
    total_pnl_usd: 0,
    position_count: 4,
    snapshot_hash: "0x7f3ab9e2d4c1a5f8e0b3d6c9a2f5e8b1d4c7a0f3e6b9d2c5a8f1e4b7d0c3a6f9",
  },
  l3_settlement: {
    fact_hash: "0xa3b7c1d5e9f24e8a2c6f0d4b8e2a6c0f4d8b2e6a0c4f8d2b6e0a4c8f2d6b0b4",
    batch_item_id: "batch_demo_001",
    status: "settled",
    snapshot_hash: "0x7f3ab9e2d4c1a5f8e0b3d6c9a2f5e8b1d4c7a0f3e6b9d2c5a8f1e4b7d0c3a6f9",
  },
  proposal_hash: "0xdemo_proposal_hash_001",
};

/* ─── helpers ──────────────────────────────────────────────────────── */

const CAPITAL_AMOUNTS = [1_000, 5_000, 10_000, 50_000, 100_000] as const;

function fmtUsd(n: number): string {
  return n < 0.01 && n > 0
    ? "<$0.01"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncHash(h: string, chars = 8): string {
  if (!h) return "";
  const clean = h.startsWith("0x") ? h : `0x${h}`;
  return `${clean.slice(0, chars + 2)}…${clean.slice(-chars)}`;
}

/* ─── phase stepper ────────────────────────────────────────────────── */

const PHASE_STEPS: { key: DemoPhase; label: string; icon: typeof Brain }[] = [
  { key: "discover", label: "Discover", icon: Brain },
  { key: "home", label: "Identity", icon: Fingerprint },
  { key: "executing", label: "Execute", icon: Zap },
  { key: "live", label: "Capital OS", icon: Layers },
];

function phaseIndex(p: DemoPhase): number {
  if (p === "onboarding") return 0;
  return PHASE_STEPS.findIndex((s) => s.key === p);
}

function PhaseStepper({ current }: { current: DemoPhase }) {
  const idx = phaseIndex(current);
  return (
    <div className="mx-auto flex max-w-xl items-center justify-center gap-1">
      {PHASE_STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={step.key} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`h-px w-6 sm:w-10 transition-colors duration-500 ${
                  done ? "bg-emerald-500" : "bg-zinc-800"
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all duration-500 ${
                active
                  ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-sm shadow-emerald-500/10"
                  : done
                  ? "text-emerald-500"
                  : "text-zinc-600"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <Icon className="h-3 w-3" />
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/* ─── component ────────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════ */

export function PaperTradeDemo() {
  const { address: walletAddress, isConnected } = useAccount();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [phase, setPhase] = useState<DemoPhase>("discover");
  const [error, setError] = useState<string | null>(null);
  const [guestMode, setGuestMode] = useState(false);

  const isGuest = guestMode && !isConnected;
  const address = isGuest ? GUEST_ADDRESS : walletAddress;

  // Identity + reputation
  const [identity, setIdentity] = useState<L3Identity | null>(null);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [sessionKey, setSessionKey] = useState<SessionKeyInfo | null>(null);

  // Strategy selection
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [hypotheticalUsd, setHypotheticalUsd] = useState<number | null>(null);

  // Execution
  const [execution, setExecution] = useState<ExecutionResult | null>(null);

  // Live tracking state
  const [liveValue, setLiveValue] = useState(0);
  const [livePnl, setLivePnl] = useState(0);
  const [livePnlPct, setLivePnlPct] = useState(0);
  const [livePositions, setLivePositions] = useState(0);
  const [proofCount] = useState(0);
  const [snapshotCount, setSnapshotCount] = useState(0);

  // Transition animation
  const [transitioning, setTransitioning] = useState(false);

  const smoothTransition = useCallback((to: DemoPhase) => {
    setTransitioning(true);
    setTimeout(() => {
      setPhase(to);
      setTransitioning(false);
    }, 300);
  }, []);

  /* ── guest onboard — instant with seeded data ── */
  const handleGuestOnboard = useCallback(() => {
    setGuestMode(true);
    setIdentity(GUEST_IDENTITY);
    setReputation(GUEST_REPUTATION);
    setSessionKey(GUEST_SESSION_KEY);
    smoothTransition("home");
  }, [smoothTransition]);

  /* ── real onboard: reputation + L3 address + session ── */
  const handleOnboard = useCallback(async () => {
    if (!walletAddress) return;
    setPhase("onboarding");
    setError(null);
    try {
      const res = await apiFetch<OnboardResponse>("/api/v1/paper-trade/onboard", {
        method: "POST",
        body: JSON.stringify({ wallet_address: walletAddress }),
        timeoutMs: 60_000,
      });

      const id: L3Identity = {
        wallet_address: res.wallet_address,
        l3_address: res.l3_address,
        session_id: res.session_id,
        session_created_at: res.session_created_at,
        fico_score: res.reputation?.fico_score,
        fico_tier: res.reputation?.fico_tier,
        credit_class: res.reputation?.credit_class,
        credit_confidence: res.reputation?.credit_confidence,
        defi_veteran_score: res.reputation?.defi_veteran_score,
        recommended_tier: res.reputation?.recommended_tier,
        tier_reasoning: res.reputation?.tier_reasoning,
        profile_hash: res.reputation?.profile_hash,
        ezkl_ready: res.reputation?.ezkl_ready,
      };
      setIdentity(id);
      if (res.reputation) setReputation(res.reputation);
      if (res.session_key) setSessionKey(res.session_key);
      smoothTransition("home");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to onboard");
      setPhase("discover");
    }
  }, [walletAddress, smoothTransition]);

  /* ── execute selected strategy on paper ── */
  const handleExecute = useCallback(async () => {
    if (!address || !selectedProfile) return;
    setPhase("executing");
    setError(null);

    // Guest mode: simulate instantly
    if (isGuest) {
      await new Promise((r) => setTimeout(r, 1500));
      const exec = { ...GUEST_EXECUTION, snapshot: { ...GUEST_EXECUTION.snapshot } };
      exec.snapshot.total_value_usd = hypotheticalUsd ?? 10_000;
      setExecution(exec);
      setLiveValue(exec.snapshot.total_value_usd);
      setLivePositions(exec.positions_opened);
      setSnapshotCount(1);
      smoothTransition("live");
      return;
    }

    try {
      const body: Record<string, unknown> = {
        wallet_address: address,
        risk_profile: selectedProfile,
      };
      if (hypotheticalUsd) body.hypothetical_usd = hypotheticalUsd;

      const res = await apiFetch<SimulateAndExecuteResponse>(
        "/api/v1/paper-trade/simulate-and-execute",
        {
          method: "POST",
          body: JSON.stringify(body),
          timeoutMs: 60_000,
        },
      );

      setExecution(res.execution);
      setLiveValue(res.execution.snapshot.total_value_usd);
      setLivePositions(res.execution.positions_opened);
      setSnapshotCount(1);
      smoothTransition("live");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to execute paper trade");
      setPhase("home");
    }
  }, [address, selectedProfile, hypotheticalUsd, isGuest, smoothTransition]);

  /* ── strategy selected callback ── */
  const handleStrategySelected = useCallback(
    (profile: string, _strategy: { portfolio_value_usd: number }) => {
      setSelectedProfile(profile);
    },
    [],
  );

  /* ── PnL update callback ── */
  const handlePnLUpdate = useCallback(
    (data: {
      value: number;
      pnl: number;
      pnlPct: number;
      positionCount: number;
    }) => {
      setLiveValue(data.value);
      setLivePnl(data.pnl);
      setLivePnlPct(data.pnlPct);
      setLivePositions(data.positionCount);
    },
    [],
  );

  const reset = () => {
    setPhase("discover");
    setIdentity(null);
    setReputation(null);
    setSelectedProfile(null);
    setHypotheticalUsd(null);
    setExecution(null);
    setError(null);
    setSessionKey(null);
    setGuestMode(false);
    setLiveValue(0);
    setLivePnl(0);
    setLivePnlPct(0);
    setLivePositions(0);
    setSnapshotCount(0);
  };

  /* ═══════════════════════════════════════════════════════════════════ */
  /* ─── render ─────────────────────────────────────────────────────── */
  /* ═══════════════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-500">
          Capital OS — Live Demo
        </p>
        <h2 className="text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
          Your DeFi Brain.
          <br className="hidden sm:block" /> Reputation. Strategy. Proofs.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Explore AI-scored pools → get an L3 identity → compare strategies →
          execute on paper → track P&amp;L → shield capital → generate ZK proofs.
          {!isConnected && !isGuest && (
            <span className="ml-1 text-cyan-400">No wallet needed to start.</span>
          )}
        </p>
      </div>

      {/* ── Progress stepper ── */}
      <PhaseStepper current={phase} />

      {/* ── Guest banner ── */}
      {isGuest && (
        <div className="mx-auto flex max-w-lg items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <Eye className="h-3.5 w-3.5" />
            <span>Guest preview — seeded demo data</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsModalOpen(true)}
              className="text-[10px] text-amber-400 hover:text-amber-200 underline"
            >
              Connect wallet
            </button>
            <button
              onClick={reset}
              className="text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              Exit
            </button>
          </div>
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-auto flex max-w-lg items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Phase wrapper with fade transition ── */}
      <div
        className={`transition-all duration-300 ${
          transitioning ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
        }`}
      >
        {/* ═══════ Phase: DISCOVER — Onboard entry ═══════ */}
        {phase === "discover" && (
          <div className="space-y-5">
            {/* Context bridge from Pool Intelligence section above */}
            <div className="mx-auto max-w-lg rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 text-center">
              <div className="mb-3 flex items-center justify-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-zinc-200">Proof-Attested Data Feeds</p>
                  <p className="text-[10px] text-zinc-500">
                    Pool intelligence above is verified by zkML proofs on-chain
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2 text-[10px]">
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 text-emerald-400">IL Predictor</span>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 text-emerald-400">Yield Check</span>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 text-emerald-400">Slippage Guard</span>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-0.5 text-cyan-400">Strategy Compliance</span>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-0.5 text-cyan-400">Execution Quality</span>
              </div>
            </div>

            {/* ── CTA: Connect wallet or try as guest ── */}
            <div className="flex flex-col items-center gap-3">
              {isConnected && walletAddress ? (
                <button
                  onClick={handleOnboard}
                  className="group inline-flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-8 py-4 text-base font-semibold text-emerald-400 transition-all hover:border-emerald-400 hover:bg-emerald-600/20 hover:shadow-lg hover:shadow-emerald-500/10"
                >
                  <Fingerprint className="h-5 w-5" />
                  Onboard to Capital OS
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="group inline-flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-8 py-4 text-base font-semibold text-emerald-400 transition-all hover:border-emerald-400 hover:bg-emerald-600/20 hover:shadow-lg hover:shadow-emerald-500/10"
                  >
                    <Wallet className="h-5 w-5" />
                    Connect Wallet
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </button>
                  <button
                    onClick={handleGuestOnboard}
                    className="group inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/50 px-6 py-4 text-sm text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200"
                  >
                    <Eye className="h-4 w-4" />
                    Try as Guest
                  </button>
                </div>
              )}
              <p className="text-[10px] text-zinc-600">
                Scans reputation · Assigns L3 address · Issues session key ·
                Creates paper trading session · No tx required
              </p>
            </div>
          </div>
        )}

        {/* ═══════ Phase: ONBOARDING — loading ═══════ */}
        {phase === "onboarding" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="relative">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
              <Fingerprint className="absolute inset-0 m-auto h-5 w-5 text-emerald-400/50" />
            </div>
            <p className="text-sm text-zinc-400">
              Scanning reputation &amp; provisioning L3 identity for{" "}
              <span className="font-mono text-zinc-300">
                {walletAddress?.slice(0, 6)}…{walletAddress?.slice(-4)}
              </span>
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-[10px] text-zinc-600">
              <span className="rounded-full border border-zinc-800 px-2 py-0.5">Behavioral signals</span>
              <span className="rounded-full border border-zinc-800 px-2 py-0.5">FICO scoring</span>
              <span className="rounded-full border border-zinc-800 px-2 py-0.5">L3 address derivation</span>
              <span className="rounded-full border border-zinc-800 px-2 py-0.5">Session creation</span>
            </div>
          </div>
        )}

        {/* ═══════ Phase: HOME — multi-panel identity + strategy ═══════ */}
        {phase === "home" && identity && (() => {
          const homePanels: PanelDef[] = [
            {
              id: "identity",
              title: "Identity",
              accent: "text-amber-400",
              icon: <Fingerprint className="h-3 w-3 text-amber-400" />,
              pinned: true,
              content: (
                <CapitalOSHome
                  identity={identity}
                  sessionValue={0}
                  sessionPnl={0}
                  sessionPnlPct={0}
                  positionCount={0}
                  proofCount={0}
                  snapshotCount={0}
                />
              ),
            },
            {
              id: "strategy",
              title: "Strategy Lab",
              accent: "text-cyan-400",
              icon: <Cpu className="h-3 w-3 text-cyan-400" />,
              pinned: true,
              content: (
                <div className="space-y-4 p-4">
                  {/* Capital picker */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-400">
                      Select hypothetical capital
                      <span className="ml-2 text-[10px] font-normal text-zinc-600">
                        (or skip to use real portfolio)
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {CAPITAL_AMOUNTS.map((amt) => (
                        <button
                          key={amt}
                          onClick={() => setHypotheticalUsd(amt)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                            hypotheticalUsd === amt
                              ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-400"
                          }`}
                        >
                          {amt >= 1_000
                            ? `$${(amt / 1_000).toFixed(0)}k`
                            : `$${amt}`}
                        </button>
                      ))}
                      {hypotheticalUsd && (
                        <button
                          onClick={() => setHypotheticalUsd(null)}
                          className="rounded-lg border border-zinc-700 px-2 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 3-way Strategy Comparison */}
                  <StrategyCompare
                    walletAddress={identity.wallet_address}
                    hypotheticalUsd={hypotheticalUsd ?? undefined}
                    onSelectStrategy={handleStrategySelected}
                  />

                  {/* Execute CTA */}
                  {selectedProfile && (
                    <div className="flex justify-center pt-2">
                      <button
                        onClick={handleExecute}
                        className="group inline-flex items-center gap-3 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30"
                      >
                        <Zap className="h-4 w-4" />
                        Execute {selectedProfile} on Paper
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                      </button>
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: "session-key",
              title: "Session Key",
              accent: "text-amber-400",
              icon: <Key className="h-3 w-3 text-amber-400" />,
              content: (
                <SessionWallet
                  walletAddress={identity.wallet_address}
                  sessionId={identity.session_id}
                  l3Address={identity.l3_address}
                  initialKey={sessionKey}
                  onKeyIssued={setSessionKey}
                />
              ),
            },
            {
              id: "stream",
              title: "Activity",
              accent: "text-cyan-400",
              icon: <Activity className="h-3 w-3 text-cyan-400" />,
              defaultCollapsed: true,
              content: (
                <IntelligentStream walletAddress={identity.wallet_address} pollIntervalMs={10000} />
              ),
            },
            ...(reputation
              ? [{
                  id: "reputation",
                  title: "Reputation",
                  accent: "text-emerald-400",
                  icon: <Star className="h-3 w-3 text-emerald-400" />,
                  defaultCollapsed: true,
                  content: <ReputationProfile data={reputation} />,
                }]
              : []),
          ];

          return (
            <div className="mx-auto max-w-6xl space-y-4">
              <MultiPanelLayout panels={homePanels} defaultLayout="grid" />
            </div>
          );
        })()}

        {/* ═══════ Phase: EXECUTING — loading ═══════ */}
        {phase === "executing" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="relative">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
              <Zap className="absolute inset-0 m-auto h-5 w-5 text-emerald-400/50" />
            </div>
            <p className="text-sm text-zinc-400">
              Opening paper positions &amp; settling snapshot to L3…
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-[10px] text-zinc-600">
              <span className="rounded-full border border-zinc-800 px-2 py-0.5">{selectedProfile} strategy</span>
              <span className="rounded-full border border-zinc-800 px-2 py-0.5">Live pool APYs</span>
              <span className="rounded-full border border-zinc-800 px-2 py-0.5">Privacy-preserving fact hash</span>
              {hypotheticalUsd && (
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-emerald-400">
                  {fmtUsd(hypotheticalUsd)} hypothetical
                </span>
              )}
            </div>
          </div>
        )}

        {/* ═══════ Phase: LIVE — full Capital OS terminal panels ═══════ */}
        {phase === "live" && identity && execution && (() => {
          const livePanels: PanelDef[] = [
            {
              id: "identity",
              title: "Identity",
              accent: "text-amber-400",
              icon: <Fingerprint className="h-3 w-3 text-amber-400" />,
              pinned: true,
              content: (
                <CapitalOSHome
                  identity={identity}
                  sessionValue={liveValue}
                  sessionPnl={livePnl}
                  sessionPnlPct={livePnlPct}
                  positionCount={livePositions}
                  proofCount={proofCount}
                  snapshotCount={snapshotCount}
                />
              ),
            },
            {
              id: "pnl",
              title: "P&L Tracker",
              accent: "text-emerald-400",
              icon: <TrendingUp className="h-3 w-3 text-emerald-400" />,
              pinned: true,
              content: isGuest ? (
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Total Value</span>
                    <span className="font-mono text-sm font-bold text-zinc-100">{fmtUsd(liveValue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Unrealized P&L</span>
                    <span className="font-mono text-sm text-emerald-400">+$0.00 (0.00%)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Positions</span>
                    <span className="font-mono text-sm text-zinc-300">{livePositions}</span>
                  </div>
                  <p className="text-[10px] text-zinc-600 text-center pt-2 border-t border-zinc-800">
                    Guest mode — connect wallet for live P&amp;L tracking
                  </p>
                </div>
              ) : (
                <PnLTracker
                  sessionId={execution.session_id}
                  onUpdate={handlePnLUpdate}
                  pollInterval={30_000}
                />
              ),
            },
            {
              id: "settlement",
              title: "Settlement",
              accent: "text-cyan-400",
              icon: <Layers className="h-3 w-3 text-cyan-400" />,
              pinned: true,
              content: (
                <div className="space-y-4 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Paper Trade Executed
                    </span>
                    <span className="ml-auto text-[10px] text-zinc-500">
                      {execution.positions_opened} positions · {selectedProfile}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Snapshot Hash</p>
                      <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-400">
                        {execution.snapshot?.snapshot_hash ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3 w-3 text-cyan-400" />
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-cyan-400">L3 Settlement</p>
                        <span className="ml-auto rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                          {execution.l3_settlement?.status ?? "pending"}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-500">
                        Fact: <span className="font-mono text-zinc-400">{truncHash(execution.l3_settlement?.fact_hash ?? "", 10)}</span>
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        Batch: <span className="font-mono text-zinc-400">{execution.l3_settlement?.batch_item_id ?? "—"}</span>
                      </p>
                    </div>
                  </div>
                </div>
              ),
            },
            {
              id: "session-key",
              title: "Session Key",
              accent: "text-amber-400",
              icon: <Key className="h-3 w-3 text-amber-400" />,
              content: (
                <SessionWallet
                  walletAddress={identity.wallet_address}
                  sessionId={identity.session_id}
                  l3Address={identity.l3_address}
                  initialKey={sessionKey}
                  onKeyIssued={setSessionKey}
                />
              ),
            },
            {
              id: "dark-vault",
              title: "Dark Vault",
              accent: "text-violet-400",
              icon: <Lock className="h-3 w-3 text-violet-400" />,
              content: (
                <DarkVaultPanel
                  walletAddress={identity.wallet_address}
                  sessionId={identity.session_id}
                />
              ),
            },
            {
              id: "proof",
              title: "ZK Proof",
              accent: "text-fuchsia-400",
              icon: <ShieldCheck className="h-3 w-3 text-fuchsia-400" />,
              content: (
                <ProofOfPerformance
                  walletAddress={identity.wallet_address}
                  sessionId={identity.session_id}
                />
              ),
            },
            {
              id: "stream",
              title: "Activity Stream",
              accent: "text-cyan-400",
              icon: <Activity className="h-3 w-3 text-cyan-400" />,
              content: (
                <IntelligentStream walletAddress={identity.wallet_address} pollIntervalMs={8000} />
              ),
            },
            ...(reputation
              ? [{
                  id: "reputation",
                  title: "Reputation",
                  accent: "text-emerald-400",
                  icon: <Star className="h-3 w-3 text-emerald-400" />,
                  defaultCollapsed: true,
                  content: <ReputationProfile data={reputation} />,
                }]
              : []),
          ];

          return (
            <div className="mx-auto max-w-6xl space-y-4">
              <MultiPanelLayout panels={livePanels} defaultLayout="grid" />

              {/* Reset */}
              <div className="flex justify-center pt-2">
                <button
                  onClick={reset}
                  className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  ← Start over
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Wallet modal ── */}
      <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
