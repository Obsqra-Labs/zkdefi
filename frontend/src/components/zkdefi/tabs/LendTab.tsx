"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CreditCard,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Banknote,
  Coins,
} from "lucide-react";
import { apiFetch, apiFetchAuth } from "@/lib/api/client";
import { useVaultSummary } from "@/hooks/useVaultSummary";
import { CreditGauge } from "@/components/zkdefi/shared/CreditGauge";
import { InlineOracleCard, type OracleSignal } from "@/components/zkdefi/shared/InlineOracleCard";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface LoanRequest {
  id: string;
  borrower: string;
  amount_wei: number;
  collateral_wei: number;
  funded_wei: number;
  duration_secs: number;
  interest_rate_bps: number;
  tier: number;
  status: string;
  created_at: number;
}

interface Loan {
  id: string;
  borrower: string;
  amount_wei: number;
  collateral_wei: number;
  interest_rate_bps: number;
  status: string;
  activated_at: number;
  due_at: number;
  repaid_amount_wei: number;
}

interface ReputationData {
  score?: number;
  tier?: number;
  current_tier?: number;
  tier_name?: string;
  trust_score?: number;
}

interface PassportData {
  composite_score?: number;
  proof_count?: number;
  trust_score?: number;
}

/* ------------------------------------------------------------------ */
/* Tier-based lending parameters                                       */
/* ------------------------------------------------------------------ */

const TIER_LTV: Record<number, number> = { 1: 0.6, 2: 0.5, 3: 0.4 };
const TIER_RATE: Record<number, number> = { 1: 3.5, 2: 4.5, 3: 6.0 };

function tierLabel(t: number) {
  return t === 1 ? "T1" : t === 2 ? "T2" : "T3";
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const weiToEth = (wei: number) => (wei / 1e18).toFixed(4);
const bpsToPercent = (bps: number) => (bps / 100).toFixed(1);
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const daysRemaining = (dueSec: number) => {
  const d = Math.max(0, Math.floor((dueSec - Date.now() / 1000) / 86400));
  return `${d}d`;
};

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800/60 ${className}`} />;
}

/* ------------------------------------------------------------------ */
/* LendTab                                                             */
/* ------------------------------------------------------------------ */

interface LendTabProps {
  address: string;
}

export function LendTab({ address }: LendTabProps) {
  /* ── Credit profile state ── */
  const vault = useVaultSummary(address);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [passport, setPassport] = useState<PassportData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  /* ── Lending state ── */
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [lendingLoading, setLendingLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  /* ── Oracle signal ── */
  const [signal, setSignal] = useState<OracleSignal | null>(null);

  /* ── Borrow form ── */
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState("");

  /* ── Credit profile fetch ── */
  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    setProfileError(null);
    setProfileLoading(true);
    try {
      const [rep, pass] = await Promise.all([
        apiFetch<ReputationData>(`/api/v1/zkdefi/reputation/user/${address}`, { signal }),
        apiFetch<PassportData>(`/api/v1/zkdefi/risk_passport/user/${address}`, { signal }),
      ]);
      setReputation(rep);
      setPassport(pass);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setProfileError(e instanceof Error ? e.message : "Unable to load credit profile");
    } finally {
      setProfileLoading(false);
    }
  }, [address]);

  /* ── Lending data fetch ── */
  const loadLending = useCallback(async (signal?: AbortSignal) => {
    setLendingLoading(true);
    try {
      const [reqRes, loanRes] = await Promise.all([
        apiFetch<{ requests: LoanRequest[] }>("/api/v1/zkdefi/p2p-lending/requests", { signal }),
        apiFetch<{ loans: Loan[] }>(`/api/v1/zkdefi/p2p-lending/loans?user_address=${address}`, { signal }),
      ]);
      setRequests(reqRes.requests ?? []);
      setLoans(loanRes.loans ?? []);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      /* lending data non-critical */
    }
    finally { setLendingLoading(false); }
  }, [address]);

  /* ── Oracle signal ── */
  useEffect(() => {
    const ac = new AbortController();
    apiFetch<any>("/api/v1/zkdefi/trade-desk/v2/opportunities?limit=1", { signal: ac.signal })
      .then((res) => {
        const opp = (Array.isArray(res?.opportunities) ? res.opportunities : Array.isArray(res) ? res : [])[0];
        if (opp) {
          setSignal({
            pair: opp.pair ?? opp.pool ?? "ETH/USDC",
            direction: (opp.signal_direction ?? opp.direction ?? "stable") as OracleSignal["direction"],
            confidence: Number(opp.confidence ?? opp.score ?? 0.5),
            recommendation: opp.recommendation ?? opp.action ?? `${Number(opp.apy ?? 0).toFixed(1)}% lending rate`,
          });
        }
      })
      .catch((e) => console.warn("Lending opportunities fetch failed:", e));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    loadProfile(ac.signal);
    return () => ac.abort();
  }, [loadProfile]);
  useEffect(() => {
    const ac = new AbortController();
    loadLending(ac.signal);
    return () => ac.abort();
  }, [loadLending]);

  /* ── Actions ── */
  const fundRequest = async (requestId: string, remainingWei: number) => {
    setActionLoading(true);
    try {
      await apiFetchAuth(`/api/v1/zkdefi/p2p-lending/requests/${requestId}/fund`, address, {
        method: "POST",
        body: JSON.stringify({ user_address: address, amount_wei: remainingWei }),
      });
      await loadLending();
    } catch { /* handled in UI via loading state */ }
    finally { setActionLoading(false); }
  };

  const repayLoan = async (loanId: string, remainingWei: number) => {
    setActionLoading(true);
    try {
      await apiFetchAuth(`/api/v1/zkdefi/p2p-lending/loans/${loanId}/repay`, address, {
        method: "POST",
        body: JSON.stringify({ user_address: address, amount_wei: remainingWei }),
      });
      await loadLending();
    } catch { /* handled in UI via loading state */ }
    finally { setActionLoading(false); }
  };

  const createRequest = async () => {
    if (!amount || !collateral) return;
    setActionLoading(true);
    try {
      const tier = reputation?.tier ?? reputation?.current_tier ?? 3;
      const rateBps = Math.round((TIER_RATE[tier] ?? 6.0) * 100);
      await apiFetchAuth("/api/v1/zkdefi/p2p-lending/requests", address, {
        method: "POST",
        body: JSON.stringify({
          user_address: address,
          amount_wei: Math.floor(parseFloat(amount) * 1e18),
          collateral_wei: Math.floor(parseFloat(collateral) * 1e18),
          duration_secs: 30 * 86400,
          interest_rate_bps: rateBps,
        }),
      });
      setAmount("");
      setCollateral("");
      await loadLending();
    } catch { /* silent */ }
    finally { setActionLoading(false); }
  };

  /* ── Derived values ── */
  const tier = reputation?.tier ?? reputation?.current_tier ?? 3;
  const score = reputation?.score ?? passport?.composite_score ?? 0;
  const trustPct = Math.round(Number(passport?.trust_score ?? passport?.composite_score ?? reputation?.trust_score ?? 0));
  const totalCollateral = vault.eth_balance + vault.strk_balance * 0.5;
  const ltv = TIER_LTV[tier] ?? 0.4;
  const rate = TIER_RATE[tier] ?? 6.0;
  const borrowingPower = totalCollateral * ltv;

  return (
    <div className="space-y-6">
      {/* ━━━ 1. Credit Profile Hero ━━━ */}
      <section className="glass rounded-xl p-6">
        {profileLoading || vault.loading ? (
          <div className="flex items-center gap-6">
            <Skeleton className="w-24 h-24 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            </div>
          </div>
        ) : profileError ? (
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-200">Unable to load credit profile</p>
              <p className="text-xs text-zinc-500 mt-0.5">{profileError}</p>
            </div>
            <button onClick={() => loadProfile()} className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-6 flex-wrap">
              <CreditGauge score={score} size="md" />
              <div className="flex-1 min-w-[200px]">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <CreditCard className="w-4 h-4 text-emerald-400" /> Credit Profile
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                  <Stat label="Tier" value={tierLabel(tier)} accent="text-violet-400" />
                  <Stat label="Trust" value={`${trustPct}%`} accent="text-cyan-400" />
                  <Stat label="Proofs" value={String(passport?.proof_count ?? 0)} accent="text-emerald-400" />
                  <Stat label="Collateral" value={`${totalCollateral.toFixed(4)} ETH`} accent="text-zinc-200" />
                  <Stat label="Borrowing Power" value={`${borrowingPower.toFixed(4)} ETH`} accent="text-emerald-400" />
                  <Stat label="LTV / Rate" value={`${(ltv * 100).toFixed(0)}% / ${rate}%`} accent="text-zinc-200" />
                </div>
              </div>
            </div>
            {signal && (
              <div className="mt-4">
                <InlineOracleCard signal={signal} />
              </div>
            )}
          </>
        )}
      </section>

      {/* ━━━ 2. Active Loans ━━━ */}
      <section>
        <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Banknote className="w-3.5 h-3.5" /> Active Loans
        </h3>
        {lendingLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : loans.length === 0 ? (
          <p className="text-xs text-zinc-600 italic text-center py-6">No active loans</p>
        ) : (
          <div className="space-y-2">
            {loans.map((l) => {
              const isBorrower = l.borrower.toLowerCase() === address.toLowerCase();
              return (
                <div key={l.id} className="glass rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {isBorrower
                      ? <ArrowDownToLine className="w-4 h-4 text-amber-400 shrink-0" />
                      : <ArrowUpFromLine className="w-4 h-4 text-cyan-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-200 truncate">
                        {weiToEth(l.amount_wei)} ETH @ {bpsToPercent(l.interest_rate_bps)}%
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {isBorrower ? "Borrowed" : "Supplied"} · Due {daysRemaining(l.due_at)} ·{" "}
                        <span className={l.status === "active" ? "text-emerald-400" : "text-zinc-400"}>{l.status}</span>
                      </p>
                    </div>
                  </div>
                  {l.status === "active" && isBorrower && (
                    <button onClick={() => repayLoan(l.id, l.amount_wei - l.repaid_amount_wei)} disabled={actionLoading}
                      className="shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-xs font-medium transition-colors">
                      Repay
                    </button>
                  )}
                  {l.status === "active" && !isBorrower && (
                    <span className="shrink-0 text-[11px] text-zinc-500">Earning</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ━━━ 3. Open Market ━━━ */}
      <section>
        <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Coins className="w-3.5 h-3.5" /> Open Market
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Supply — fund open requests */}
          <div className="glass rounded-xl p-4 space-y-2">
            <p className="text-xs font-medium text-cyan-400 mb-1">Supply Requests</p>
            {lendingLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500 mx-auto" />
            ) : requests.length === 0 ? (
              <p className="text-[11px] text-zinc-600 italic text-center py-4">No open requests</p>
            ) : (
              requests.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg bg-zinc-900/40 border border-zinc-800 px-3 py-2">
                  <div>
                    <p className="text-xs text-zinc-200">{weiToEth(r.amount_wei)} ETH @ {bpsToPercent(r.interest_rate_bps)}%</p>
                    <p className="text-[11px] text-zinc-500">{shortAddr(r.borrower)} · T{r.tier} · {Math.floor(r.duration_secs / 86400)}d</p>
                  </div>
                  <button onClick={() => fundRequest(r.id, r.amount_wei - r.funded_wei)}
                    disabled={actionLoading || r.borrower.toLowerCase() === address.toLowerCase()}
                    className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-[11px] font-medium transition-colors">
                    Fund
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Borrow — create new request */}
          <div className="glass rounded-xl p-4 space-y-3">
            <p className="text-xs font-medium text-amber-400 mb-1">Create Borrow Request</p>
            <div>
              <label className="block text-zinc-500 text-[11px] mb-1">Amount (ETH)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 text-xs" placeholder="0.5" step="0.01" />
            </div>
            <div>
              <label className="block text-zinc-500 text-[11px] mb-1">Collateral (ETH)</label>
              <input type="number" value={collateral} onChange={(e) => setCollateral(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 text-xs" placeholder="1.0" step="0.01" />
            </div>
            <button onClick={createRequest} disabled={actionLoading || !amount || !collateral}
              className="w-full py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-xs font-medium transition-colors">
              {actionLoading ? "Creating…" : "Create Request"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat helper                                                         */
/* ------------------------------------------------------------------ */

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div>
      <p className="text-zinc-500">{label}</p>
      <p className={`font-medium ${accent}`}>{value}</p>
    </div>
  );
}
