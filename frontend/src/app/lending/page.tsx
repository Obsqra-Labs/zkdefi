"use client";

import { useAccount } from "@starknet-react/core";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { Wallet, ArrowRightLeft, Shield, Clock } from "lucide-react";
import { apiFetch, apiFetchAuth } from "@/lib/api/client";
import { useCallback, useEffect, useState } from "react";

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
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function LendingPage() {
  const { address, isConnected } = useAccount();

  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [tab, setTab] = useState<"borrow" | "lend" | "my">("lend");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-request form state
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState("");
  const [rateBps, setRateBps] = useState("500");
  const [durationDays, setDurationDays] = useState("30");

  /* ---------- Data fetching ---------- */

  const fetchData = useCallback(async () => {
    try {
      const [reqRes, loanRes] = await Promise.all([
        apiFetch<{ requests: LoanRequest[] }>("/api/v1/zkdefi/p2p-lending/requests"),
        apiFetch<{ loans: Loan[] }>(
          `/api/v1/zkdefi/p2p-lending/loans${address ? `?user_address=${address}` : ""}`,
        ),
      ]);
      setRequests(reqRes.requests);
      setLoans(loanRes.loans);
    } catch {
      /* silent */
    }
  }, [address]);

  useEffect(() => {
    if (isConnected) fetchData();
  }, [isConnected, fetchData]);

  /* ---------- Actions ---------- */

  const createRequest = async () => {
    if (!address) return;
    setError(null);
    setLoading(true);
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
      setAmount("");
      setCollateral("");
      await fetchData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fundRequest = async (requestId: string, requestAmount: number) => {
    if (!address) return;
    setLoading(true);
    try {
      await apiFetchAuth(`/api/v1/zkdefi/p2p-lending/requests/${requestId}/fund`, address, {
        method: "POST",
        body: JSON.stringify({
          user_address: address,
          amount_wei: requestAmount,
        }),
      });
      await fetchData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const repayLoan = async (loanId: string, amountWei: number) => {
    if (!address) return;
    setLoading(true);
    try {
      await apiFetchAuth(`/api/v1/zkdefi/p2p-lending/loans/${loanId}/repay`, address, {
        method: "POST",
        body: JSON.stringify({
          user_address: address,
          amount_wei: amountWei,
        }),
      });
      await fetchData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  /* ---------- Disconnected state ---------- */

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 gap-6">
        <div className="flex flex-col items-center gap-3">
          <Wallet className="w-10 h-10 text-cyan-400" />
          <h1 className="text-2xl font-bold">P2P Lending</h1>
          <p className="text-slate-400 text-sm">Connect your wallet to borrow or lend</p>
        </div>
        <ConnectButton />
      </div>
    );
  }

  /* ---------- Tab bar ---------- */

  const tabs = [
    { key: "lend" as const, label: "Fund Requests", icon: ArrowRightLeft },
    { key: "borrow" as const, label: "Create Request", icon: Shield },
    { key: "my" as const, label: "My Loans", icon: Clock },
  ];

  return (
    <div className="min-h-screen bg-slate-950">
      <AppNavbar />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-100 mb-6">P2P Lending</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        {/* LEND TAB — Open Requests */}
        {tab === "lend" && (
          <div className="space-y-3">
            {requests.length === 0 ? (
              <p className="text-slate-500 text-center py-12">No open loan requests</p>
            ) : (
              requests.map((r) => (
                <div key={r.id} className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <p className="text-slate-200 font-medium">
                      {weiToEth(r.amount_wei)} ETH @ {bpsToPercent(r.interest_rate_bps)}% APY
                    </p>
                    <p className="text-slate-500 text-xs mt-1">
                      Borrower: {shortAddr(r.borrower)} · Tier {r.tier} ·
                      Collateral: {weiToEth(r.collateral_wei)} ETH ·
                      Duration: {Math.floor(r.duration_secs / 86400)}d
                    </p>
                    <p className="text-slate-500 text-xs">
                      Funded: {weiToEth(r.funded_wei)} / {weiToEth(r.amount_wei)} ETH
                    </p>
                  </div>
                  <button
                    onClick={() => fundRequest(r.id, r.amount_wei - r.funded_wei)}
                    disabled={loading || r.borrower.toLowerCase() === address?.toLowerCase()}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {loading ? "…" : "Fund"}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* BORROW TAB — Create Request */}
        {tab === "borrow" && (
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4 max-w-md">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Borrow Amount (ETH)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-200 text-sm"
                placeholder="0.5"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">Collateral (ETH)</label>
              <input
                type="number"
                value={collateral}
                onChange={(e) => setCollateral(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-200 text-sm"
                placeholder="1.0"
                step="0.01"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-slate-400 text-xs mb-1">Rate (bps)</label>
                <input
                  type="number"
                  value={rateBps}
                  onChange={(e) => setRateBps(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-200 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-slate-400 text-xs mb-1">Duration (days)</label>
                <input
                  type="number"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-200 text-sm"
                />
              </div>
            </div>
            <button
              onClick={createRequest}
              disabled={loading || !amount || !collateral}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? "Creating…" : "Create Loan Request"}
            </button>
          </div>
        )}

        {/* MY LOANS TAB */}
        {tab === "my" && (
          <div className="space-y-3">
            {loans.length === 0 ? (
              <p className="text-slate-500 text-center py-12">No loans found</p>
            ) : (
              loans.map((l) => (
                <div key={l.id} className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-200 font-medium">
                        {weiToEth(l.amount_wei)} ETH @ {bpsToPercent(l.interest_rate_bps)}% APY
                      </p>
                      <p className="text-slate-500 text-xs mt-1">
                        Status:{" "}
                        <span
                          className={
                            l.status === "active"
                              ? "text-green-400"
                              : l.status === "repaid"
                                ? "text-cyan-400"
                                : "text-red-400"
                          }
                        >
                          {l.status}
                        </span>{" "}
                        · Due: {daysRemaining(l.due_at)} ·
                        Repaid: {weiToEth(l.repaid_amount_wei)} ETH
                      </p>
                    </div>
                    {l.status === "active" && l.borrower.toLowerCase() === address?.toLowerCase() && (
                      <button
                        onClick={() => repayLoan(l.id, l.amount_wei - l.repaid_amount_wei)}
                        disabled={loading}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Repay
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
