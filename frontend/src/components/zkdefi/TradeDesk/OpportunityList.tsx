"use client";

import React from "react";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";
import { OpportunityCard } from "./OpportunityCard";

interface OpportunityListProps {
  opportunities: UnifiedOpportunity[];
  selectedId: string | null;
  onSelect: (opp: UnifiedOpportunity) => void;
  loading: boolean;
  emptyMessage?: string;
}

export function OpportunityList({
  opportunities,
  selectedId,
  onSelect,
  loading,
  emptyMessage,
}: OpportunityListProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-xs text-slate-500 animate-pulse">Loading opportunities…</div>
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-slate-500 text-center">
          {emptyMessage ?? "No opportunities found."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
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
}
