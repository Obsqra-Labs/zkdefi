"use client";

/**
 * LendingConsole — Core P2P lending UI.
 * Extracted from /lending page for center-stage embedding.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Shield, Clock, Wallet } from "lucide-react";
import { apiFetch, apiFetchAuth } from "@/lib/api/client";

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

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface LendingConsoleProps {
  address: string | undefined;
}

export function LendingConsole({ address }: LendingConsoleProps) {
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [tab, setTab] = useState<"lend" | "borrow" | "my">("lend");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState("");
  const [rateBps, setRateBps] = useState("500");
  const [durationDays, setDurationDays] = useState("30");

  const fetchData = useCallback(async () => {
    try {
      const [reqRes, loanRes] = await Promise.all([
        apiFetch<{ requests: LoanRequest[] }>("/api/v1/zkdefi/p2p-lending/requests"),
        apiFetch<{ loans: Loan[] }>(`/api/v1/zkdefi/p2p-lending/loans${address ? `?user_address=${address}` : ""}`),
      ]);
      setRequests(reqRes.requests);
      setLoans(loanRes.loans);
    } catch { /* silent */ }
  }, [address]);

  useEffect(() => { if (address) fetchData(); }, [address, fetchData]);

  const createRequest = async () => {
    if (!address) return;
    setError(null); setLoading(true);
    try {
      await apiFetchAuth("/api/v1/zkdefi/p2p-lending/requests", address, {
        method: "POST",
        body: JSON.stringify({
          user_address: address,
          amount_wei: Math.floor(parseFloat(amount) * 1e18),
          collateral_wei: Math.floor(parseFloat(collateral) * 1e18),
          duration_secs: parseInt(durationDays) * 86400,
          interest_rate_bps: parseInt(rateBps),
        }),
      });
      setAmount(""); setCollateral("");
      await fetchData();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const fundRequest = async (requestId: string, requestAmount: number) => {
    if (!address) return;
    setLoading(true);
    try {
      await apiFetchAuth(`/api/v1/zkdefi/p2p-lending/requests/${requestId}/fund`, address, {
        method: "POST",
        body: JSON.stringify({ user_address: address, amount_wei: requestAmount }),
      });
      await fetchData();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const repayLoan = async (loanId: string, amountWei: number) => {
    if (!address) return;
    setLoading(true);
    try {
      await apiFetchAuth(`/api/v1/zkdefi/p2p-lending/loans/${loanId}/repay`, address, {
        method: "POST",
        body: JSON.stringify({ user_address: address, amount_wei: amountWei }),
      });
      await fetchData();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (!address) {
    return <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Connect wallet to access P2P lending.</div>;
  }

  const tabs = [
    { key: "lend" as const, label: "Fund Requests", icon: ArrowRightLeft },
    { key: "borrow" as const, label: "Create Request", icon: Shield },
    { key: "my" as const, label: "My Loans", icon: Clock },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Wallet className="w-4.5 h-4.5 text-cyan-400" />
          P2P Lending
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">Privacy-preserving peer-to-peer lending with ZK-verified collateral.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          ><Icon className="w-3.5 h-3.5" />{label}</button>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg p-2.5">{error}</div>
      )}

      {/* LEND TAB */}
      {tab === "lend" && (
        <div className="space-y-2">
          {requests.length === 0 ? (
            <p className="text-zinc-500 text-center py-10 text-xs">No open loan requests</p>
          ) : requests.map((r) => (
            <div key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-200">
                  {weiToEth(r.amount_wei)} ETH @ {bpsToPercent(r.interest_rate_bps)}% APY
                </p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Borrower: {shortAddr(r.borrower)} · Tier {r.tier} · Collateral: {weiToEth(r.collateral_wei)} ETH · {Math.floor(r.duration_secs / 86400)}d
                </p>
                <p className="text-[11px] text-zinc-500">Funded: {weiToEth(r.funded_wei)} / {weiToEth(r.amount_wei)} ETH</p>
              </div>
              <button
                onClick={() => fundRequest(r.id, r.amount_wei - r.funded_wei)}
                disabled={loading || r.borrower.toLowerCase() === address?.toLowerCase()}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-xs font-medium transition-colors"
              >{loading ? "…" : "Fund"}</button>
            </div>
          ))}
        </div>
      )}

      {/* BORROW TAB */}
      {tab === "borrow" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3 max-w-md">
          <div>
            <label className="block text-zinc-500 text-[11px] mb-1">Borrow Amount (ETH)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 text-xs" placeholder="0.5" step="0.01" />
          </div>
          <div>
            <label className="block text-zinc-500 text-[11px] mb-1">Collateral (ETH)</label>
            <input type="number" value={collateral} onChange={(e) => setCollateral(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 text-xs" placeholder="1.0" step="0.01" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-zinc-500 text-[11px] mb-1">Rate (bps)</label>
              <input type="number" value={rateBps} onChange={(e) => setRateBps(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 text-xs" />
            </div>
            <div className="flex-1">
              <label className="block text-zinc-500 text-[11px] mb-1">Duration (days)</label>
              <input type="number" value={durationDays} onChange={(e) => setDurationDays(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 text-xs" />
            </div>
          </div>
          <button onClick={createRequest} disabled={loading || !amount || !collateral}
            className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-xs font-medium transition-colors"
          >{loading ? "Creating…" : "Create Loan Request"}</button>
        </div>
      )}

      {/* MY LOANS TAB */}
      {tab === "my" && (
        <div className="space-y-2">
          {loans.length === 0 ? (
            <p className="text-zinc-500 text-center py-10 text-xs">No loans found</p>
          ) : loans.map((l) => (
            <div key={l.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-zinc-200">
                    {weiToEth(l.amount_wei)} ETH @ {bpsToPercent(l.interest_rate_bps)}% APY
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Status: <span className={l.status === "active" ? "text-emerald-400" : l.status === "repaid" ? "text-cyan-400" : "text-red-400"}>{l.status}</span>
                    {" "}· Due: {daysRemaining(l.due_at)} · Repaid: {weiToEth(l.repaid_amount_wei)} ETH
                  </p>
                </div>
                {l.status === "active" && l.borrower.toLowerCase() === address?.toLowerCase() && (
                  <button onClick={() => repayLoan(l.id, l.amount_wei - l.repaid_amount_wei)} disabled={loading}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
                  >Repay</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
