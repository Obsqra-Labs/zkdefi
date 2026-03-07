"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Tier } from "@/services/ReputationGatingService";
import type { LendingPolicy } from "@/services/VaultLendingGovernanceService";
import { LendingProposalForm } from "./LendingProposalForm";
import { TrendingUp, DollarSign, AlertCircle } from "lucide-react";

interface UserReputation {
  tier: Tier;
  score: number;
  votingPower?: number;
}

interface PoolUtilization {
  totalLiquidity: number;
  activeLoans: number;
  availableForLending: number;
  idleRatio: number;
}

interface CurrentPoliciesProps {
  poolId: string;
  policy: LendingPolicy | null;
  poolUtilization: PoolUtilization | null;
  userAddress?: string;
  userReputation?: UserReputation;
  onProposalCreated?: (proposalId: string) => void;
  loading?: boolean;
}

export function CurrentPolicies({
  poolId,
  policy,
  poolUtilization,
  userAddress,
  userReputation,
  onProposalCreated,
  loading,
}: CurrentPoliciesProps) {
  const [showProposalForm, setShowProposalForm] = useState(false);

  if (!policy) {
    return (
      <div className="p-8 text-center text-gray-500">
        No lending policies available for this pool.
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const calculateEffectiveYield = () => {
    if (!poolUtilization) return 0;
    const lendingInterest =
      (poolUtilization.activeLoans * ((policy.tier2.apr + policy.tier3.apr) / 2)) /
      100;
    return ((lendingInterest / poolUtilization.totalLiquidity) * 100).toFixed(2);
  };

  return (
    <div className="space-y-6">
      {/* Lending Rates Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Lending Rates (APR)
          </CardTitle>
          <CardDescription>DAO-voted borrowing rates by reputation tier</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="text-sm font-medium text-gray-600">Tier 1</div>
              <div className="text-2xl font-bold text-gray-400 mt-1">N/A</div>
              <p className="text-xs text-gray-500 mt-1">Cannot borrow</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-sm font-medium text-gray-700">Tier 2</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {policy.tier2.apr}%
              </div>
              <p className="text-xs text-blue-600 mt-1">Limited leverage</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="text-sm font-medium text-gray-700">Tier 3</div>
              <div className="text-2xl font-bold text-green-600 mt-1">
                {policy.tier3.apr}%
              </div>
              <p className="text-xs text-green-600 mt-1">Full leverage</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LTV Limits Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-purple-500" />
            LTV Limits by Tier
          </CardTitle>
          <CardDescription>Maximum loan-to-value ratios for borrowing</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="text-sm font-medium text-gray-600">Tier 1</div>
              <div className="text-2xl font-bold text-gray-400 mt-1">0%</div>
              <p className="text-xs text-gray-500 mt-1">No borrowing</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-sm font-medium text-gray-700">Tier 2</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {(policy.tier2.ltv * 100).toFixed(0)}%
              </div>
              <p className="text-xs text-blue-600 mt-1">Moderate leverage</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="text-sm font-medium text-gray-700">Tier 3</div>
              <div className="text-2xl font-bold text-green-600 mt-1">
                {(policy.tier3.ltv * 100).toFixed(0)}%
              </div>
              <p className="text-xs text-green-600 mt-1">Maximum leverage</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pool Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Pool Metrics</CardTitle>
          <CardDescription>Current vault utilization and yields</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm font-medium text-gray-600">Total Liquidity</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {poolUtilization
                  ? formatCurrency(poolUtilization.totalLiquidity)
                  : "—"}
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm font-medium text-gray-600">Active Loans</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {poolUtilization ? formatCurrency(poolUtilization.activeLoans) : "—"}
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm font-medium text-gray-600">Available</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {poolUtilization
                  ? formatCurrency(poolUtilization.availableForLending)
                  : "—"}
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="text-sm font-medium text-gray-600">Effective Yield</div>
              <div className="text-xl font-bold text-green-600 mt-1">
                {calculateEffectiveYield()}% APY
              </div>
            </div>
          </div>

          {/* Idle Reserve Ratio */}
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Idle Reserve Ratio</div>
                <div className="text-2xl font-bold text-blue-600 mt-1">
                  {poolUtilization ? poolUtilization.idleRatio : "—"}%
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  Capital held in reserve for lending demand
                </p>
              </div>
              {poolUtilization && poolUtilization.idleRatio < 20 && (
                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-lg">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-xs font-medium">Low Reserve</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button
          onClick={() => setShowProposalForm(true)}
          className="bg-blue-600 hover:bg-blue-700"
          disabled={!userAddress || loading}
        >
          Propose Change
        </Button>
      </div>

      {/* Proposal Form Modal */}
      {showProposalForm && (
        <LendingProposalForm
          poolId={poolId}
          currentPolicy={policy}
          userAddress={userAddress}
          userReputation={userReputation}
          onClose={() => setShowProposalForm(false)}
          onProposalCreated={(proposalId) => {
            setShowProposalForm(false);
            onProposalCreated?.(proposalId);
          }}
        />
      )}
    </div>
  );
}
