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
} from "lucide-react";
import { WalletModal } from "@/components/zkdefi/WalletModal";
import { ReputationProfile, type ReputationData } from "@/components/marketing/ReputationProfile";
import { CapitalOSHome, type L3Identity } from "@/components/marketing/CapitalOSHome";
import { StrategyCompare } from "@/components/marketing/StrategyCompare";
import { PnLTracker } from "@/components/marketing/PnLTracker";
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
}

/**
 * Demo phases — Capital OS unified flow:
 *  idle        → wallet not connected or not started
 *  onboarding  → calling /onboard (reputation + L3 address + session)
 *  home        → identity home + strategy comparison + capital picker
 *  executing   → paper executing the selected strategy
 *  live        → running — PnL tracker + identity home + reputation
 */
type DemoPhase = "idle" | "onboarding" | "home" | "executing" | "live";

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

/* ─── component ────────────────────────────────────────────────────── */

export function PaperTradeDemo() {
  const { address, isConnected } = useAccount();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [phase, setPhase] = useState<DemoPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Identity + reputation
  const [identity, setIdentity] = useState<L3Identity | null>(null);
  const [reputation, setReputation] = useState<ReputationData | null>(null);

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

  /* ── onboard: reputation + L3 address + session ── */
  const handleOnboard = useCallback(async () => {
    if (!address) return;
    setPhase("onboarding");
    setError(null);
    try {
      const res = await apiFetch<OnboardResponse>("/api/v1/paper-trade/onboard", {
        method: "POST",
        body: JSON.stringify({ wallet_address: address }),
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
      setPhase("home");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to onboard");
      setPhase("idle");
    }
  }, [address]);

  /* ── execute selected strategy on paper ── */
  const handleExecute = useCallback(async () => {
    if (!address || !selectedProfile) return;
    setPhase("executing");
    setError(null);
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
      setPhase("live");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to execute paper trade");
      setPhase("home");
    }
  }, [address, selectedProfile, hypotheticalUsd]);

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
    setPhase("idle");
    setIdentity(null);
    setReputation(null);
    setSelectedProfile(null);
    setHypotheticalUsd(null);
    setExecution(null);
    setError(null);
    setLiveValue(0);
    setLivePnl(0);
    setLivePnlPct(0);
    setLivePositions(0);
    setSnapshotCount(0);
  };

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
          Connect your wallet → get an L3 identity → compare strategies against
          live pools → execute on paper → track P&amp;L → generate ZK proofs.
          All from one unified demo.
        </p>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-auto flex max-w-lg items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ═══════ Phase: IDLE — Connect / Onboard ═══════ */}
      {phase === "idle" && (
        <div className="flex flex-col items-center gap-4">
          {isConnected && address ? (
            <button
              onClick={handleOnboard}
              className="group inline-flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-8 py-4 text-base font-semibold text-emerald-400 transition-all hover:border-emerald-400 hover:bg-emerald-600/20 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <Fingerprint className="h-5 w-5" />
              Onboard to Capital OS
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          ) : (
            <>
              <button
                onClick={() => setIsModalOpen(true)}
                className="group inline-flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-8 py-4 text-base font-semibold text-emerald-400 transition-all hover:border-emerald-400 hover:bg-emerald-600/20 hover:shadow-lg hover:shadow-emerald-500/10"
              >
                <Wallet className="h-5 w-5" />
                Connect Wallet to Try
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
              <WalletModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
              />
            </>
          )}
          <p className="text-[10px] text-zinc-600">
            Scans reputation · Assigns L3 address · Creates paper trading
            session · No tx required
          </p>
        </div>
      )}

      {/* ═══════ Phase: ONBOARDING — loading ═══════ */}
      {phase === "onboarding" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-sm text-zinc-400">
            Scanning reputation &amp; provisioning L3 identity for{" "}
            <span className="font-mono text-zinc-300">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </span>
          </p>
          <p className="text-[10px] text-zinc-600">
            Behavioral signals · FICO scoring · L3 address derivation · Session
            creation
          </p>
        </div>
      )}

      {/* ═══════ Phase: HOME — identity + strategy compare + capital picker ═══════ */}
      {phase === "home" && identity && (
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Dark Ledger: Identity Home */}
          <CapitalOSHome
            identity={identity}
            sessionValue={0}
            sessionPnl={0}
            sessionPnlPct={0}
            positionCount={0}
            proofCount={0}
            snapshotCount={0}
          />

          {/* Reputation Profile */}
          {reputation && <ReputationProfile data={reputation} />}

          {/* Capital picker for wallets with no positions */}
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/20 px-5 py-4">
            <p className="text-xs font-semibold text-zinc-400">
              Select hypothetical capital
              <span className="ml-2 text-[10px] font-normal text-zinc-600">
                (or skip to use your real portfolio)
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {CAPITAL_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setHypotheticalUsd(amt)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all ${
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
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300"
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
                className="group inline-flex items-center gap-3 rounded-xl bg-emerald-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30"
              >
                <Zap className="h-5 w-5" />
                Execute {selectedProfile} on Paper + Settle to L3
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════ Phase: EXECUTING — loading ═══════ */}
      {phase === "executing" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-sm text-zinc-400">
            Opening paper positions &amp; settling snapshot to L3…
          </p>
          <p className="text-[10px] text-zinc-600">
            {selectedProfile} strategy · Live pool APYs · Privacy-preserving
            fact hash
          </p>
        </div>
      )}

      {/* ═══════ Phase: LIVE — identity + PnL + settlement + reputation ═══════ */}
      {phase === "live" && identity && execution && (
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Dark Ledger: Identity Home (live stats) */}
          <CapitalOSHome
            identity={identity}
            sessionValue={liveValue}
            sessionPnl={livePnl}
            sessionPnlPct={livePnlPct}
            positionCount={livePositions}
            proofCount={proofCount}
            snapshotCount={snapshotCount}
          />

          {/* Live PnL Tracker with auto-polling */}
          <PnLTracker
            sessionId={execution.session_id}
            onUpdate={handlePnLUpdate}
            pollInterval={30_000}
          />

          {/* Settlement receipt */}
          <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-5">
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
              {/* Snapshot hash */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
                  Snapshot Hash
                </p>
                <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-400">
                  {execution.snapshot.snapshot_hash}
                </p>
              </div>

              {/* L3 Settlement */}
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-4 py-2">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3 w-3 text-cyan-400" />
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-cyan-400">
                    L3 Settlement
                  </p>
                  <span className="ml-auto rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                    {execution.l3_settlement.status}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">
                  Fact:{" "}
                  <span className="font-mono text-zinc-400">
                    {truncHash(execution.l3_settlement.fact_hash, 10)}
                  </span>
                </p>
                <p className="text-[10px] text-zinc-500">
                  Batch:{" "}
                  <span className="font-mono text-zinc-400">
                    {execution.l3_settlement.batch_item_id}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Reputation Profile */}
          {reputation && <ReputationProfile data={reputation} />}

          {/* Reset */}
          <div className="flex justify-center pt-2">
            <button
              onClick={reset}
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              ← Start over with another wallet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
