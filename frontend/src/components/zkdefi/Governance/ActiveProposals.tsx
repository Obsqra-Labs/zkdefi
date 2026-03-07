"use client";

import React, { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Tier } from "@/services/ReputationGatingService";
import type { Proposal } from "@/services/VaultLendingGovernanceService";
import { ProposalCard } from "./ProposalCard";
import { AlertCircle } from "lucide-react";

interface UserReputation {
  tier: Tier;
  score: number;
  votingPower?: number;
}

interface VoteRecord {
  proposalId: string;
  vote: "yes" | "no" | "abstain";
  timestamp: string;
}

interface ActiveProposalsProps {
  proposals: Proposal[];
  userAddress?: string;
  userReputation?: UserReputation;
  userVotes: VoteRecord[];
  onVote: (proposalId: string, vote: "yes" | "no") => Promise<void>;
  filter: "voting" | "passed" | "failed";
  onFilterChange: (filter: "voting" | "passed" | "failed") => void;
  loading?: boolean;
}

export function ActiveProposals({
  proposals,
  userAddress,
  userReputation,
  userVotes,
  onVote,
  filter,
  onFilterChange,
  loading,
}: ActiveProposalsProps) {
  const filteredProposals = useMemo(() => {
    return proposals.filter((p) => {
      if (filter === "voting") return p.status === "open";
      if (filter === "passed") return p.status === "passed";
      if (filter === "failed") return p.status === "rejected";
      return true;
    });
  }, [proposals, filter]);

  const userHasVoted = (proposalId: string) => {
    return userVotes.some((v) => v.proposalId === proposalId);
  };

  const getUserVote = (proposalId: string) => {
    const vote = userVotes.find((v) => v.proposalId === proposalId);
    return vote?.vote;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500">
        Loading proposals...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Active Governance Proposals</h3>
          <p className="text-sm text-gray-500 mt-1">
            Vote on policy changes with your reputation-weighted voting power
          </p>
        </div>
        <Select value={filter} onValueChange={(val) => onFilterChange(val as any)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="voting">Voting</SelectItem>
            <SelectItem value="passed">Passed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Proposals List */}
      {filteredProposals.length === 0 ? (
        <div className="p-8 text-center bg-gray-50 rounded-lg border border-gray-200">
          <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600 font-medium">No proposals found</p>
          <p className="text-sm text-gray-500 mt-1">
            {filter === "voting"
              ? "Check back soon for active governance proposals"
              : `No ${filter} proposals at this time`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              userAddress={userAddress}
              userReputation={userReputation}
              userVote={getUserVote(proposal.id)}
              hasVoted={userHasVoted(proposal.id)}
              onVote={onVote}
            />
          ))}
        </div>
      )}

      {/* Info Box */}
      {!userAddress && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <p className="font-medium">Connect wallet to vote</p>
          <p className="text-xs mt-1">
            You need to connect your wallet and hold vault shares to participate in governance.
          </p>
        </div>
      )}

      {userAddress && !userReputation && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <p className="font-medium">Reputation check in progress</p>
          <p className="text-xs mt-1">
            Your voting power is determined by your reputation score and vault holdings.
          </p>
        </div>
      )}
    </div>
  );
}
