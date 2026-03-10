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
  /** Shown when there are no opportunities (e.g. per-section empty state). */
  emptyMessage?: string;
}

export const OpportunityList = React.memo(
  ({
    opportunities,
    selectedId,
    onSelect,
    loading,
    emptyMessage = "No opportunities match your filters",
  }: OpportunityListProps) => {
    if (loading && opportunities.length === 0) {
      return <OpportunityListSkeleton count={8} />;
    }

    if (opportunities.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <p className="text-slate-500 text-sm max-w-sm">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
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
