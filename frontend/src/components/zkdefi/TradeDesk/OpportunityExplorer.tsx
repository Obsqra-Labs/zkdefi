"use client";

import { useState, useMemo } from "react";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";
import {
  SectionTabBar,
  type OpportunitySectionTab,
} from "./FilterBar";
import { OpportunityList } from "./OpportunityList";

interface OpportunityExplorerProps {
  opportunities: UnifiedOpportunity[];
  selectedId: string | null;
  onSelect: (opp: UnifiedOpportunity) => void;
  loading: boolean;
}

const SECTION_LABELS: Record<string, string> = {
  all: "opportunities",
  swap: "swap",
  lp: "LP",
  lending: "lending",
  staking: "staking",
  limit: "limit order",
  dca: "DCA",
  privacy: "privacy pool",
  dark_ledger: "dark ledger",
};

export function OpportunityExplorer({
  opportunities,
  selectedId,
  onSelect,
  loading,
}: OpportunityExplorerProps) {
  const [activeTab, setActiveTab] = useState<OpportunitySectionTab>("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"yield" | "risk" | "confidence">("yield");
  const [minYield, setMinYield] = useState(0);
  const [maxRisk, setMaxRisk] = useState(100);
  const [showFilters, setShowFilters] = useState(false);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of opportunities) {
      counts[o.type] = (counts[o.type] ?? 0) + 1;
    }
    return counts;
  }, [opportunities]);

  const filtered = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const tabFiltered =
      activeTab === "all" ? opportunities : opportunities.filter((o) => o.type === activeTab);
    const searchFiltered = lowerQuery
      ? tabFiltered.filter((o) => {
          const protocol = o.protocol.toLowerCase();
          const pair = o.pair.toLowerCase();
          const title = o.title.toLowerCase();
          return protocol.includes(lowerQuery) || pair.includes(lowerQuery) || title.includes(lowerQuery);
        })
      : tabFiltered;

    const rangeFiltered = searchFiltered.filter(
      (o) => Number(o.currentYield) >= minYield && Number(o.riskScore) <= maxRisk,
    );

    const sorted = [...rangeFiltered];
    if (sortBy === "yield") {
      sorted.sort((a, b) => Number(b.currentYield) - Number(a.currentYield));
    } else if (sortBy === "risk") {
      sorted.sort((a, b) => Number(a.riskScore) - Number(b.riskScore));
    } else {
      sorted.sort((a, b) => Number(b.confidence) - Number(a.confidence));
    }
    return sorted;
  }, [opportunities, activeTab, query, sortBy, minYield, maxRisk]);

  const sectionLabel = SECTION_LABELS[activeTab] ?? activeTab;

  return (
    <div className="bg-slate-900 rounded border border-slate-700 p-4 flex flex-col gap-3 h-full min-w-0 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Opportunities</h2>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
      </div>

      <SectionTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        typeCounts={typeCounts}
        totalCount={opportunities.length}
      />

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pair, protocol, title..."
          className="flex-1 min-w-0 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "yield" | "risk" | "confidence")}
          className="rounded border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
        >
          <option value="yield">Highest Yield</option>
          <option value="risk">Lowest Risk</option>
          <option value="confidence">Best Signal</option>
        </select>
      </div>

      {showFilters && (
        <div className="space-y-3 border-t border-slate-700 pt-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Min Yield: {minYield}%</label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={minYield}
              onChange={(e) => setMinYield(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Max Risk: {maxRisk}</label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={maxRisk}
              onChange={(e) => setMaxRisk(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <OpportunityList
          opportunities={filtered}
          selectedId={selectedId}
          onSelect={onSelect}
          loading={loading}
          emptyMessage={
            filtered.length === 0
              ? `No ${sectionLabel} opportunities right now. Try another section or check back later.`
              : undefined
          }
        />
      </div>

      <div className="text-xs text-slate-500 border-t border-slate-700 pt-2">
        Browsing <span className="text-slate-300 font-medium">{sectionLabel}</span>
        {" — "}
        <span className="tabular-nums">{filtered.length}</span>{" "}
        {filtered.length === 1 ? "opportunity" : "opportunities"}
      </div>
    </div>
  );
}
