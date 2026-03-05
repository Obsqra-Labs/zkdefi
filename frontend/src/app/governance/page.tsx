"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useAccount } from "@starknet-react/core";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Shield,
  Vote,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { toastSuccess, toastError } from "@/lib/toast";

// Types
interface Proposal {
  id: number;
  proposer: string;
  proposal_type: string;
  target: string;
  new_value: number;
  votes_for: number;
  votes_against: number;
  total_votes: number;
  created_at: number;
  voting_ends_at: number;
  executed: boolean;
  passed: boolean;
}

// Main page
// Demo mode constants
const DEMO_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";

function GovernancePageContent() {
  const { address, isConnected } = useAccount();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  const demoMode = searchParams?.get("mode") === "demo";

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  // Allow demo mode to bypass wallet connection
  if (!isConnected && !demoMode) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Shield className="w-16 h-16 text-violet-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">
            Private DAO Governance
          </h1>
          <p className="text-zinc-400 mb-6">
            Connect your wallet to participate in zkDeFi governance
          </p>
          <ConnectButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <GovernanceHub address={address || (demoMode ? DEMO_ADDRESS : "")} />
    </div>
  );
}

// Hub component
function GovernanceHub({ address }: { address: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [votingPower, setVotingPower] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [proposalsRes, vpRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/v1/dao/proposals`, {
            signal: AbortSignal.timeout(5000),
          }),
          fetch(`${API_BASE}/api/v1/dao/voting_power/${address}`, {
            signal: AbortSignal.timeout(5000),
          }),
        ]);

        if (proposalsRes.status === "fulfilled" && proposalsRes.value.ok) {
          const data = await proposalsRes.value.json();
          setProposals(Array.isArray(data) ? data : []);
        }

        if (vpRes.status === "fulfilled" && vpRes.value.ok) {
          const data = await vpRes.value.json();
          setVotingPower(data.voting_power || 0);
        }
      } catch (e) {
        console.error("Failed to load governance data:", e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [address]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Private DAO Governance
          </h1>
          <p className="text-zinc-400">
            Vote privately on pool constraints and emergency controls
          </p>
        </div>
        <div className="text-right">
          <div className="text-sm text-zinc-500">Your Voting Power</div>
          <div className="text-2xl font-bold text-violet-400">{votingPower} VP</div>
          <div className="text-xs text-zinc-600">
            Based on sqrt(LP position)
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Vote className="w-5 h-5 text-violet-400" />}
          label="Active Proposals"
          value={proposals.filter(p => !p.executed).length.toString()}
          color="violet"
        />
        <StatCard
          icon={<Users className="w-5 h-5 text-blue-400" />}
          label="Total Voters"
          value="--"
          color="blue"
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          label="Passed"
          value={proposals.filter(p => p.passed).length.toString()}
          color="emerald"
        />
        <StatCard
          icon={<XCircle className="w-5 h-5 text-red-400" />}
          label="Rejected"
          value={proposals.filter(p => !p.passed && p.executed).length.toString()}
          color="red"
        />
      </div>

      {/* Privacy Notice */}
      <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-900/20 to-violet-800/20 p-5">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-violet-300 mb-1">
              Zero-Knowledge Voting
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Your vote direction is private. A zero-knowledge proof hides how you voted
              while proving your voting power. Nullifiers prevent double voting. Results
              are public and verifiable on-chain.
            </p>
          </div>
        </div>
      </div>

      {/* Active Proposals */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
          <Vote className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-400 mb-2">
            No Active Proposals
          </h3>
          <p className="text-sm text-zinc-500">
            Proposals will appear here when created
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-white">Active Proposals</h2>
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              userVotingPower={votingPower}
              onVoteSuccess={() => {
                // Refresh proposals
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Stat card
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  const colorClasses = {
    violet: "border-violet-500/20 bg-violet-900/20",
    blue: "border-blue-500/20 bg-blue-900/20",
    emerald: "border-emerald-500/20 bg-emerald-900/20",
    red: "border-red-500/20 bg-red-900/20",
  };

  return (
    <div
      className={`rounded-xl border ${colorClasses[color as keyof typeof colorClasses]} p-4`}
    >
      <div className="flex items-center justify-between mb-2">
        {icon}
        <span className="text-2xl font-bold text-white">{value}</span>
      </div>
      <div className="text-xs text-zinc-400">{label}</div>
    </div>
  );
}

// Proposal card
function ProposalCard({
  proposal,
  userVotingPower,
  onVoteSuccess,
}: {
  proposal: Proposal;
  userVotingPower: number;
  onVoteSuccess: () => void;
}) {
  const { account } = useAccount();
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [voting, setVoting] = useState(false);

  const now = Math.floor(Date.now() / 1000);
  const isActive = now <= proposal.voting_ends_at && !proposal.executed;
  const timeLeft = proposal.voting_ends_at - now;
  const daysLeft = Math.floor(timeLeft / 86400);
  const hoursLeft = Math.floor((timeLeft % 86400) / 3600);

  const totalVotes = proposal.votes_for + proposal.votes_against;
  const votesForPct = totalVotes > 0 ? (proposal.votes_for / totalVotes) * 100 : 0;
  const votesAgainstPct = totalVotes > 0 ? (proposal.votes_against / totalVotes) * 100 : 0;

  const proposalTypeLabel = {
    adapter_limit: "Adapter Limit",
    whitelist_asset: "Whitelist Asset",
    emergency_pause: "Emergency Pause",
  }[proposal.proposal_type] || proposal.proposal_type;

  async function handleVote(direction: 0 | 1) {
    if (!account) return;

    setVoting(true);
    try {
      // Generate ZK proof
      const proofRes = await fetch(`${API_BASE}/api/v1/dao/vote/generate_proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: account.address,
          proposal_id: proposal.id,
          vote_direction: direction,
        }),
      });

      if (!proofRes.ok) {
        const errData = await proofRes.json();
        throw new Error(errData.detail || "Proof generation failed");
      }

      const proof = await proofRes.json();

      // Submit vote on-chain
      const result = await account.execute([
        {
          contractAddress: process.env.NEXT_PUBLIC_DAO_MANAGER_ADDRESS as `0x${string}`,
          entrypoint: "cast_vote_with_proof",
          calldata: [
            proposal.id.toString(),
            proof.proof_calldata.length.toString(),
            ...proof.proof_calldata,
            proof.nullifier_hash,
          ],
        },
      ]);

      toastSuccess("Vote recorded privately", {
        action: {
          label: "View tx",
          onClick: () => window.open(sepoliaVoyagerTxUrl(result.transaction_hash), "_blank"),
        },
      });

      setShowVoteModal(false);
      onVoteSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError(`Vote failed: ${msg}`);
    } finally {
      setVoting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-900/20 via-slate-900/50 to-slate-900/50 p-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-violet-500/30 bg-violet-500/10 flex items-center justify-center">
            <span className="text-sm font-bold text-violet-300">#{proposal.id}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300">
                {proposalTypeLabel}
              </span>
              {isActive ? (
                <span className="text-xs px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                  Active
                </span>
              ) : proposal.executed ? (
                proposal.passed ? (
                  <span className="text-xs px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    Passed
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-300">
                    Rejected
                  </span>
                )
              ) : (
                <span className="text-xs px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
                  Ended
                </span>
              )}
            </div>
          </div>
        </div>
        {isActive && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock className="w-3.5 h-3.5" />
            <span>
              {daysLeft}d {hoursLeft}h left
            </span>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white mb-1">
          {proposal.proposal_type === "adapter_limit" && `Adjust Adapter Limit to ${(proposal.new_value / 100).toFixed(0)}%`}
          {proposal.proposal_type === "whitelist_asset" && `Whitelist Asset: ${proposal.target.slice(0, 10)}...`}
          {proposal.proposal_type === "emergency_pause" && `Emergency Pause: ${proposal.target.slice(0, 10)}...`}
        </h3>
        <p className="text-sm text-zinc-400">
          Proposed by {proposal.proposer.slice(0, 8)}...{proposal.proposer.slice(-6)}
        </p>
      </div>

      {/* Vote Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-zinc-400">Votes</span>
          <span className="text-zinc-300">{totalVotes} total</span>
        </div>

        {/* Progress bars */}
        <div className="space-y-2">
          {/* For */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-6 rounded-lg overflow-hidden bg-zinc-800/50 relative">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${votesForPct}%` }}
                transition={{ duration: 0.5 }}
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 flex items-center justify-center"
              >
                {votesForPct > 10 && (
                  <span className="text-xs font-medium text-white">
                    {votesForPct.toFixed(0)}%
                  </span>
                )}
              </motion.div>
            </div>
            <div className="flex items-center gap-1.5 min-w-[100px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-zinc-300">{proposal.votes_for} For</span>
            </div>
          </div>

          {/* Against */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-6 rounded-lg overflow-hidden bg-zinc-800/50 relative">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${votesAgainstPct}%` }}
                transition={{ duration: 0.5 }}
                className="h-full bg-gradient-to-r from-red-600 to-red-500 flex items-center justify-center"
              >
                {votesAgainstPct > 10 && (
                  <span className="text-xs font-medium text-white">
                    {votesAgainstPct.toFixed(0)}%
                  </span>
                )}
              </motion.div>
            </div>
            <div className="flex items-center gap-1.5 min-w-[100px]">
              <XCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs text-zinc-300">{proposal.votes_against} Against</span>
            </div>
          </div>
        </div>
      </div>

      {/* Privacy Notice */}
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-300/80 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Your vote is private. Zero-knowledge proofs hide your vote direction.
        </span>
      </div>

      {/* Vote Buttons */}
      {isActive && userVotingPower > 0 && (
        <div className="flex gap-3">
          <button
            onClick={() => handleVote(1)}
            disabled={voting}
            className="flex-1 px-6 py-3 rounded-lg border border-emerald-500/30 bg-gradient-to-r from-emerald-600/20 to-emerald-500/20 text-emerald-300 hover:from-emerald-600/30 hover:to-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {voting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Vote For
          </button>
          <button
            onClick={() => handleVote(0)}
            disabled={voting}
            className="flex-1 px-6 py-3 rounded-lg border border-red-500/30 bg-gradient-to-r from-red-600/20 to-red-500/20 text-red-300 hover:from-red-600/30 hover:to-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {voting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            Vote Against
          </button>
        </div>
      )}

      {!isActive && (
        <div className="text-center py-3 text-sm text-zinc-500">
          {proposal.executed ? "Voting ended - Proposal executed" : "Voting ended - Awaiting tally"}
        </div>
      )}
    </motion.div>
  );
}

// Wrap in Suspense for useSearchParams
export default function GovernancePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    }>
      <GovernancePageContent />
    </Suspense>
  );
}
