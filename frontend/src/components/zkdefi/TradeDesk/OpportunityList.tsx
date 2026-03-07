import type { Opportunity } from "@/services/types";
import { useState, useMemo } from "react";

interface OpportunityListProps {
  opportunities: Opportunity[];
  selectedOpportunity: Opportunity | null;
  onSelect: (opportunity: Opportunity) => void;
  mode: "manual" | "advisory" | "terminal";
  loading: boolean;
}

export function OpportunityList({
  opportunities,
  selectedOpportunity,
  onSelect,
  mode,
  loading,
}: OpportunityListProps) {
  const [filterType, setFilterType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"yield" | "risk" | "composite">("composite");

  const filteredAndSorted = useMemo(() => {
    let filtered = opportunities;

    if (filterType !== "all") {
      filtered = filtered.filter((opp) => opp.type === filterType);
    }

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "yield":
          return b.currentYield - a.currentYield;
        case "risk":
          return a.riskScore - b.riskScore;
        case "composite":
          const scoreA = a.currentYield - (a.riskScore / 100) * a.currentYield;
          const scoreB = b.currentYield - (b.riskScore / 100) * b.currentYield;
          return scoreB - scoreA;
        default:
          return 0;
      }
    });
  }, [opportunities, filterType, sortBy]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded border border-slate-700 p-4">
        <div className="text-slate-400">Loading opportunities...</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded border border-slate-700 p-4 flex flex-col gap-4 h-full overflow-hidden flex-col">
      <h2 className="text-lg font-semibold">Opportunities</h2>

      {/* Filters - only show in manual mode */}
      {mode === "manual" && (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-slate-400">Type</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white"
            >
              <option value="all">All Types</option>
              <option value="swap">Swap</option>
              <option value="lp">LP</option>
              <option value="lending">Lending</option>
              <option value="staking">Staking</option>
              <option value="dca">DCA</option>
              <option value="limit_orders">Limit Orders</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white"
            >
              <option value="composite">Best Composite</option>
              <option value="yield">Highest Yield</option>
              <option value="risk">Lowest Risk</option>
            </select>
          </div>
        </div>
      )}

      {/* Opportunity Cards */}
      <div className="space-y-2 overflow-y-auto flex-1">
        {filteredAndSorted.length === 0 ? (
          <p className="text-slate-400 text-sm">No opportunities match filters</p>
        ) : (
          filteredAndSorted.map((opp) => {
            const composite = opp.currentYield - (opp.riskScore / 100) * opp.currentYield;
            return (
              <button
                key={opp.id}
                onClick={() => onSelect(opp)}
                className={`w-full p-3 rounded text-left text-sm transition ${
                  selectedOpportunity?.id === opp.id
                    ? "bg-blue-900/40 border border-blue-500"
                    : "bg-slate-800 border border-slate-700 hover:border-slate-600"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{opp.name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {opp.type} • {opp.source}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-green-400">{opp.currentYield.toFixed(2)}%</div>
                    <div className="text-xs text-slate-400">APY</div>
                  </div>
                </div>
                <div className="flex justify-between mt-2 text-xs text-slate-400">
                  <span>Risk: {opp.riskScore}</span>
                  <span>Score: {composite.toFixed(2)}</span>
                </div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {opp.privacyModes.map((m) => (
                    <span
                      key={m}
                      className="text-xs px-1.5 py-0.5 bg-slate-700 rounded capitalize"
                    >
                      {m === "dark_ledger" ? "Dark" : m}
                    </span>
                  ))}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
