"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tier } from "@/services/ReputationGatingService";
import { VaultLendingGovernanceService } from "@/services/VaultLendingGovernanceService";
import type {
  LendingPolicy,
  Proposal,
  VoteReceipt,
  LoanRecord,
} from "@/services/VaultLendingGovernanceService";
import { CurrentPolicies } from "./CurrentPolicies";
import { ActiveProposals } from "./ActiveProposals";
import { VotingHistory } from "./VotingHistory";
import { PolicyAnalytics } from "./PolicyAnalytics";
import { AlertCircle, Loader2 } from "lucide-react";

interface UserReputation {
  tier: Tier;
  score: number;
  votingPower?: number;
}

export interface VaultGovernancePanelProps {
  poolId: string;
  userAddress?: string;
  userReputation?: UserReputation;
  onProposalCreated?: (proposalId: string) => void;
}

type TabType = "policies" | "proposals" | "history" | "analytics";

interface VoteRecord {
  proposalId: string;
  vote: "yes" | "no" | "abstain";
  timestamp: string;
  proposalTitle?: string;
  outcome?: "passed" | "failed";
}

export function VaultGovernancePanel({
  poolId,
  userAddress,
  userReputation,
  onProposalCreated,
}: VaultGovernancePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("policies");
  const [currentPolicies, setCurrentPolicies] = useState<LendingPolicy | null>(
    null
  );
  const [activeProposals, setActiveProposals] = useState<Proposal[]>([]);
  const [userVotes, setUserVotes] = useState<VoteRecord[]>([]);
  const [poolUtilization, setPoolUtilization] = useState<{
    totalLiquidity: number;
    activeLoans: number;
    availableForLending: number;
    idleRatio: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposalFilter, setProposalFilter] = useState<
    "voting" | "passed" | "failed"
  >("voting");

  const govService = new VaultLendingGovernanceService();

  useEffect(() => {
    loadInitialData();
  }, [poolId]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [policies, proposals, loans] = await Promise.all([
        govService.getLendingPolicy(poolId),
        govService.getActiveLoans(poolId).catch(() => []),
        govService.getActiveLoans(poolId).catch(() => []),
      ]);

      setCurrentPolicies(policies);

      const filteredProposals = proposals.filter(
        (p) => p.status === "open"
      ) as Proposal[];
      setActiveProposals(filteredProposals);

      if (loans && Array.isArray(loans)) {
        const totalLiquidity = 1000000;
        const activeLoansAmount = loans.reduce(
          (sum: number, loan: LoanRecord) => sum + (loan.amount || 0),
          0
        );
        setPoolUtilization({
          totalLiquidity,
          activeLoans: activeLoansAmount,
          availableForLending: totalLiquidity - activeLoansAmount,
          idleRatio: Math.round(
            ((totalLiquidity - activeLoansAmount) / totalLiquidity) * 100
          ),
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load governance data";
      setError(message);
      console.error("Error loading governance data:", err);
    } finally {
      setLoading(false);
    }
  }, [poolId, govService]);

  const handleVoteProposal = useCallback(
    async (proposalId: string, vote: "yes" | "no") => {
      if (!userAddress) {
        setError("User address required to vote");
        return;
      }

      try {
        const receipt: VoteReceipt = await govService.voteOnProposal(
          proposalId,
          vote
        );

        const newVote: VoteRecord = {
          proposalId: receipt.proposalId,
          vote: vote as "yes" | "no" | "abstain",
          timestamp: receipt.timestamp,
        };

        setUserVotes((prev) => [newVote, ...prev]);

        await loadInitialData();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to submit vote";
        setError(message);
        console.error("Error voting:", err);
      }
    },
    [userAddress, govService, loadInitialData]
  );

  const handleProposalCreated = useCallback(
    (proposalId: string) => {
      onProposalCreated?.(proposalId);
      loadInitialData();
    },
    [onProposalCreated, loadInitialData]
  );

  if (loading && !currentPolicies) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        <span className="ml-2 text-sm text-gray-600">
          Loading governance data...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-red-900">Error</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as TabType)}>
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="policies">Current Policies</TabsTrigger>
          <TabsTrigger value="proposals">Active Proposals</TabsTrigger>
          <TabsTrigger value="history">Voting History</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="policies" className="space-y-6">
          <CurrentPolicies
            poolId={poolId}
            policy={currentPolicies}
            poolUtilization={poolUtilization}
            userAddress={userAddress}
            userReputation={userReputation}
            onProposalCreated={handleProposalCreated}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="proposals" className="space-y-6">
          <ActiveProposals
            proposals={activeProposals}
            userAddress={userAddress}
            userReputation={userReputation}
            userVotes={userVotes}
            onVote={handleVoteProposal}
            filter={proposalFilter}
            onFilterChange={setProposalFilter}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <VotingHistory
            votes={userVotes}
            userAddress={userAddress}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <PolicyAnalytics poolId={poolId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
