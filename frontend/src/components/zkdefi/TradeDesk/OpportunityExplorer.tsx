"use client";

import { useState, useMemo, useCallback } from "react";
import type { UnifiedOpportunity, OpportunityFilters } from "@/services/TradeDeskApiService";
import { FilterBar } from "./FilterBar";
import { OpportunityList } from "./OpportunityList";

interface OpportunityExplorerProps {
  opportunities: UnifiedOpportunity[];
  selectedId: string | null;
  onSelect: (opp: UnifiedOpportunity) => void;
  loading: boolean;
}

export function OpportunityExplorer({
  opportunities,
  selectedId,
  onSelect,
  loading,
}: OpportunityExplorerProps) {
  const [filters, setFilters] = useState<OpportunityFilters>({});

  const handleFilterChange = useCallback((next: OpportunityFilters) => {
    setFilters(next);
  }, []);

  const filtered = useMemo(() => {
    let list = opportunities;

    if (filters.type) {
      const allowed = new Set(filters.type.split(","));
      list = list.filter((o) => allowed.has(o.type));
    }
    if (filters.minYield != null) {
      list = list.filter((o) => o.currentYield >= filters.minYield!);
    }
    if (filters.maxRisk != null) {
      list = list.filter((o) => o.riskScore <= filters.maxRisk!);
    }
    if (filters.privacyLevel) {
      list = list.filter((o) => o.privacyLevel === filters.privacyLevel);
    }

    return list;
  }, [opportunities, filters]);

  return (
    <div className="flex flex-col gap-3 h-full min-w-0 overflow-hidden">
      <FilterBar filters={filters} onChange={handleFilterChange} />

      <div className="text-xs text-slate-500 px-1">
        {filtered.length} of {opportunities.length} opportunities
      </div>

      <OpportunityList
        opportunities={filtered}
        selectedId={selectedId}
        onSelect={onSelect}
        loading={loading}
      />
    </div>
  );
}
