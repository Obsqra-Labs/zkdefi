"use client";
import { TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

interface LendingPosition {
  id: number;
  principal_wei: string;
  interest_accrued_wei: string;
  interest_rate_bps: number;
  opened_at: number;
  active: boolean;
}

interface SupplyPosition {
  id: number;
  shares: string;
  supplied_wei: string;
  accrued_interest_wei: string;
  supplied_at: number;
  active: boolean;
}

interface LendingPositionsSummaryProps {
  loans: LendingPosition[];
  supplies: SupplyPosition[];
}

function formatWeiToEth(wei: string | number): number {
  return Number(wei) / 1e18;
}

export function LendingPositionsSummary({ loans, supplies }: LendingPositionsSummaryProps) {
  const totalBorrowedEth = loans.reduce((sum, l) => sum + formatWeiToEth(l.principal_wei), 0);
  const totalSuppliedEth = supplies.reduce((sum, s) => sum + formatWeiToEth(s.supplied_wei), 0);

  const hasBorrowed = totalBorrowedEth > 0;
  const hasSupplied = totalSuppliedEth > 0;

  if (!hasBorrowed && !hasSupplied) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-3">Lending Positions</h3>
        <div className="text-center py-8 text-zinc-500">
          <p className="text-sm">No active lending positions</p>
          <Link
            href="/vault?tab=lending"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Visit Lending Pool
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-semibold">Lending Positions</h3>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4">
        {hasSupplied && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-emerald-400 mb-1">
              <TrendingUp className="w-4 h-4" />
              Supplied
            </div>
            <div className="text-2xl font-bold text-emerald-300">{totalSuppliedEth.toFixed(3)} ETH</div>
            <div className="text-xs text-emerald-500/70 mt-1">{supplies.length} position{supplies.length !== 1 && 's'}</div>
          </div>
        )}
        {hasBorrowed && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-amber-400 mb-1">
              <TrendingDown className="w-4 h-4" />
              Borrowed
            </div>
            <div className="text-2xl font-bold text-amber-300">{totalBorrowedEth.toFixed(3)} ETH</div>
            <div className="text-xs text-amber-500/70 mt-1">{loans.length} loan{loans.length !== 1 && 's'}</div>
          </div>
        )}
      </div>

      {/* Quick action */}
      <Link
        href="/vault?tab=lending"
        className="block text-center py-2 px-4 bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 rounded-lg transition-colors"
      >
        Manage Positions →
      </Link>
    </div>
  );
}
