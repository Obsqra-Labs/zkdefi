"use client";
import { TierCard } from "./TierCard";
import { CreditLineVisualizer } from "./CreditLineVisualizer";
import { LendingPositionsSummary } from "./LendingPositionsSummary";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { getUserLendingPositions, type LoanPosition, type SupplyPosition } from "@/lib/api/lending";

interface CreditOverviewPanelProps {
  address: string;
}

export function CreditOverviewPanel({ address }: CreditOverviewPanelProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchCreditData() {
    try {
      setLoading(true);
      setError(null);

      const repRes = await fetch(`${API_BASE}/api/v1/zkdefi/reputation/user/${address}`);
      if (!repRes.ok) throw new Error("Failed to fetch reputation");
      const rep = await repRes.json();

      const creditRes = await fetch(`${API_BASE}/api/v1/zkdefi/profile/decision?address=${address}`);
      if (!creditRes.ok) throw new Error("Failed to fetch credit line");
      const credit = await creditRes.json();

      let lending: { loans: LoanPosition[]; supplies: SupplyPosition[] } = { loans: [], supplies: [] };
      try {
        const pos = await getUserLendingPositions(address);
        lending = { loans: pos.loans, supplies: pos.supplies };
      } catch {
        // ignore
      }

      setData({ rep, credit, lending });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCreditData();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  const { rep, credit, lending } = data;
  const creditLine = credit?.credit_line;

  return (
    <div className="space-y-6">
      <TierCard
        address={address}
        tier={rep.tier}
        tierName={rep.tier_name}
        collateralEth={rep.collateral_eth}
        tenureDays={rep.tenure_days}
        successfulTxns={rep.successful_txns}
        onUpgradeComplete={() => fetchCreditData()}
      />

      <div className="grid lg:grid-cols-2 gap-6">
        {creditLine && (
          <CreditLineVisualizer
            collateralEth={rep.collateral_eth}
            collateralLineEth={creditLine.collateral_line_eth}
            unsecuredCapEth={creditLine.unsecured_cap_eth}
            totalLineEth={creditLine.total_line_eth}
            rateBps={creditLine.rate_bps}
            tier={creditLine.tier}
            letterRating={creditLine.letter_rating}
            creditTier={creditLine.credit_tier}
            crossChainMultiplier={creditLine.cross_chain_multiplier}
            collaborativeMultiplier={creditLine.collaborative_multiplier}
          />
        )}

        <LendingPositionsSummary
          loans={(lending.loans || []).map((l: LoanPosition) => ({
            id: l.loan_id,
            principal_wei: String(l.principal_wei),
            interest_accrued_wei: String(l.interest_wei ?? 0),
            interest_rate_bps: l.interest_rate_bps,
            opened_at: l.opened_at,
            active: l.active,
          }))}
          supplies={(lending.supplies || []).map((s: SupplyPosition) => ({
            id: s.supply_id,
            shares: String(s.amount_wei),
            supplied_wei: String(s.amount_wei),
            accrued_interest_wei: "0",
            supplied_at: s.deposited_at,
            active: s.active,
          }))}
        />
      </div>
    </div>
  );
}
