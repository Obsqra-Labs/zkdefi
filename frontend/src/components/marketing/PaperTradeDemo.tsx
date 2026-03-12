"use client";

import { useState, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import {
  Wallet,
  ArrowRight,
  TrendingUp,
  Shield,
  Layers,
  Zap,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Copy,
} from "lucide-react";
import { WalletModal } from "@/components/zkdefi/WalletModal";
import { ReputationProfile, ReputationData } from "@/components/marketing/ReputationProfile";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

interface PortfolioSummary {
  wallet_address: string;
  total_value_usd: number;
  position_count: number;
  protocols_found: string[];
}

interface ProposedMove {
  action: string;
  protocol: string;
  pool_name: string;
  asset_symbol: string;
  amount_usd: number;
  expected_apy: number;
  risk_score: number;
  reasoning: string;
}

interface StrategyProposal {
  risk_profile: string;
  moves_count?: number;
  expected_blended_apy: number;
  expected_annual_yield_usd: number;
  reasoning: string;
  proposal_hash: string;
  moves: ProposedMove[];
  pool_count?: number;
  protocol_count?: number;
  portfolio_value_usd?: number;
}

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

interface SimulateResponse {
  portfolio: PortfolioSummary;
  proposal: StrategyProposal;
  is_hypothetical?: boolean;
}

interface SimulateAndExecuteResponse {
  portfolio: PortfolioSummary;
  proposal: StrategyProposal;
  execution: ExecutionResult;
  is_hypothetical?: boolean;
}

type DemoPhase = "idle" | "scanning" | "empty-portfolio" | "proposal" | "executing" | "executed";

/* ─── helpers ──────────────────────────────────────────────────────── */

const CAPITAL_AMOUNTS = [1_000, 5_000, 10_000, 50_000, 100_000] as const;

/* ─── helpers ──────────────────────────────────────────────────────── */

const ACTION_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  deposit:  { bg: "bg-emerald-500/10", text: "text-emerald-400", icon: "↗" },
  stake:    { bg: "bg-cyan-500/10",    text: "text-cyan-400",    icon: "⚡" },
  lp:       { bg: "bg-violet-500/10",  text: "text-violet-400",  icon: "💧" },
  hold:     { bg: "bg-zinc-500/10",    text: "text-zinc-400",    icon: "🔒" },
};

const PROTOCOL_COLORS: Record<string, string> = {
  ekubo:  "text-cyan-400",
  vesu:   "text-emerald-400",
  endur:  "text-amber-400",
  nostra: "text-rose-400",
  troves: "text-indigo-400",
  wallet: "text-zinc-400",
};

function fmtUsd(n: number): string {
  return n < 0.01 && n > 0
    ? "<$0.01"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
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
  const [riskProfile, setRiskProfile] = useState<"conservative" | "balanced" | "aggressive">("balanced");

  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [proposal, setProposal] = useState<StrategyProposal | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [isHypothetical, setIsHypothetical] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);

  /* ── scan + propose ── */
  const handleScan = useCallback(async (hypotheticalUsd?: number) => {
    if (!address) return;
    setPhase("scanning");
    setError(null);
    try {
      const body: Record<string, unknown> = {
        wallet_address: address,
        risk_profile: riskProfile,
      };
      if (hypotheticalUsd) body.hypothetical_usd = hypotheticalUsd;

      // Fire portfolio scan + reputation scan in parallel
      const [res, repData] = await Promise.all([
        apiFetch<SimulateResponse>("/api/v1/paper-trade/simulate", {
          method: "POST",
          body: JSON.stringify(body),
          timeoutMs: 60_000,
        }),
        apiFetch<ReputationData>("/api/v1/paper-trade/reputation-scan", {
          method: "POST",
          body: JSON.stringify({ wallet_address: address }),
          timeoutMs: 60_000,
        }).catch((err) => {
          console.warn("Reputation scan failed (non-blocking):", err);
          return null;
        }),
      ]);

      setPortfolio(res.portfolio);
      setProposal(res.proposal);
      setIsHypothetical(!!res.is_hypothetical);
      if (repData) setReputation(repData);

      // If portfolio is empty and no hypothetical was used, show capital picker
      if (
        !hypotheticalUsd &&
        res.portfolio.total_value_usd <= 0.01 &&
        res.proposal.moves?.length === 0
      ) {
        setPhase("empty-portfolio");
      } else {
        setPhase("proposal");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to scan portfolio");
      setPhase("idle");
    }
  }, [address, riskProfile]);

  /* ── execute on paper + settle to L3 ── */
  const handleExecute = useCallback(async () => {
    if (!address) return;
    setPhase("executing");
    setError(null);
    try {
      const body: Record<string, unknown> = {
        wallet_address: address,
        risk_profile: riskProfile,
      };
      // If running in hypothetical mode, propagate the capital amount
      if (isHypothetical && proposal?.portfolio_value_usd) {
        body.hypothetical_usd = proposal.portfolio_value_usd;
      }

      const res = await apiFetch<SimulateAndExecuteResponse>("/api/v1/paper-trade/simulate-and-execute", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      });
      setPortfolio(res.portfolio);
      setProposal(res.proposal);
      setExecution(res.execution);
      setPhase("executed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to execute paper trade");
      setPhase("proposal");
    }
  }, [address, riskProfile, isHypothetical, proposal]);

  const reset = () => {
    setPhase("idle");
    setPortfolio(null);
    setProposal(null);
    setExecution(null);
    setError(null);
    setIsHypothetical(false);
    setReputation(null);
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-500">
          Connect &amp; Import — Live
        </p>
        <h2 className="text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
          See what Capital OS would do<br className="hidden sm:block" /> with your portfolio.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Connect your wallet. We scan your real Starknet positions, then the agent proposes
          an allocation strategy — execute it on paper, settle to L3. Your keys never leave your wallet.
        </p>
      </div>

      {/* ── Risk profile selector ── */}
      {phase === "idle" && (
        <div className="mx-auto flex max-w-md items-center justify-center gap-2">
          {(["conservative", "balanced", "aggressive"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setRiskProfile(p)}
              className={`rounded-lg border px-4 py-2 text-xs font-medium capitalize transition-all ${
                riskProfile === p
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                  : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-auto flex max-w-lg items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Phase: Idle — Connect / Scan ── */}
      {phase === "idle" && (
        <div className="flex justify-center">
          {isConnected && address ? (
            <button
              onClick={() => handleScan()}
              className="group inline-flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-8 py-4 text-base font-semibold text-emerald-400 transition-all hover:border-emerald-400 hover:bg-emerald-600/20 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <TrendingUp className="h-5 w-5" />
              Scan My Portfolio
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
              <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
            </>
          )}
        </div>
      )}

      {/* ── Phase: Scanning ── */}
      {phase === "scanning" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-sm text-zinc-400">
            Reading on-chain positions &amp; behavioral signals for{" "}
            <span className="font-mono text-zinc-300">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
            …
          </p>
          <p className="text-[10px] text-zinc-600">
            Scanning Vesu · Endur · Nostra · Ekubo · Troves + wallet tokens + reputation signals
          </p>
        </div>
      )}

      {/* ── Phase: Empty Portfolio — pick hypothetical capital ── */}
      {phase === "empty-portfolio" && (
        <div className="mx-auto max-w-lg space-y-5 py-4">
          {/* Reputation Profile (even for empty wallets, show behavioral signals) */}
          {reputation && reputation.nonce > 0 && (
            <div className="mx-auto max-w-lg">
              <ReputationProfile data={reputation} />
            </div>
          )}

          <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 px-6 py-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Wallet className="h-6 w-6 text-amber-400" />
            </div>
            <p className="text-sm font-medium text-zinc-200">
              No DeFi positions detected
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Your wallet is connected but has no active lending, staking, or LP positions on Starknet.
              Pick a hypothetical amount to see what the agent would do with it — using real live pool data.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {CAPITAL_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => handleScan(amt)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-all hover:border-emerald-500/50 hover:bg-emerald-600/10 hover:text-emerald-400 hover:shadow-md hover:shadow-emerald-500/5"
              >
                {amt >= 1_000 ? `$${(amt / 1_000).toFixed(0)}k` : `$${amt}`}
              </button>
            ))}
          </div>

          <p className="text-center text-[10px] text-zinc-600">
            Real pools · Real APYs · Paper execution only — nothing leaves your wallet
          </p>
        </div>
      )}

      {/* ── Phase: Proposal — portfolio + strategy ── */}
      {(phase === "proposal" || phase === "executing" || phase === "executed") && portfolio && proposal && (
        <div className="mx-auto max-w-4xl space-y-6">

          {/* Reputation Profile (shown if scan succeeded) */}
          {reputation && reputation.signals.length > 0 && (
            <ReputationProfile data={reputation} />
          )}

          {/* Portfolio summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                {isHypothetical ? "Hypothetical Capital" : "Your Portfolio"}
              </p>
              <p className="mt-1 text-2xl font-bold text-zinc-100">
                {fmtUsd(isHypothetical ? (proposal?.portfolio_value_usd ?? 0) : (portfolio?.total_value_usd ?? 0))}
              </p>
              <p className="text-xs text-zinc-500">
                {isHypothetical ? (
                  <span className="text-amber-400/80">Simulated • real pools &amp; APYs</span>
                ) : (
                  <>{portfolio?.position_count ?? 0} positions on {portfolio?.protocols_found?.join(", ") ?? ""}</>
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Proposed — {proposal.risk_profile}
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-400">
                {fmtPct(proposal.expected_blended_apy)} <span className="text-lg font-normal text-zinc-500">APY</span>
              </p>
              <p className="text-xs text-zinc-500">
                ~{fmtUsd(proposal.expected_annual_yield_usd)}/yr projected
              </p>
            </div>
          </div>

          {/* Proposal reasoning */}
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-xs leading-relaxed text-zinc-400">
            <span className="font-semibold text-zinc-300">Agent reasoning:</span>{" "}
            {proposal.reasoning}
          </p>

          {/* Strategy Moves grid */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-300">
                Proposed Moves <span className="text-zinc-600">({proposal.moves?.length ?? proposal.moves_count ?? 0})</span>
              </h3>
              <span className="rounded border border-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-600">
                {truncHash(proposal.proposal_hash)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {proposal.moves.map((move, i) => {
                const style = ACTION_STYLES[move.action] ?? ACTION_STYLES.hold;
                const protocolColor = PROTOCOL_COLORS[move.protocol] ?? "text-zinc-400";
                return (
                  <div
                    key={i}
                    className={`rounded-xl border border-zinc-800 ${style.bg} p-4 transition-colors hover:border-zinc-700`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`text-xs font-bold uppercase tracking-wider ${style.text}`}>
                        {style.icon} {move.action}
                      </span>
                      <span className="text-sm font-bold text-zinc-100">{fmtUsd(move.amount_usd)}</span>
                    </div>

                    <p className="text-sm font-medium text-zinc-200">{move.pool_name}</p>
                    <p className={`text-xs ${protocolColor}`}>{move.protocol} · {move.asset_symbol}</p>

                    <div className="mt-3 flex items-center gap-3">
                      <div className="rounded bg-zinc-800/60 px-2 py-0.5 text-[10px]">
                        <span className="text-zinc-500">APY </span>
                        <span className="font-bold text-emerald-400">{fmtPct(move.expected_apy)}</span>
                      </div>
                      <div className="rounded bg-zinc-800/60 px-2 py-0.5 text-[10px]">
                        <span className="text-zinc-500">Risk </span>
                        <span className={`font-bold ${move.risk_score <= 30 ? "text-emerald-400" : move.risk_score <= 55 ? "text-amber-400" : "text-rose-400"}`}>
                          {move.risk_score}/100
                        </span>
                      </div>
                    </div>

                    <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">{move.reasoning}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Execute on Paper / Settlement result */}
          {phase === "proposal" && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleExecute}
                className="group inline-flex items-center gap-3 rounded-xl bg-emerald-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30"
              >
                <Zap className="h-5 w-5" />
                Execute on Paper + Settle to L3
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          )}

          {phase === "executing" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
              <p className="text-sm text-zinc-400">
                Opening paper positions &amp; settling snapshot to L3…
              </p>
            </div>
          )}

          {/* ── Phase: Executed — show settlement receipt ── */}
          {phase === "executed" && execution && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-6">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                    Paper Trade Executed
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Session</p>
                    <p className="mt-1 font-mono text-sm text-zinc-200">{execution.session_id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Positions</p>
                    <p className="mt-1 text-sm text-zinc-200">{execution.positions_opened} opened</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Snapshot Value</p>
                    <p className="mt-1 text-sm text-zinc-200">{fmtUsd(execution.snapshot.total_value_usd)}</p>
                  </div>
                </div>

                {/* Snapshot hash */}
                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Snapshot Hash</p>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-300">
                    {execution.snapshot.snapshot_hash}
                  </p>
                </div>

                {/* L3 Settlement */}
                <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-cyan-400" />
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">
                      L3 Settlement
                    </p>
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      {execution.l3_settlement.status}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    <p className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-600">Fact hash:</span>
                      <span className="font-mono text-zinc-300">{truncHash(execution.l3_settlement.fact_hash, 12)}</span>
                    </p>
                    <p className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-600">Batch item:</span>
                      <span className="font-mono text-zinc-300">{execution.l3_settlement.batch_item_id}</span>
                    </p>
                  </div>
                  <p className="mt-2 text-[10px] text-zinc-600">
                    Privacy-preserving fact hash queued for Madara L3 batch settlement.
                    The snapshot hash is committed — the strategy stays private.
                  </p>
                </div>
              </div>

              {/* Reset button */}
              <div className="flex justify-center">
                <button
                  onClick={reset}
                  className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  ← Try another wallet or profile
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
