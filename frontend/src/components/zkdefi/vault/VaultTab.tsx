"use client";

import React, { useState, useCallback } from "react";
import type { PrivacyMethod, ProofStep, VaultCommitment } from "@/hooks/usePrivacyVault";
import { Shield } from "lucide-react";
import { DepositPanel } from "./DepositPanel";
import { WithdrawPanel } from "./WithdrawPanel";
import PositionsOverview from "./PositionsOverview";
import { TrendingBar } from "./TrendingBar";
import { AIInsight } from "./AIInsight";
import { DEMO_AI_INSIGHT } from "@/lib/demoCapitalOS";
import { TierSelector } from "./TierSelector";

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
  /** V2 Dark Ledger recording callbacks */
  onRecordDeposit?: (amountWei: string, token: string, rail: string, txHash: string, commitmentHash: string) => Promise<void>;
  onRecordWithdrawal?: (amountWei: string, token: string, destination: string, route: string) => Promise<void>;
}

export function VaultTab(props: VaultTabProps) {
  const {
    method, setMethod, commitments, addCommitment, removeCommitment,
    depositSteps, withdrawSteps, setDepositSteps, setWithdrawSteps, address, isDemo,
    onRecordDeposit, onRecordWithdrawal,
  } = props;

  const [selectedCommitmentId, setSelectedCommitmentId] = useState<string | null>(null);

  const handleSelectCommitment = useCallback(
    (id: string) => {
      setSelectedCommitmentId(id);
      const commitment = commitments.find((c) => c.id === id);
      if (commitment) {
        setMethod(commitment.method);
      }
      // Scroll to withdraw panel
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

      {/* ── Privacy Tier selector — choose before depositing ── */}
      <TierSelector selected={method} onSelect={setMethod} commitments={commitments} />

      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Select a privacy tier above, then deposit below. On-chain funds go directly to the privacy pool — the Dark Ledger records the fact for proof settlement without taking custody.
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DepositPanel method={method} depositSteps={depositSteps} setDepositSteps={setDepositSteps} addCommitment={addCommitment} address={address} onRecordDeposit={onRecordDeposit} />
        <WithdrawPanel method={method} setMethod={setMethod} commitments={commitments} removeCommitment={removeCommitment} withdrawSteps={withdrawSteps} setWithdrawSteps={setWithdrawSteps} address={address} selectedCommitmentId={selectedCommitmentId} onRecordWithdrawal={onRecordWithdrawal} />
      </div>
      <PositionsOverview commitments={commitments} onSelectCommitment={handleSelectCommitment} address={address} />
    </div>
  );
}
