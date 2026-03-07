"use client";

import type { MarketContext, MarketInsights } from "@/services/types";

interface MarketInfoPanelProps {
  marketContext: MarketContext | null;
  insights: MarketInsights | null;
  loading: boolean;
}

export function MarketInfoPanel({ marketContext, insights, loading }: MarketInfoPanelProps) {
  if (loading && !marketContext && !insights) {
    return (
      <div className="bg-slate-900 rounded border border-slate-700 p-4">
        <div className="text-slate-400">Loading market data...</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded border border-slate-700 p-4 flex flex-col gap-4 h-full overflow-y-auto">
      <h2 className="text-lg font-semibold">Market Info & AI Insights</h2>

      {/* Market Context */}
      {marketContext && (
        <div className="bg-slate-800 p-3 rounded space-y-2">
          <div className="text-sm">
            <span className="text-slate-400">Sentiment:</span>
            <span
              className={`ml-2 font-medium capitalize px-2 py-0.5 rounded text-xs ${
                marketContext.sentiment === "bullish"
                  ? "bg-green-900/30 text-green-400"
                  : marketContext.sentiment === "bearish"
                    ? "bg-red-900/30 text-red-400"
                    : "bg-slate-700 text-slate-300"
              }`}
            >
              {marketContext.sentiment}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-slate-400">Volatility:</span>
            <div className="mt-1 w-full bg-slate-700 rounded-full h-2">
              <div
                className={`h-full rounded-full ${
                  marketContext.volatilityIndex > 70
                    ? "bg-red-600"
                    : marketContext.volatilityIndex > 40
                      ? "bg-yellow-600"
                      : "bg-green-600"
                }`}
                style={{ width: `${marketContext.volatilityIndex}%` }}
              />
            </div>
            <span className="text-xs text-slate-400">{marketContext.volatilityIndex}%</span>
          </div>
        </div>
      )}

      {/* Risk Warnings */}
      {insights && insights.warnings.length > 0 && (
        <div>
          <p className="text-sm font-medium text-red-400 mb-2">⚠ Risk Warnings</p>
          <div className="space-y-1">
            {insights.warnings.map((w, i) => (
              <div key={i} className="text-xs text-red-300 bg-red-900/20 p-2 rounded border border-red-800">
                {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trending Pairs */}
      {marketContext && marketContext.trendingPairs.length > 0 && (
        <div>
          <p className="text-sm font-medium text-blue-400 mb-2">📈 Trending</p>
          <div className="space-y-1">
            {marketContext.trendingPairs.slice(0, 3).map((pair, i) => (
              <div key={i} className="text-xs bg-slate-800 p-2 rounded flex justify-between">
                <span className="font-medium">
                  {pair.tokenA}/{pair.tokenB}
                </span>
                <span className="text-slate-400">{(pair.volume24h / 1e6).toFixed(2)}M vol</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Narrative */}
      {insights && (
        <div className="bg-slate-800 p-3 rounded">
          <p className="text-sm font-medium text-slate-300 mb-2">💡 AI Narrative</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            {insights.narrativeExplanation || "No insights available at this time."}
          </p>
        </div>
      )}

      {/* Timestamp */}
      {marketContext && (
        <div className="text-xs text-slate-500 border-t border-slate-700 pt-2">
          Last updated: {new Date(marketContext.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
