"use client";

import React, { useState, useCallback } from "react";
import type { PrivacyMethod, ProofStep, VaultCommitment } from "@/hooks/usePrivacyVault";
import { Shield } from "lucide-react";
import { TierSelector } from "./TierSelector";
import { DepositPanel } from "./DepositPanel";
import { WithdrawPanel } from "./WithdrawPanel";
import PositionsOverview from "./PositionsOverview";
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
}

export function VaultTab(props: VaultTabProps) {
  const {
    method, setMethod, commitments, addCommitment, removeCommitment,
    depositSteps, withdrawSteps, setDepositSteps, setWithdrawSteps, address, isDemo,
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
      <TierSelector selected={method} onSelect={setMethod} commitments={commitments} />
      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Deposits record a Pedersen commitment on-chain — your wallet address, amount, and strategy are never exposed. Withdrawals reveal a nullifier without linking to the original deposit.
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DepositPanel method={method} depositSteps={depositSteps} setDepositSteps={setDepositSteps} addCommitment={addCommitment} address={address} />
        <WithdrawPanel method={method} setMethod={setMethod} commitments={commitments} removeCommitment={removeCommitment} withdrawSteps={withdrawSteps} setWithdrawSteps={setWithdrawSteps} address={address} selectedCommitmentId={selectedCommitmentId} />
      </div>
      <PositionsOverview commitments={commitments} onSelectCommitment={handleSelectCommitment} address={address} />
    </div>
  );
}
