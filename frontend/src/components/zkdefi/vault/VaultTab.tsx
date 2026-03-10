"use client";

import React, { useState, useCallback } from "react";
import type { PrivacyMethod, ProofStep, VaultCommitment } from "@/hooks/usePrivacyVault";
import { Shield, Lock } from "lucide-react";
import { PoolSelector, type PoolBucket } from "./PoolSelector";
import { DepositPanel } from "./DepositPanel";
import { WithdrawPanel } from "./WithdrawPanel";
import PositionsOverview from "./PositionsOverview";
import { AgentAllocationStrip } from "./AgentAllocationStrip";
import { TrendingBar } from "./TrendingBar";
import { AIInsight } from "./AIInsight";
import { DEMO_AI_INSIGHT } from "@/lib/demoCapitalOS";

interface VaultTabProps {
  method: PrivacyMethod;
  setMethod: (m: PrivacyMethod) => void;
  commitments: VaultCommitment[];
  addCommitment: (c: VaultCommitment) => void;
  removeCommitment: (id: string) => void;
  depositSteps: ProofStep[];
  withdrawSteps: ProofStep[];
  setDepositSteps: (value: React.SetStateAction<ProofStep[]>) => void;
  setWithdrawSteps: (value: React.SetStateAction<ProofStep[]>) => void;
  address?: string;
  isDemo?: boolean;
  /** V2 ledger recording callbacks */
  onRecordDeposit?: (amountWei: string, token: string, rail: string, txHash: string, commitmentHash: string) => Promise<void>;
  onRecordWithdrawal?: (amountWei: string, token: string, destination: string, route: string) => Promise<void>;
}

export function VaultTab(props: VaultTabProps) {
  const {
    method, setMethod, commitments, addCommitment, removeCommitment,
    depositSteps, withdrawSteps, setDepositSteps, setWithdrawSteps, address, isDemo,
    onRecordDeposit, onRecordWithdrawal,
  } = props;

  const [selectedPool, setSelectedPool] = useState<PoolBucket>("moderate");
  const [selectedCommitmentId, setSelectedCommitmentId] = useState<string | null>(null);

  const handleSelectCommitment = useCallback(
    (id: string) => {
      setSelectedCommitmentId(id);
      const commitment = commitments.find((c) => c.id === id);
      if (commitment) {
        setMethod(commitment.method);
      }
      setTimeout(() => {
        const withdrawPanel = document.getElementById("withdraw-panel");
        if (withdrawPanel) {
          withdrawPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    },
    [commitments, setMethod],
  );

  return (
    <div className="space-y-4">
      <TrendingBar isDemo={isDemo} />
      {isDemo && (
        <AIInsight
          address={address}
          message={DEMO_AI_INSIGHT.message}
          reasoning={DEMO_AI_INSIGHT.reasoning}
        />
      )}

      {/* ── Pool Selector — shared by Deposit & Withdraw ── */}
      <PoolSelector selected={selectedPool} onSelect={setSelectedPool} />

      {/* ── Max privacy enabled by default — no tier selection needed ── */}
      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2.5 text-xs text-emerald-400/80 flex items-start gap-2">
        <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-400" />
        <div className="space-y-1">
          <span className="font-semibold text-emerald-300 text-sm">Maximum Privacy Enabled</span>
          <p>
            Every deposit uses hash-committed proofs (Groth16 + Poseidon). Your identity is never
            linked on-chain. Withdrawals are unlinkable via nullifier sets — enable the relayer for
            full address separation.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DepositPanel method={method} depositSteps={depositSteps} setDepositSteps={setDepositSteps} addCommitment={addCommitment} address={address} fixedPoolId={selectedPool} onRecordDeposit={onRecordDeposit} />
        <WithdrawPanel method={method} setMethod={setMethod} commitments={commitments} removeCommitment={removeCommitment} withdrawSteps={withdrawSteps} setWithdrawSteps={setWithdrawSteps} address={address} selectedCommitmentId={selectedCommitmentId} onRecordWithdrawal={onRecordWithdrawal} />
      </div>
      <PositionsOverview commitments={commitments} onSelectCommitment={handleSelectCommitment} address={address} />
      <AgentAllocationStrip address={address} commitments={commitments} />
    </div>
  );
}
