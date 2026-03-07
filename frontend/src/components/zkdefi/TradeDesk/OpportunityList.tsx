"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Filter,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  Search,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { MarketDataService } from "@/services/MarketDataService";
import { AIRecommendationService } from "@/services/AIRecommendationService";
import type { Opportunity, Recommendation } from "@/services/types";
import { OpportunityCard } from "./OpportunityCard";

interface OpportunityListProps {
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

export function OpportunityList({
  onSelectOpportunity,
  autoHighlight = true,
  maxOpportunities = 20,
  defaultFilters,
}: OpportunityListProps) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [filteredOpportunities, setFilteredOpportunities] = useState<
    Opportunity[]
  >([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
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
  const aiService = useMemo(() => new AIRecommendationService(), []);

  const opportunityTypes: Array<
    "swap" | "lp" | "lending" | "staking" | "dca" | "limit_orders"
  > = ["swap", "lp", "lending", "staking", "dca", "limit_orders"];

  // Fetch opportunities and recommendations
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const opps = await marketDataService.getOpportunities();
        setOpportunities(opps);

        // Fetch recommendations if auto-highlight is enabled
        if (autoHighlight) {
          try {
            const recs = await aiService.getRecommendations({
              currentPortfolio: {},
              riskProfile: "moderate",
            });
            setRecommendations(recs);
          } catch (err) {
            console.warn("Failed to fetch recommendations:", err);
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load opportunities";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [marketDataService, aiService, autoHighlight]);

  // Apply filters and sorting
  useEffect(() => {
    let filtered = opportunities.slice();

    // Type filter
    if (typeFilters.size > 0) {
      filtered = filtered.filter((opp) => typeFilters.has(opp.type));
    }

    // Yield filter
    filtered = filtered.filter((opp) => opp.currentYield >= minYield);

    // Risk filter
    filtered = filtered.filter((opp) => opp.riskScore <= maxRisk);

    // Privacy mode filter
    if (privacyMode !== "all") {
      filtered = filtered.filter((opp) =>
        opp.privacyModes.includes(privacyMode as any)
      );
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (opp) =>
          opp.name.toLowerCase().includes(query) ||
          opp.description.toLowerCase().includes(query)
      );
    }

    // Sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "yield":
          return b.currentYield - a.currentYield;
        case "risk":
          return a.riskScore - b.riskScore;
        case "recommendation":
          const aRec = recommendations.find((r) => r.id === a.id);
          const bRec = recommendations.find((r) => r.id === b.id);
          const aConf = aRec?.confidence || 0;
          const bConf = bRec?.confidence || 0;
          return bConf - aConf;
        default:
          return 0;
      }
    });

    // Limit opportunities
    setFilteredOpportunities(filtered.slice(0, maxOpportunities));
  }, [
    opportunities,
    typeFilters,
    minYield,
    maxRisk,
    privacyMode,
    searchQuery,
    sortBy,
    recommendations,
    maxOpportunities,
  ]);

  const handleTypeFilterChange = useCallback(
    (type: string) => {
      setTypeFilters((prev) => {
        const updated = new Set(prev);
        if (updated.has(type)) {
          updated.delete(type);
        } else {
          updated.add(type);
        }
        return updated;
      });
    },
    []
  );

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    marketDataService
      .getOpportunities()
      .then((opps) => {
        setOpportunities(opps);
        setError(null);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load opportunities"
        );
      })
      .finally(() => setLoading(false));
  }, [marketDataService]);

  const resetFilters = useCallback(() => {
    setTypeFilters(new Set());
    setMinYield(0);
    setMaxRisk(100);
    setPrivacyMode("all");
    setSearchQuery("");
    setSortBy("yield");
  }, []);

  const isFiltered =
    typeFilters.size > 0 ||
    minYield > 0 ||
    maxRisk < 100 ||
    privacyMode !== "all" ||
    searchQuery.trim() !== "";

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="text-center py-12">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="inline-block"
          >
            <RefreshCw className="w-8 h-8 text-blue-500" />
          </motion.div>
          <p className="mt-2 text-gray-600 text-sm">
            Loading opportunities...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-red-900 text-sm">
              Failed to Load Opportunities
            </h3>
            <p className="text-red-700 text-sm mt-1">{error}</p>
            <button
              onClick={handleRetry}
              className="mt-3 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Search and Sort */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search opportunities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Sort Dropdown */}
        <div className="relative group">
          <button className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm font-medium text-gray-700 transition-colors">
            <TrendingUp className="w-4 h-4" />
            Sort: {sortBy === "yield" ? "Yield" : sortBy === "risk" ? "Risk" : "Recommended"}
            <ChevronDown className="w-4 h-4" />
          </button>
          <div className="absolute right-0 mt-0 hidden group-hover:block bg-white border border-gray-200 rounded-lg shadow-lg z-10">
            {(
              [
                ["yield", "Highest Yield"],
                ["risk", "Lowest Risk"],
                ["recommendation", "AI Recommended"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setSortBy(value)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                  sortBy === value
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 border rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${
            isFiltered
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {isFiltered && (
            <span className="ml-1 px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
              {typeFilters.size +
                (minYield > 0 ? 1 : 0) +
                (maxRisk < 100 ? 1 : 0) +
                (privacyMode !== "all" ? 1 : 0) +
                (searchQuery.trim() ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4 overflow-hidden"
          >
            {/* Type Filter */}
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Opportunity Type
              </label>
              <div className="flex flex-wrap gap-2">
                {opportunityTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => handleTypeFilterChange(type)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      typeFilters.has(type)
                        ? "bg-blue-600 text-white"
                        : "bg-white border border-gray-300 text-gray-700 hover:border-blue-300"
                    }`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Yield Range */}
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Min Yield: {minYield.toFixed(1)}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={minYield}
                onChange={(e) => setMinYield(parseFloat(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            {/* Risk Range */}
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Max Risk: {maxRisk.toFixed(0)}
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={maxRisk}
                onChange={(e) => setMaxRisk(parseFloat(e.target.value))}
                className="w-full accent-red-600"
              />
            </div>

            {/* Privacy Mode */}
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Privacy Mode
              </label>
              <div className="flex gap-2 flex-wrap">
                {["all", "public", "shielded", "dark_ledger"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() =>
                      setPrivacyMode(mode as any)
                    }
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      privacyMode === mode
                        ? "bg-blue-600 text-white"
                        : "bg-white border border-gray-300 text-gray-700 hover:border-blue-300"
                    }`}
                  >
                    {mode === "dark_ledger"
                      ? "Dark Ledger"
                      : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Reset Filters */}
            {isFiltered && (
              <button
                onClick={resetFilters}
                className="w-full px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
              >
                Reset Filters
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty State */}
      {filteredOpportunities.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-8 text-center">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-3" />
          <h3 className="font-semibold text-amber-900 mb-1">
            No Opportunities Found
          </h3>
          <p className="text-amber-700 text-sm mb-4">
            {isFiltered
              ? "Try adjusting your filters to see more opportunities."
              : "No opportunities are currently available."}
          </p>
          {isFiltered && (
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Opportunities Grid */}
      {filteredOpportunities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredOpportunities.map((opportunity) => {
              const recommendation = recommendations.find(
                (r) => r.id === opportunity.id
              );
              return (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  isRecommended={!!recommendation && autoHighlight}
                  recommendationConfidence={recommendation?.confidence}
                  onExecute={() => onSelectOpportunity(opportunity)}
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Results info */}
      {filteredOpportunities.length > 0 && (
        <div className="text-center text-sm text-gray-500 py-2">
          Showing {filteredOpportunities.length} of {opportunities.length}{" "}
          opportunities
        </div>
      )}
    </div>
  );
}
