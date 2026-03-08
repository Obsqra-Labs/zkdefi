"use client";

import React from "react";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";
import { OpportunityCard } from "./OpportunityCard";
import { OpportunityListSkeleton } from "@/components/ui/Skeleton";

interface OpportunityListProps {
  opportunities: UnifiedOpportunity[];
  selectedId: string | null;
  onSelect: (opp: UnifiedOpportunity) => void;
  loading: boolean;
}

export const OpportunityList = React.memo(
  ({ opportunities, selectedId, onSelect, loading }: OpportunityListProps) => {
    if (loading && opportunities.length === 0) {
      return <OpportunityListSkeleton count={8} />;
    }

    if (opportunities.length === 0) {
      return (
        <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
          No opportunities match your filters
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {opportunities.map((opp) => (
          <OpportunityCard
            key={opp.id}
            opportunity={opp}
            selected={opp.id === selectedId}
            onClick={() => onSelect(opp)}
          />
        ))}
      </div>
    );
  },
);

OpportunityList.displayName = "OpportunityList";
