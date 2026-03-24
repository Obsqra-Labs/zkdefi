"use client";

import { useState, useCallback } from "react";
import { useOpportunities } from "@/hooks/useOpportunities";
import { OpportunityExplorer } from "@/components/zkdefi/TradeDesk/OpportunityExplorer";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";

interface MarketsTabProps {
  onDeploy?: (signal: any) => void;
}

export function MarketsTab({ onDeploy }: MarketsTabProps) {
  const { opportunities, loading } = useOpportunities(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback(
    (opp: UnifiedOpportunity) => {
      setSelectedId(opp.id);
      if (onDeploy) {
        onDeploy({
          id: opp.id,
          type: opp.type,
          pair: opp.pair,
          protocol: opp.protocol,
          title: opp.title,
          yield: opp.currentYield,
          risk: opp.riskScore,
          executionMode: opp.executionMode,
        });
      }
    },
    [onDeploy],
  );

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
