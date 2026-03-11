"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Vote,
  FileText,
  Plus,
  Loader2,
  AlertCircle,
  Shield,
  Clock,
  CheckCircle2,
  Zap,
  RefreshCw,
} from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api/client";
import { toastSuccess, toastError } from "@/lib/toast";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type ProposalStatus = "VOTING" | "PASSED" | "REJECTED" | "EXECUTED";
type ProposalType =
  | "emergency_pause"
  | "emergency_unpause"
  | "adapter_limit"
  | "whitelist_asset"
  | "blacklist_asset"
  | "set_lending_rate"
  | "set_borrower_criteria"
  | "set_pool_cap";

interface Proposal {
  id: number;
  title?: string;
  description?: string;
  proposal_type: ProposalType | string;
  status: ProposalStatus;
  votes_for: number;
  votes_against: number;
  voting_ends_at?: number;
  proposer?: string;
  target?: string;
  new_value?: number;
  executed?: boolean;
  passed?: boolean;
  created_at?: number;
}

interface VotingPowerData {
  voting_power?: number;
  tier?: number;
  tier_multiplier?: number;
  lp_usd?: number;
  lending_usd?: number;
  staking_usd?: number;
}

interface ReputationData {
  tier?: number;
  current_tier?: number;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TIER_MULTIPLIERS: Record<number, number> = { 0: 1.0, 1: 1.5, 2: 2.0 };

const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  emergency_pause: "Emergency Pause",
  emergency_unpause: "Emergency Unpause",
  adapter_limit: "Adapter Limit",
  whitelist_asset: "Whitelist Asset",
  blacklist_asset: "Blacklist Asset",
  set_lending_rate: "Set Lending Rate",
  set_borrower_criteria: "Set Borrower Criteria",
  set_pool_cap: "Set Pool Cap",
};

const PROPOSAL_TYPES: ProposalType[] = [
  "emergency_pause",
  "emergency_unpause",
  "adapter_limit",
  "whitelist_asset",
  "blacklist_asset",
  "set_lending_rate",
  "set_borrower_criteria",
  "set_pool_cap",
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatTimeRemaining(endsAt: number): string {
  const diff = Math.max(0, endsAt - Math.floor(Date.now() / 1000));
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.floor((diff % 3600) / 60)}m`;
}

function normalizeStatus(s: string | undefined): ProposalStatus {
  const v = (s ?? "").toUpperCase();
  if (v === "VOTING" || v === "ACTIVE") return "VOTING";
  if (v === "PASSED") return "PASSED";
  if (v === "REJECTED" || v === "FAILED") return "REJECTED";
  if (v === "EXECUTED") return "EXECUTED";
  return "VOTING";
}

function normalizeProposal(raw: Record<string, unknown>): Proposal {
  const executed = !!raw.executed;
  const passed = !!raw.passed;
  const endsAt = typeof raw.voting_ends_at === "number" ? raw.voting_ends_at : 0;
  const now = Math.floor(Date.now() / 1000);
  let status: ProposalStatus = "VOTING";
  if (executed) status = "EXECUTED";
  else if (passed) status = "PASSED";
  else if (endsAt > 0 && endsAt < now) status = "REJECTED";
  return {
    id: Number(raw.id) || 0,
    title: String(raw.title ?? raw.description ?? ""),
    description: String(raw.description ?? ""),
    proposal_type: String(raw.proposal_type ?? "adapter_limit"),
    status,
    votes_for: Number(raw.votes_for) || 0,
    votes_against: Number(raw.votes_against) || 0,
    voting_ends_at: endsAt || undefined,
    proposer: String(raw.proposer ?? ""),
    target: String(raw.target ?? ""),
    new_value: typeof raw.new_value === "number" ? raw.new_value : undefined,
    executed,
    passed,
    created_at: typeof raw.created_at === "number" ? raw.created_at : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* GovernTab                                                           */
/* ------------------------------------------------------------------ */

interface GovernTabProps {
  address: string;
}

export function GovernTab({ address }: GovernTabProps) {
  return (
    <div className="space-y-6">
      <VotingPowerSection address={address} />
      <ActiveProposalsSection address={address} />
      <CreateProposalSection address={address} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voting Power Section                                                */
/* ------------------------------------------------------------------ */

function VotingPowerSection({ address }: { address: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState(0);
  const [vp, setVp] = useState(0);
  const [lpValue, setLpValue] = useState(0);
  const [lendingSupplied, setLendingSupplied] = useState(0);
  const [stakedAmount, setStakedAmount] = useState(0);
  const [basePower, setBasePower] = useState(0);
  const [tierMult, setTierMult] = useState(1);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setLoading(true);
    try {
      const [repRes, vpRes] = await Promise.all([
        apiFetch<ReputationData>(`/api/v1/zkdefi/reputation/user/${address}`, { signal }).catch((): ReputationData => ({})),
        fetch(apiUrl(`/api/v1/dao/voting_power/${address}`), { signal }).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (signal?.aborted) return;

      const tierVal = Number(vpRes?.tier ?? repRes?.tier ?? repRes?.current_tier ?? 0);
      setTier(tierVal);
      setTierMult(Number(vpRes?.tier_multiplier ?? TIER_MULTIPLIERS[tierVal] ?? 1));

      const lpVal = Number(vpRes?.lp_usd ?? 0);
      const lendVal = Number(vpRes?.lending_usd ?? 0);
      const stakeVal = Number(vpRes?.staking_usd ?? 0);
      setLpValue(lpVal);
      setLendingSupplied(lendVal);
      setStakedAmount(stakeVal);

      const base = Math.sqrt(Math.max(0, lpVal + lendVal + stakeVal));
      setBasePower(Math.floor(base));

      if (vpRes && typeof vpRes.voting_power === "number") {
        setVp(Number(vpRes.voting_power || 0));
      } else {
        setVp(Math.floor(base * (TIER_MULTIPLIERS[tierVal] ?? 1)));
      }
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load voting power");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  if (loading) {
    return (
      <section className="glass rounded-xl p-5">
        <h3 className="text-sm font-medium text-violet-400 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4" /> Voting Power
        </h3>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="glass rounded-xl p-5 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-200">Voting Power</p>
          <p className="text-xs text-zinc-500">{error}</p>
        </div>
        <button onClick={() => load()} className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </section>
    );
  }

  const multLabel = `${tierMult.toFixed(1)}x`;

  return (
    <section className="glass rounded-xl p-5">
      <h3 className="text-sm font-medium text-violet-400 mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4" /> Voting Power
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <p className="text-zinc-500">LP position</p>
          <p className="text-zinc-200 font-medium">${lpValue.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-zinc-500">Lending supplied</p>
          <p className="text-zinc-200 font-medium">${lendingSupplied.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-zinc-500">Staked</p>
          <p className="text-zinc-200 font-medium">{stakedAmount.toFixed(2)} STRK</p>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-zinc-800 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">Base power (√total)</span>
          <span className="text-zinc-200">{basePower}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Tier multiplier (Tier {tier})</span>
          <span className="text-violet-400">{multLabel}</span>
        </div>
        <div className="flex justify-between font-medium">
          <span className="text-zinc-400">Final VP</span>
          <span className="text-violet-400 text-sm">{vp}</span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Active Proposals Section                                            */
/* ------------------------------------------------------------------ */

function ActiveProposalsSection({ address }: { address: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [votingPower, setVotingPower] = useState(0);

  const loadProposals = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setLoading(true);
    try {
      const list = await apiFetch<Proposal[] | { items?: Proposal[] }>("/api/v1/dao/proposals", { signal });
      const raw = (Array.isArray(list) ? list : (list as { items?: unknown[] })?.items ?? []) as Record<string, unknown>[];
      setProposals(raw.map(normalizeProposal));
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setProposals([]);
      setError(e instanceof Error ? e.message : "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    loadProposals(ac.signal);
    return () => ac.abort();
  }, [loadProposals]);

  useEffect(() => {
    const ac = new AbortController();
    apiFetch<VotingPowerData>(`/api/v1/dao/voting_power/${address}`, { signal: ac.signal })
      .then((res) => setVotingPower(res?.voting_power ?? 0))
      .catch(() => setVotingPower(0));
    return () => ac.abort();
  }, [address]);

  return (
    <section className="glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-violet-400 flex items-center gap-2">
          <FileText className="w-4 h-4" /> Active Proposals
        </h3>
        <button onClick={() => loadProposals()} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-3 flex items-center gap-2 text-amber-500 text-xs">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </div>
          )}
          {proposals.length === 0 ? (
            <p className="text-xs text-zinc-600 italic text-center py-4">No active proposals</p>
          ) : (
            <div className="space-y-3">
              {proposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  address={address}
                  votingPower={votingPower}
                  onRefresh={loadProposals}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Proposal Card                                                       */
/* ------------------------------------------------------------------ */

function ProposalCard({
  proposal,
  address,
  votingPower,
  onRefresh,
}: {
  proposal: Proposal;
  address: string;
  votingPower: number;
  onRefresh: () => void;
}) {
  const [voteDir, setVoteDir] = useState<"for" | "against" | null>(null);
  const [casting, setCasting] = useState(false);
  const [executing, setExecuting] = useState(false);

  const status = normalizeStatus(proposal.status);
  const title = proposal.title ?? proposal.description ?? `Proposal #${proposal.id}`;
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.proposal_type] ?? proposal.proposal_type;

  const statusColor = {
    VOTING: "text-violet-400 animate-pulse",
    PASSED: "text-emerald-500",
    REJECTED: "text-red-500",
    EXECUTED: "text-zinc-500",
  }[status];

  const handleCastVote = async () => {
    if (voteDir === null || casting) return;
    setCasting(true);
    try {
      const res = await apiFetch<{ proof_hash?: string }>("/api/v1/dao/vote/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposal.id,
          user_address: address,
          vote_direction: voteDir === "for" ? 1 : 0,
        }),
      });
      const proofTag = res?.proof_hash ? ` | proof: ${res.proof_hash.slice(0, 16)}…` : "";
      toastSuccess(`Vote cast successfully${proofTag}`);
      setVoteDir(null);
      onRefresh();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to cast vote");
    } finally {
      setCasting(false);
    }
  };

  const handleExecute = async () => {
    if (executing) return;
    setExecuting(true);
    try {
      await apiFetch(`/api/v1/dao/proposals/${proposal.id}/execute`, { method: "POST" });
      toastSuccess("Proposal executed");
      onRefresh();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to execute");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-zinc-200">#{proposal.id} — {title}</p>
          <span className="inline-block mt-1 px-2 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-400">{typeLabel}</span>
        </div>
        <span className={`text-xs font-medium ${statusColor}`}>{status}</span>
      </div>

      <div className="flex flex-wrap gap-4 text-xs">
        <span className="text-zinc-500">FOR: <span className="text-zinc-200">{proposal.votes_for}</span></span>
        <span className="text-zinc-500">AGAINST: <span className="text-zinc-200">{proposal.votes_against}</span></span>
        {proposal.voting_ends_at && status === "VOTING" && (
          <span className="text-zinc-500 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {formatTimeRemaining(proposal.voting_ends_at)}
          </span>
        )}
      </div>

      {status === "VOTING" && (
        <div className="pt-3 border-t border-zinc-800 space-y-2">
          <p className="text-[11px] text-zinc-500 flex items-center gap-1">
            <Shield className="w-3 h-3" /> ZK-private vote: direction hidden, power proven via Groth16
          </p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="radio" name={`vote-${proposal.id}`} checked={voteDir === "for"} onChange={() => setVoteDir("for")}
                className="rounded-full border-zinc-600 text-violet-500" />
              For
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="radio" name={`vote-${proposal.id}`} checked={voteDir === "against"} onChange={() => setVoteDir("against")}
                className="rounded-full border-zinc-600 text-violet-500" />
              Against
            </label>
            <button onClick={handleCastVote} disabled={voteDir === null || casting}
              className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5">
              {casting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Cast Vote
            </button>
          </div>
        </div>
      )}

      {status === "PASSED" && (
        <div className="pt-3 border-t border-zinc-800">
          <button onClick={handleExecute} disabled={executing}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5">
            {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Execute
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create Proposal Section                                             */
/* ------------------------------------------------------------------ */

function CreateProposalSection({ address }: { address: string }) {
  const [proposalType, setProposalType] = useState<ProposalType>("adapter_limit");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paramFields = getParamFields(proposalType);

  const handleSubmit = async () => {
    if (!description.trim()) { toastError("Enter description"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const parameters = buildParameters(proposalType, params);
      const targetAddress = String(parameters.target ?? parameters.token_address ?? parameters.adapter ?? "0x0");
      const newValue = typeof parameters.max_pct === "number"
        ? Math.round(parameters.max_pct * 100)
        : typeof parameters.new_value === "number" ? parameters.new_value : 0;

      await apiFetch("/api/v1/dao/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposer_address: address,
          proposal_type: proposalType,
          target_address: targetAddress,
          new_value: newValue,
          vote_duration_seconds: 604800,
        }),
      });
      toastSuccess("Proposal submitted");
      setDescription("");
      setParams({});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create proposal";
      setError(msg);
      toastError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="glass rounded-xl p-5">
      <h3 className="text-sm font-medium text-violet-400 mb-3 flex items-center gap-2">
        <Plus className="w-4 h-4" /> Create Proposal
      </h3>
      {error && (
        <div className="mb-3 flex items-center gap-2 text-red-500 text-xs">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">Type</label>
          <select value={proposalType} onChange={(e) => { setProposalType(e.target.value as ProposalType); setParams({}); }}
            className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500">
            {PROPOSAL_TYPES.map((t) => <option key={t} value={t}>{PROPOSAL_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Describe the proposal..."
            className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 text-xs focus:ring-2 focus:ring-violet-500/50 resize-none" />
        </div>
        {paramFields.map((f) => (
          <div key={f.key}>
            <label className="block text-[11px] text-zinc-500 mb-1">{f.label}</label>
            {f.type === "select" ? (
              <select value={params[f.key] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs focus:ring-2 focus:ring-violet-500/50">
                <option value="">Select...</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type={f.type} value={params[f.key] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} min={f.min} step={f.step}
                className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 text-xs focus:ring-2 focus:ring-violet-500/50" />
            )}
          </div>
        ))}
        <button onClick={handleSubmit} disabled={submitting || !description.trim()}
          className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium flex items-center justify-center gap-2">
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Submit Proposal
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Parameter field config                                              */
/* ------------------------------------------------------------------ */

interface ParamField {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  placeholder?: string;
  min?: number;
  step?: string;
  options?: { value: string; label: string }[];
}

function getParamFields(type: ProposalType): ParamField[] {
  switch (type) {
    case "emergency_pause":
      return [
        { key: "target", label: "Target", type: "text", placeholder: "Target address or system" },
        { key: "reason", label: "Reason", type: "text", placeholder: "Reason for pause" },
      ];
    case "emergency_unpause":
      return [{ key: "reason", label: "Reason", type: "text", placeholder: "Justification" }];
    case "adapter_limit":
      return [
        { key: "adapter", label: "Adapter", type: "select", options: [{ value: "ekubo", label: "Ekubo" }, { value: "lending", label: "Lending" }, { value: "staking", label: "Staking" }] },
        { key: "max_pct", label: "Max %", type: "number", placeholder: "0-100", min: 0, step: "0.1" },
      ];
    case "whitelist_asset":
      return [
        { key: "token_address", label: "Token Address", type: "text", placeholder: "0x..." },
        { key: "token_symbol", label: "Token Symbol", type: "text", placeholder: "USDC" },
      ];
    case "blacklist_asset":
      return [{ key: "token_address", label: "Token Address", type: "text", placeholder: "0x..." }];
    case "set_lending_rate":
      return [
        { key: "base_rate", label: "Base Rate (%)", type: "number", placeholder: "2.5", min: 0, step: "0.01" },
        { key: "slope", label: "Slope", type: "number", placeholder: "0.05", min: 0, step: "0.01" },
        { key: "kink", label: "Kink (%)", type: "number", placeholder: "80", min: 0, step: "1" },
      ];
    case "set_borrower_criteria":
      return [
        { key: "min_tier", label: "Min Tier", type: "select", options: [{ value: "0", label: "0" }, { value: "1", label: "1" }, { value: "2", label: "2" }] },
        { key: "min_proofs", label: "Min Proofs", type: "number", placeholder: "3", min: 0, step: "1" },
        { key: "min_collateral_ratio", label: "Min Collateral Ratio (%)", type: "number", placeholder: "120", min: 0, step: "1" },
      ];
    case "set_pool_cap":
      return [
        { key: "max_tvl", label: "Max TVL", type: "number", placeholder: "1000000", min: 0, step: "1" },
        { key: "max_single_exposure", label: "Max Single Exposure (%)", type: "number", placeholder: "20", min: 0, step: "0.1" },
      ];
    default:
      return [];
  }
}

function buildParameters(type: ProposalType, params: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === "") continue;
    const num = parseFloat(v);
    out[k] = Number.isFinite(num) ? num : v;
  }
  return out;
}
