"use client";

import { useState, useCallback } from "react";
import { useOpportunities } from "@/hooks/useOpportunities";
import { OpportunityExplorer } from "@/components/zkdefi/TradeDesk/OpportunityExplorer";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";
import type { SignalForExecution } from "@/components/zkdefi/mission-control/SignalExecutionDrawer";

interface MarketsTabProps {
  onDeploy?: (signal: SignalForExecution) => void;
}

export function MarketsTab({ onDeploy }: MarketsTabProps) {
  const { opportunities, loading, error } = useOpportunities(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback(
    (opp: UnifiedOpportunity) => {
      setSelectedId(opp.id);
      if (onDeploy) {
        onDeploy({
          id: opp.id,
          name: opp.title ?? `${opp.type} ${opp.pair}`,
          type: opp.type,
          venue: opp.protocol,
          currentYield: opp.currentYield,
          apy_bps: Math.round((opp.currentYield ?? 0) * 100),
          riskScore: opp.riskScore,
        });
      }
    },
    [onDeploy],
  );

  if (error && opportunities.length === 0) {
    return (
      <div className="h-full p-3 flex items-center justify-center">
        <p className="text-[11px] text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full p-3">
      <OpportunityExplorer
        opportunities={opportunities}
        selectedId={selectedId}
        onSelect={handleSelect}
        loading={loading}
      />
    </div>
  );
}
