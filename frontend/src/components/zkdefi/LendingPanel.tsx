"use client";

/**
 * LendingPanel - reputation-driven lending surface inside the Vault tab.
 *
 * Sections:
 *  - Credit line summary (collateral + reputation)
 *  - Pool stats (supply APY, borrow APY, utilization, TVL)
 *  - Supply / Borrow / Repay actions
 *  - My positions (loans + supplies)
 *  - Risk Profile link
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  ArrowDownUp,
  Shield,
  AlertTriangle,
  CheckCircle,
  Wallet,
  ExternalLink,
  RefreshCw,
  Landmark,
  CreditCard,
  Loader2,
  FileCheck,
  Copy,
} from "lucide-react";

import {
  getLendingPool,
  getUserLendingPositions,
  buildSupplyTx,
  buildBorrowTx,
  buildRepayTx,
  buildWithdrawTx,
  getHealthFactor,
  getActiveAttestation,
  issueAttestationV2,
  getRiskPassportV2,
  type LendingPoolStats,
  type UserLendingPositions,
  type HealthFactorResult,
} from "@/lib/api/lending";
import { API_BASE } from "@/lib/api/client";

const WEI_PER_ETH = 1e18;

interface CreditLineInfo {
  collateral_eth: number;
  collateral_line_eth: number;
  unsecured_cap_eth: number;
  total_line_eth: number;
  rate_bps: number;
  letter_rating: string;
  tier: number;
  credit_tier: string | null;
}

function deriveBorrowingTerms(passportData: { credit_tier: string } | null) {
  const creditTier = passportData?.credit_tier ?? "C";

  const tiers: Record<string, { ltv: number; maxCredit: string; rate: string; label: string }> = {
    AAA: { ltv: 80, maxCredit: "10 ETH", rate: "2.5%", label: "Prime" },
    AA:  { ltv: 70, maxCredit: "5 ETH",  rate: "3.5%", label: "Near-Prime" },
    A:   { ltv: 60, maxCredit: "2 ETH",  rate: "5.0%", label: "Standard" },
    B:   { ltv: 45, maxCredit: "1 ETH",  rate: "7.5%", label: "Substandard" },
    C:   { ltv: 30, maxCredit: "0.5 ETH", rate: "10%", label: "Restricted" },
  };

  return tiers[creditTier] ?? tiers["C"];
}

interface LendingPanelProps {
  address: string | undefined;
}

export function LendingPanel({ address }: LendingPanelProps) {
  const [pool, setPool] = useState<LendingPoolStats | null>(null);
  const [positions, setPositions] = useState<UserLendingPositions | null>(null);
  const [health, setHealth] = useState<HealthFactorResult | null>(null);
  const [creditLine, setCreditLine] = useState<CreditLineInfo | null>(null);
  const [lendingDecisionMode, setLendingDecisionMode] = useState<"allow" | "advisory" | "block" | "unknown">("unknown");
  const [disclosureCopy, setDisclosureCopy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [supplyAmount, setSupplyAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayLoanId, setRepayLoanId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: string; data: unknown } | null>(null);

  // Credit eligibility ZK proof
  const [proofLoading, setProofLoading] = useState(false);
  const [creditProof, setCreditProof] = useState<{
    proof_hash?: string;
    verified?: boolean;
    error?: string;
  } | null>(null);

  const [passport, setPassport] = useState<{
    composite_score: number;
    letter_rating: string;
    tier_name: string;
    credit_tier: string;
  } | null>(null);

  useEffect(() => {
    if (!address) return;
    let dead = false;
    fetch(`${API_BASE}/api/v1/zkdefi/risk_passport/user/${address}`, {
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (dead) return;
        if (data && typeof data === "object") {
          setPassport({
            composite_score: Number(data.composite_score ?? 0),
            letter_rating: String(data.letter_rating ?? "C"),
            tier_name: String(data.tier_name ?? "Unknown"),
            credit_tier: String(data.credit_tier ?? "C"),
          });
        }
      })
      .catch(() => {
        if (!dead) setPassport(null);
      });
    return () => { dead = true; };
  }, [address]);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [poolData, posData, healthData] = await Promise.all([
        getLendingPool().catch(() => null),
        getUserLendingPositions(address).catch(() => null),
        getHealthFactor(address).catch(() => null),
      ]);
      setPool(poolData);
      setPositions(posData);
      setHealth(healthData);

      try {
        const v2 = await getRiskPassportV2(address).catch(() => null);
        const lendingCtx = v2 && typeof v2 === "object" ? (v2 as any).lending_context : null;
        const decisions = v2 && typeof v2 === "object" ? (v2 as any).decisions : null;
        const disclosures = v2 && typeof v2 === "object" ? (v2 as any).disclosures : null;
        if (lendingCtx && typeof lendingCtx === "object") {
          setCreditLine({
            collateral_eth: Number((v2 as any)?.reputation?.collateral_eth || 0),
            collateral_line_eth: Number(lendingCtx.collateral_line_eth || 0),
            unsecured_cap_eth: Number(lendingCtx.unsecured_cap_eth || 0),
            total_line_eth: Number(lendingCtx.total_line_eth || 0),
            rate_bps: Number(lendingCtx.rate_bps || 0),
            letter_rating: String((v2 as any)?.letter_rating || "D"),
            tier: Number((v2 as any)?.tier || 0),
            credit_tier: ((v2 as any)?.credit_tier as string | null) ?? null,
          });
          setLendingDecisionMode(
            (decisions?.lending?.mode as "allow" | "advisory" | "block" | "unknown") || "unknown",
          );
          setDisclosureCopy(
            typeof disclosures?.disclaimer === "string" ? disclosures.disclaimer : null,
          );
        }
      } catch {
        // attestation fetch is optional
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSupply = async () => {
    if (!supplyAmount || !address) return;
    setActionLoading(true);
    try {
      const wei = Math.floor(parseFloat(supplyAmount) * WEI_PER_ETH);
      const result = await buildSupplyTx(wei);
      setActionResult({ type: "supply", data: result });
    } catch (e: unknown) {
      setActionResult({ type: "error", data: (e as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBorrow = async () => {
    if (!borrowAmount || !address) return;
    if (lendingDecisionMode === "block") {
      setActionResult({ type: "error", data: "Borrow is currently blocked by trust controls. Resolve profile warnings first." });
      return;
    }
    setActionLoading(true);
    try {
      const active = await getActiveAttestation(address).catch(() => null);
      const activeAtt = active && typeof active === "object" ? (active.attestation as Record<string, unknown> | null) : null;
      let attHash = activeAtt && typeof activeAtt.attestation_hash === "string" ? activeAtt.attestation_hash : null;

      if (!attHash) {
        const issued = await issueAttestationV2(address, false);
        const att = issued?.attestation as Record<string, unknown> | undefined;
        attHash = att && typeof att.attestation_hash === "string" ? att.attestation_hash : null;
      }
      if (!attHash) throw new Error("Could not issue attestation");
      const wei = Math.floor(parseFloat(borrowAmount) * WEI_PER_ETH);
      const result = await buildBorrowTx(address, wei, attHash);
      setActionResult({ type: "borrow", data: result });
    } catch (e: unknown) {
      setActionResult({ type: "error", data: (e as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRepay = async () => {
    if (repayLoanId == null || !repayAmount) return;
    setActionLoading(true);
    try {
      const wei = Math.floor(parseFloat(repayAmount) * WEI_PER_ETH);
      const result = await buildRepayTx(repayLoanId, wei);
      setActionResult({ type: "repay", data: result });
    } catch (e: unknown) {
      setActionResult({ type: "error", data: (e as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async (supplyId: number) => {
    setActionLoading(true);
    try {
      const result = await buildWithdrawTx(supplyId);
      setActionResult({ type: "withdraw", data: result });
    } catch (e: unknown) {
      setActionResult({ type: "error", data: (e as Error).message });
    } finally {
      setActionLoading(false);
    }
  };

  const generateCreditProof = async () => {
    if (!passport || !creditLine) return;
    setProofLoading(true);
    setCreditProof(null);
    try {
      const collateralWei = Math.floor(creditLine.collateral_eth * WEI_PER_ETH);
      const res = await fetch(`${API_BASE}/api/v1/lending/proof/credit-eligibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credit_score: passport.composite_score,
          collateral_wei: collateralWei,
          min_credit_score: 500,
          min_collateral: Math.floor(0.1 * WEI_PER_ETH),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setCreditProof({ error: data.message || data.error });
      } else {
        setCreditProof({
          proof_hash: data.proof_hash ?? data.proof?.pi_a?.[0] ?? "generated",
          verified: data.verified === true,
        });
      }
    } catch (e: unknown) {
      setCreditProof({ error: (e as Error).message });
    } finally {
      setProofLoading(false);
    }
  };

  const healthColor = health?.status === "healthy"
    ? "text-emerald-400"
    : health?.status === "at_risk"
      ? "text-amber-400"
      : health?.status === "liquidatable"
        ? "text-red-400"
        : "text-zinc-400";

  if (!address) {
    return (
      <div className="glass rounded-xl border border-zinc-800 p-8 text-center text-zinc-500">
        Connect wallet to access lending.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Credit Line Summary */}
      <div className="glass rounded-xl border border-violet-800/30 bg-gradient-to-br from-violet-950/20 to-zinc-900/0 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-violet-400" />
            <h3 className="text-lg font-semibold text-white">Your Credit Line</h3>
          </div>
          <button onClick={refresh} className="text-zinc-400 hover:text-white transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {creditLine ? (
          creditLine.total_line_eth > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-zinc-500 mb-1">Total Line</div>
                <div className="text-xl font-bold text-white">{creditLine.total_line_eth.toFixed(4)} ETH</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Collateral</div>
                <div className="text-lg text-emerald-400">{creditLine.collateral_line_eth.toFixed(4)} ETH</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Reputation Cap</div>
                <div className="text-lg text-violet-400">{creditLine.unsecured_cap_eth.toFixed(4)} ETH</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1">Rate</div>
                <div className="text-lg text-zinc-300">{(creditLine.rate_bps / 100).toFixed(2)}%</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-zinc-400">
                Your credit line is <span className="text-white font-medium">0 ETH</span>.
                Two ways to unlock borrowing:
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800">
                  <div className="text-xs text-emerald-400 font-medium mb-1">Stake Collateral</div>
                  <div className="text-xs text-zinc-500">
                    Lock ETH or STRK to get 80% LTV collateral-backed credit.
                  </div>
                  <Link href="/profile?tab=reputation" className="text-xs text-violet-400 hover:text-violet-300 mt-1 inline-flex items-center gap-1">
                    Stake now <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800">
                  <div className="text-xs text-violet-400 font-medium mb-1">Build Reputation</div>
                  <div className="text-xs text-zinc-500">
                    Upgrade from {creditLine.letter_rating} to B or above for reputation-based unsecured credit.
                  </div>
                  <Link href="/profile?tab=trust" className="text-xs text-violet-400 hover:text-violet-300 mt-1 inline-flex items-center gap-1">
                    View profile <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="text-zinc-500 text-sm">
            {loading ? "Loading credit line..." : "No credit line available yet. Build your reputation."}
          </div>
        )}

        <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Letter: <span className="text-white font-medium">{creditLine?.letter_rating || "—"}</span>
          </span>
          <span>Credit Tier: <span className="text-white font-medium">{creditLine?.credit_tier || "—"}</span></span>
          <Link href="/profile?tab=trust" className="text-violet-400 hover:text-violet-300 flex items-center gap-1">
            Improve your line <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          Lending decision: <span className="text-zinc-300 font-medium">{lendingDecisionMode}</span>
          {disclosureCopy ? <span> · {disclosureCopy}</span> : null}
        </div>

        {/* ZK Credit Eligibility Proof */}
        {passport && creditLine && (
          <div className="mt-4 pt-3 border-t border-zinc-800/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Credit Eligibility Proof</span>
                {creditProof?.verified && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-600/30 text-[10px] font-medium">
                    Verified
                  </span>
                )}
              </div>
              <button
                onClick={generateCreditProof}
                disabled={proofLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
              >
                {proofLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Shield className="w-3 h-3" />
                )}
                {proofLoading ? "Generating…" : creditProof ? "Regenerate" : "Generate ZK Proof"}
              </button>
            </div>
            {creditProof?.proof_hash && (
              <div className="mt-2 flex items-center gap-2">
                <p className="text-[10px] font-mono text-zinc-500 truncate flex-1" title={creditProof.proof_hash}>
                  {creditProof.proof_hash}
                </p>
                <button
                  onClick={() => navigator.clipboard.writeText(creditProof.proof_hash!)}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="Copy proof hash"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            )}
            {creditProof?.error && (
              <p className="mt-2 text-[11px] text-red-400">{creditProof.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Your Borrowing Terms */}
      {(() => {
        const terms = deriveBorrowingTerms(passport);
        return (
          <div className="glass rounded-xl border border-zinc-800 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                Your Borrowing Terms
              </h3>
              {passport && (
                <span className={`text-xs px-2 py-0.5 rounded border ${
                  terms.label === "Prime" ? "text-emerald-300 bg-emerald-500/10 border-emerald-600/40" :
                  terms.label === "Near-Prime" ? "text-green-300 bg-green-500/10 border-green-600/40" :
                  terms.label === "Standard" ? "text-cyan-300 bg-cyan-500/10 border-cyan-600/40" :
                  "text-zinc-400 bg-zinc-800 border-zinc-700"
                }`}>
                  {passport.letter_rating} &middot; {terms.label}
                </span>
              )}
            </div>
            {!address ? (
              <p className="text-xs text-zinc-500">Connect wallet to see your terms.</p>
            ) : !passport ? (
              <div className="text-xs text-zinc-400 space-y-1">
                <p>Build your risk passport to unlock personalized borrowing terms.</p>
                <p className="text-zinc-500">Run proofs and complete onboarding to generate your passport.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                  <p className="text-[11px] text-zinc-500 mb-0.5">Max LTV</p>
                  <p className="text-lg font-bold text-white">{terms.ltv}%</p>
                </div>
                <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                  <p className="text-[11px] text-zinc-500 mb-0.5">Credit Limit</p>
                  <p className="text-lg font-bold text-white">{terms.maxCredit}</p>
                </div>
                <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                  <p className="text-[11px] text-zinc-500 mb-0.5">Interest Rate</p>
                  <p className="text-lg font-bold text-white">{terms.rate}</p>
                </div>
                <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                  <p className="text-[11px] text-zinc-500 mb-0.5">Passport Score</p>
                  <p className="text-lg font-bold text-emerald-400">{passport.composite_score}</p>
                </div>
              </div>
            )}
            <p className="text-[11px] text-zinc-500 mt-3">
              Terms are derived from your ZK-proven risk passport. Improve your score by completing more transactions and maintaining collateral.
            </p>
          </div>
        );
      })()}

      {/* Pool Stats */}
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Landmark className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">Lending Pool</h3>
        </div>
        {pool ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <div className="text-zinc-500">TVL</div>
                <div className="text-white font-medium">{pool.total_supplied_eth.toFixed(2)} ETH</div>
              </div>
              <div>
                <div className="text-zinc-500">Borrowed</div>
                <div className="text-white font-medium">{pool.total_borrowed_eth.toFixed(2)} ETH</div>
              </div>
              <div>
                <div className="text-zinc-500">Available</div>
                <div className="text-white font-medium">{pool.available_liquidity_eth.toFixed(2)} ETH</div>
              </div>
              <div>
                <div className="text-zinc-500">Supply APY</div>
                <div className="text-emerald-400 font-medium">{(pool.supply_apy_bps / 100).toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-zinc-500">Borrow APY</div>
                <div className="text-amber-400 font-medium">{(pool.borrow_apy_bps / 100).toFixed(2)}%</div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>Utilization</span>
                <span>{(pool.utilization_bps / 100).toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, pool.utilization_bps / 100)}%`,
                    background: pool.utilization_bps > 8000
                      ? "rgb(239, 68, 68)"
                      : pool.utilization_bps > 5000
                        ? "rgb(245, 158, 11)"
                        : "rgb(52, 211, 153)",
                  }}
                />
              </div>
            </div>
            {(pool as any).private_vault_tvl_eth > 0 && (
              <div className="rounded-lg border border-violet-700/30 bg-violet-950/10 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-xs text-violet-300 font-medium">Private Vault Backing</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-zinc-500">Vault TVL</span>
                    <p className="text-violet-300 font-mono">{(pool as any).private_vault_tvl_eth?.toFixed(4)} ETH</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Supplied to Pool</span>
                    <p className="text-amber-300 font-mono">{(pool as any).private_vault_lending_eth?.toFixed(4) || "0"} ETH</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Effective TVL</span>
                    <p className="text-emerald-300 font-mono">{(pool as any).effective_tvl_eth?.toFixed(4) || pool.total_supplied_eth.toFixed(4)} ETH</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-zinc-500 text-sm">{loading ? "Loading..." : "Pool data unavailable"}</div>
        )}
      </div>

      {/* Actions: Supply / Borrow */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Supply */}
        <div className="glass rounded-xl border border-emerald-800/30 p-6">
          <h4 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Supply
          </h4>
          <div className="flex gap-2 mb-3">
            <input
              type="number"
              step="0.001"
              placeholder="Amount (ETH)"
              value={supplyAmount}
              onChange={(e) => setSupplyAmount(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none"
            />
            <button
              onClick={handleSupply}
              disabled={actionLoading || !supplyAmount}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              Supply
            </button>
          </div>
          <p className="text-xs text-zinc-500">Earn yield by supplying to the lending pool.</p>
        </div>

        {/* Borrow */}
        <div className="glass rounded-xl border border-violet-800/30 p-6">
          <h4 className="text-sm font-semibold text-violet-400 mb-3 flex items-center gap-2">
            <ArrowDownUp className="w-4 h-4" /> Borrow
          </h4>
          <div className="flex gap-2 mb-3">
            <input
              type="number"
              step="0.001"
              placeholder="Amount (ETH)"
              value={borrowAmount}
              onChange={(e) => setBorrowAmount(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:border-violet-500 outline-none"
            />
            <button
              onClick={handleBorrow}
              disabled={actionLoading || !borrowAmount || !creditLine}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              Borrow
            </button>
          </div>
          <p className="text-xs text-zinc-500">Borrow against your collateral + reputation credit line.</p>
        </div>
      </div>

      {/* Health Factor */}
      {health && health.status !== "no_debt" && (
        <div className="glass rounded-xl border border-zinc-800 p-4 flex items-center gap-4">
          {health.status === "healthy" ? (
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          )}
          <div>
            <span className="text-sm text-zinc-400">Health Factor: </span>
            <span className={`text-lg font-bold ${healthColor}`}>
              {health.health_factor.toFixed(2)}
            </span>
          </div>
          <div className="text-xs text-zinc-500 ml-auto">
            Collateral: {(health.collateral_wei / WEI_PER_ETH).toFixed(4)} ETH |
            Debt: {(health.total_debt_wei / WEI_PER_ETH).toFixed(4)} ETH
          </div>
        </div>
      )}

      {/* My Positions */}
      {positions && (positions.loan_count > 0 || positions.supply_count > 0) && (
        <div className="glass rounded-xl border border-zinc-800 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-zinc-400" /> My Positions
          </h3>

          {/* Loans */}
          {positions.loans.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm text-zinc-400 mb-2">Open Loans</h4>
              <div className="space-y-2">
                {positions.loans.map((loan) => (
                  <div key={loan.loan_id} className="flex items-center justify-between bg-zinc-900/50 rounded-lg p-3">
                    <div className="text-sm">
                      <span className="text-white">Loan #{loan.loan_id}</span>
                      <span className="text-zinc-500 ml-2">
                        {(loan.principal_wei / WEI_PER_ETH).toFixed(4)} ETH
                      </span>
                      <span className="text-zinc-600 ml-2 text-xs">
                        +{(loan.interest_wei / WEI_PER_ETH).toFixed(6)} interest
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setRepayLoanId(loan.loan_id);
                        setRepayAmount(((loan.principal_wei + loan.interest_wei) / WEI_PER_ETH).toFixed(6));
                      }}
                      className="px-3 py-1 bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 rounded text-xs transition-colors"
                    >
                      Repay
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Supplies */}
          {positions.supplies.length > 0 && (
            <div>
              <h4 className="text-sm text-zinc-400 mb-2">Supply Positions</h4>
              <div className="space-y-2">
                {positions.supplies.map((sup) => (
                  <div key={sup.supply_id} className="flex items-center justify-between bg-zinc-900/50 rounded-lg p-3">
                    <div className="text-sm">
                      <span className="text-white">Supply #{sup.supply_id}</span>
                      <span className="text-zinc-500 ml-2">
                        {(sup.amount_wei / WEI_PER_ETH).toFixed(4)} ETH
                      </span>
                    </div>
                    <button
                      onClick={() => handleWithdraw(sup.supply_id)}
                      className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded text-xs transition-colors"
                    >
                      Withdraw
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Repay Modal (inline) */}
      {repayLoanId != null && (
        <div className="glass rounded-xl border border-amber-800/30 p-6">
          <h4 className="text-sm font-semibold text-amber-400 mb-3">Repay Loan #{repayLoanId}</h4>
          <div className="flex gap-2 mb-3">
            <input
              type="number"
              step="0.001"
              placeholder="Amount (ETH)"
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
            />
            <button
              onClick={handleRepay}
              disabled={actionLoading || !repayAmount}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              Repay
            </button>
            <button
              onClick={() => { setRepayLoanId(null); setRepayAmount(""); }}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action Result */}
      {actionResult && (
        <div className={`glass rounded-xl border p-4 text-sm ${actionResult.type === "error" ? "border-red-800/30 text-red-400" : "border-emerald-800/30 text-emerald-400"}`}>
          {actionResult.type === "error" ? (
            <span>Error: {String(actionResult.data)}</span>
          ) : (
            <div>
              <span className="font-medium capitalize">{actionResult.type}</span> calldata ready.
              Sign the transaction in your wallet.
              <pre className="mt-2 text-xs text-zinc-500 overflow-auto max-h-32">
                {JSON.stringify(actionResult.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Based on Risk Profile */}
      <div className="text-center text-xs text-zinc-500 py-2">
        Credit line powered by your{" "}
        <Link href="/profile?tab=trust" className="text-violet-400 hover:text-violet-300">
          Risk Profile
        </Link>
        . Build reputation to unlock larger lines.
      </div>
    </div>
  );
}
