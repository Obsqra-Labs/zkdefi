"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Tier } from "@/services/ReputationGatingService";
import type { Proposal } from "@/services/VaultLendingGovernanceService";
import {
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
  Loader2,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

interface UserReputation {
  tier: Tier;
  score: number;
  votingPower?: number;
}

interface ProposalCardProps {
  proposal: Proposal;
  userAddress?: string;
  userReputation?: UserReputation;
  userVote?: "yes" | "no" | "abstain";
  hasVoted?: boolean;
  onVote: (proposalId: string, vote: "yes" | "no") => Promise<void>;
}

export function ProposalCard({
  proposal,
  userAddress,
  userReputation,
  userVote,
  hasVoted,
  onVote,
}: ProposalCardProps) {
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  const totalVotes = proposal.votes.yes + proposal.votes.no;
  const yesPercentage = totalVotes > 0 ? (proposal.votes.yes / totalVotes) * 100 : 0;
  const noPercentage = totalVotes > 0 ? (proposal.votes.no / totalVotes) * 100 : 0;

  // Calculate if proposal will pass (70% majority needed)
  const willPass = yesPercentage >= 70;
  const participationRate = 75; // Mock value - would come from service

  // Format time remaining
  useEffect(() => {
    const updateCountdown = () => {
      const deadline = new Date(proposal.votingDeadline).getTime();
      const now = new Date().getTime();
      const remaining = deadline - now;

      if (remaining <= 0) {
        setTimeRemaining("Voting ended");
        return;
      }

      const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
      const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setTimeRemaining(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m`);
      } else {
        setTimeRemaining(`${minutes}m`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [proposal.votingDeadline]);

  const handleVote = async (voteType: "yes" | "no") => {
    if (!userAddress) return;

    setVoting(true);
    setError(null);

    try {
      await onVote(proposal.id, voteType);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit vote"
      );
    } finally {
      setVoting(false);
    }
  };

  const getStatusIcon = () => {
    if (proposal.status === "open") {
      return <Clock className="h-4 w-4 text-blue-500" />;
    } else if (proposal.status === "passed") {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    } else {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusBadge = () => {
    const status = proposal.status;
    if (status === "open") {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          <Clock className="h-3 w-3 mr-1" />
          Voting ({timeRemaining})
        </Badge>
      );
    } else if (status === "passed") {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Passed
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg">{proposal.id.slice(0, 10)}...</CardTitle>
              {getStatusBadge()}
            </div>
            <CardDescription className="text-base mt-1">
              {proposal.proposedChanges.tier2?.apr
                ? `Adjust Tier 2 APR to ${proposal.proposedChanges.tier2.apr}%`
                : proposal.proposedChanges.tier3?.ltv
                  ? `Adjust Tier 3 LTV to ${(proposal.proposedChanges.tier3.ltv * 100).toFixed(0)}%`
                  : "Policy adjustment proposal"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Current vs Proposed */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
          <div>
            <p className="text-xs font-medium text-gray-600">Current</p>
            <p className="text-sm text-gray-900 mt-1">
              {proposal.proposedChanges.tier2?.apr
                ? `Tier 2: ${proposal.proposedChanges.tier2.apr - 0.5}% → Tier 2: ${proposal.proposedChanges.tier2.apr}%`
                : "Current policy"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600">Proposed</p>
            <p className="text-sm text-green-700 font-medium mt-1">
              {proposal.proposedChanges.tier2?.apr
                ? `Tier 2: ${proposal.proposedChanges.tier2.apr}%`
                : "New terms"}
            </p>
          </div>
        </div>

        {/* Vote Results */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Voting Results</p>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Yes</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-green-600">{proposal.votes.yes}</span>
                <span className="text-xs text-gray-500">
                  ({yesPercentage.toFixed(1)}%)
                </span>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full"
                style={{ width: `${yesPercentage}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ThumbsDown className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium">No</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-red-600">{proposal.votes.no}</span>
                <span className="text-xs text-gray-500">
                  ({noPercentage.toFixed(1)}%)
                </span>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full"
                style={{ width: `${noPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Outcome Prediction */}
        {proposal.status === "open" && (
          <div className={`p-3 rounded-lg text-sm ${
            willPass
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}>
            <p className="font-medium">
              {willPass
                ? "✓ Proposal is on track to pass"
                : "✗ Proposal needs more support"}
            </p>
            <p className="text-xs mt-1 opacity-75">
              Requires 70% approval to pass (currently {yesPercentage.toFixed(1)}%)
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg border border-red-200">
            {error}
          </div>
        )}

        {/* Voting Info */}
        {userReputation && (
          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="text-sm">
              <p className="font-medium text-blue-900">Your voting power</p>
              <p className="text-xs text-blue-700 mt-0.5">
                {userReputation.tier}: {userReputation.votingPower || 1} vote
                {(userReputation.votingPower || 1) !== 1 ? "s" : ""} (quadratic)
              </p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-blue-600" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    Your vote is weighted by √(vault holdings) for fairer governance
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Vote Buttons */}
        {proposal.status === "open" && userAddress && (
          <div className="flex gap-2 pt-2 border-t">
            <Button
              size="sm"
              variant={userVote === "yes" ? "default" : "outline"}
              onClick={() => handleVote("yes")}
              disabled={voting || hasVoted}
              className={userVote === "yes" ? "bg-green-600 hover:bg-green-700" : ""}
            >
              {voting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {userVote === "yes" ? "✓ Voted Yes" : "Vote Yes"}
            </Button>
            <Button
              size="sm"
              variant={userVote === "no" ? "default" : "outline"}
              onClick={() => handleVote("no")}
              disabled={voting || hasVoted}
              className={userVote === "no" ? "bg-red-600 hover:bg-red-700" : ""}
            >
              {voting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {userVote === "no" ? "✓ Voted No" : "Vote No"}
            </Button>
          </div>
        )}

        {userVote && hasVoted && (
          <div className="p-2 text-center text-xs font-medium text-gray-600 bg-gray-50 rounded">
            Your vote: <span className="text-gray-900">{userVote.toUpperCase()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
