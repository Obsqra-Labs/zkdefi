"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import type { Opportunity } from "@/services/types";
import { MarketDataService } from "@/services/MarketDataService";
import { OpportunityCard } from "./OpportunityCard";

export interface OpportunityListProps {
  onSelectOpportunity: (opportunity: Opportunity) => void;
  autoHighlight?: boolean;
  maxOpportunities?: number;
  defaultFilters?: {
    type?: string[];
    minYield?: number;
    maxRisk?: number;
    privacyMode?: "public" | "shielded" | "dark_ledger";
  };
}

type SortBy = "yield" | "risk" | "recommendation";

export const OpportunityList = React.memo(
  ({
    onSelectOpportunity,
    autoHighlight = true,
    maxOpportunities = 20,
    defaultFilters,
  }: OpportunityListProps) => {
    const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<SortBy>("yield");
    const [searchQuery, setSearchQuery] = useState("");

    // Filter states
    const [typeFilters, setTypeFilters] = useState<Set<string>>(
      new Set(defaultFilters?.type || [])
    );
    const [minYield, setMinYield] = useState(defaultFilters?.minYield || 0);
    const [maxRisk, setMaxRisk] = useState(defaultFilters?.maxRisk || 100);
    const [privacyMode, setPrivacyMode] = useState<
      "public" | "shielded" | "dark_ledger" | "all"
    >(defaultFilters?.privacyMode || "all");

    const [showFilters, setShowFilters] = useState(false);

    const marketDataService = useMemo(() => new MarketDataService(), []);

    // Load opportunities
    useEffect(() => {
      const loadOpportunities = async () => {
        try {
          setLoading(true);
          setError(null);
          const data = await marketDataService.getOpportunities();
          setOpportunities(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load opportunities");
        } finally {
          setLoading(false);
        }
      };

      loadOpportunities();
    }, [marketDataService]);

    // Filter and sort opportunities
    const filteredAndSorted = useMemo(() => {
      let filtered = opportunities;

      // Apply type filter
      if (typeFilters.size > 0) {
        filtered = filtered.filter((opp) => typeFilters.has(opp.type));
      }

      // Apply yield filter
      filtered = filtered.filter((opp) => opp.currentYield >= minYield);

      // Apply risk filter
      filtered = filtered.filter((opp) => opp.riskScore <= maxRisk);

      // Apply privacy mode filter
      if (privacyMode !== "all") {
        filtered = filtered.filter((opp) => opp.privacyModes.includes(privacyMode));
      }

      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (opp) =>
            opp.name.toLowerCase().includes(query) ||
            opp.description.toLowerCase().includes(query)
        );
      }

      // Sort
      const sorted = [...filtered].sort((a, b) => {
        switch (sortBy) {
          case "yield":
            return b.currentYield - a.currentYield;
          case "risk":
            return a.riskScore - b.riskScore;
          case "recommendation":
            // Placeholder: would rank by recommendation confidence
            return b.currentYield - a.currentYield;
          default:
            return 0;
        }
      });

      return sorted.slice(0, maxOpportunities);
    }, [opportunities, typeFilters, minYield, maxRisk, privacyMode, searchQuery, sortBy, maxOpportunities]);

    const handleTypeFilterToggle = useCallback(
      (type: string) => {
        const newFilters = new Set(typeFilters);
        if (newFilters.has(type)) {
          newFilters.delete(type);
        } else {
          newFilters.add(type);
        }
        setTypeFilters(newFilters);
      },
      [typeFilters]
    );

    const handleRetry = useCallback(() => {
      setError(null);
      setLoading(true);
      marketDataService.getOpportunities()
        .then(setOpportunities)
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load opportunities");
        })
        .finally(() => setLoading(false));
    }, [marketDataService]);

    if (loading && opportunities.length === 0) {
      return (
        <div className="bg-slate-900 rounded border border-slate-700 p-4">
          <div className="text-slate-400 text-center py-8">
            <div className="text-sm">Loading opportunities...</div>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-slate-900 rounded border border-slate-700 p-4">
          <div className="text-red-400 text-center py-8">
            <div className="text-sm mb-2">{error}</div>
            <button
              onClick={handleRetry}
              className="px-3 py-1 bg-red-900/30 border border-red-700 rounded text-xs hover:bg-red-900/50"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-slate-900 rounded border border-slate-700 p-4 flex flex-col gap-4 h-full overflow-hidden">
        <h2 className="text-lg font-semibold">Opportunities</h2>

        {/* Search */}
        <div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search opportunities..."
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
          />
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          {showFilters ? "Hide" : "Show"} Filters
        </button>

        {/* Filters */}
        {showFilters && (
          <div className="space-y-3 border-t border-slate-700 pt-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Type</label>
              <div className="flex flex-wrap gap-2">
                {["swap", "lp", "lending", "staking", "dca", "limit_orders"].map((type) => (
                  <button
                    key={type}
                    onClick={() => handleTypeFilterToggle(type)}
                    className={`px-2 py-1 text-xs rounded capitalize ${
                      typeFilters.has(type)
                        ? "bg-blue-600 text-white"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400">
                Min Yield: {minYield}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={minYield}
                onChange={(e) => setMinYield(parseInt(e.target.value))}
                className="w-full mt-1"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400">
                Max Risk: {maxRisk}
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={maxRisk}
                onChange={(e) => setMaxRisk(parseInt(e.target.value))}
                className="w-full mt-1"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400">Privacy Mode</label>
              <select
                value={privacyMode}
                onChange={(e) => setPrivacyMode(e.target.value as any)}
                className="w-full px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white"
              >
                <option value="all">All Modes</option>
                <option value="public">Public</option>
                <option value="shielded">Shielded</option>
                <option value="dark_ledger">Dark Ledger</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white"
              >
                <option value="yield">Highest Yield</option>
                <option value="risk">Lowest Risk</option>
                <option value="recommendation">Recommended</option>
              </select>
            </div>
          </div>
        )}

        {/* Opportunities */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {filteredAndSorted.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No opportunities found</p>
          ) : (
            filteredAndSorted.map((opp) => (
              <OpportunityCard
                key={opp.id}
                opportunity={opp}
                isRecommended={autoHighlight}
                onExecute={() => onSelectOpportunity(opp)}
              />
            ))
          )}
        </div>

        {/* Results Info */}
        <div className="text-xs text-slate-500 border-t border-slate-700 pt-2">
          Showing {filteredAndSorted.length} of {opportunities.length} opportunities
        </div>
      </div>
    );
  }
);

OpportunityList.displayName = "OpportunityList";
