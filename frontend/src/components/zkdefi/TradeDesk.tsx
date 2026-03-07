"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Opportunity, MarketContext, MarketInsights, ReceiptWithImpact } from "@/services/types";
import type { UserReputation } from "@/services/ReputationGatingService";
import { MarketDataService } from "@/services/MarketDataService";
import { ReputationGatingService } from "@/services/ReputationGatingService";
import { AIRecommendationService } from "@/services/AIRecommendationService";
import { ReceiptService, type TradeReceipt } from "@/services/ReceiptService";
import { Header } from "./TradeDesk/Header";
import { MarketInfoPanel } from "./TradeDesk/MarketInfoPanel";
import { MemoryLane } from "./TradeDesk/MemoryLane";
import { OpportunityList } from "./TradeDesk/OpportunityList";
import { ExecutionPanel } from "./TradeDesk/ExecutionPanel";

export interface TradeDeskProps {
  userAddress?: string;
  autoRefresh?: boolean;
  showMemoryLane?: boolean;
}

type ExecutionMode = "manual" | "advisory" | "terminal";

export function TradeDesk({
  userAddress,
  autoRefresh = true,
  showMemoryLane = true,
}: TradeDeskProps) {
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [userReputation, setUserReputation] = useState<UserReputation | null>(null);
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null);
  const [insights, setInsights] = useState<MarketInsights | null>(null);
  const [receipts, setReceipts] = useState<ReceiptWithImpact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("manual");

  const marketDataService = useMemo(() => new MarketDataService(), []);
  const reputationService = useMemo(() => new ReputationGatingService(), []);
  const aiService = useMemo(() => new AIRecommendationService(), []);
  const receiptService = useMemo(() => new ReceiptService(), []);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [opps, context, recs] = await Promise.all([
          marketDataService.getOpportunities(),
          marketDataService.getMarketContext(),
          aiService.getRecommendations(),
        ]);

        setOpportunities(opps);
        setMarketContext(context);
        setInsights(recs);

        if (userAddress) {
          const [reputation, rcpts] = await Promise.all([
            reputationService.getUserReputation(userAddress),
            receiptService.getReceipts(),
          ]);
          setUserReputation(reputation);
          setReceipts(rcpts);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [userAddress, marketDataService, reputationService, aiService, receiptService]);

  // Real-time polling
  useEffect(() => {
    if (!autoRefresh) return;

    const marketContextInterval = setInterval(async () => {
      try {
        const context = await marketDataService.getMarketContext();
        setMarketContext(context);
      } catch (err) {
        console.error("Failed to refresh market context:", err);
      }
    }, 30000); // 30s

    const receiptsInterval = setInterval(async () => {
      if (!userAddress) return;
      try {
        const newReceipts = await receiptService.getReceipts();
        setReceipts(newReceipts);
      } catch (err) {
        console.error("Failed to refresh receipts:", err);
      }
    }, 60000); // 60s

    return () => {
      clearInterval(marketContextInterval);
      clearInterval(receiptsInterval);
    };
  }, [autoRefresh, userAddress, marketDataService, receiptService]);

  const handleOpportunitySelect = useCallback((opportunity: Opportunity) => {
    setSelectedOpportunity(opportunity);
  }, []);

  const handleExecute = useCallback(
    async (receipt: TradeReceipt) => {
      try {
        await receiptService.recordReceipt(receipt);
        // Refresh receipts and opportunities
        const [newReceipts, newOpps] = await Promise.all([
          receiptService.getReceipts(),
          marketDataService.getOpportunities(),
        ]);
        setReceipts(newReceipts);
        setOpportunities(newOpps);
        setSelectedOpportunity(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to execute trade");
      }
    },
    [receiptService, marketDataService]
  );

  const handleModeChange = useCallback((mode: ExecutionMode) => {
    setExecutionMode(mode);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      <Header
        mode={executionMode}
        onModeChange={handleModeChange}
        userReputation={userReputation}
        stats={{
          totalYield24h: 0,
          totalYield7d: 0,
          apy: 0,
          riskScore: 0,
          borrowingPower: 0,
        }}
      />

      {error && (
        <div className="px-4 py-3 bg-red-900/20 border border-red-700 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-1 gap-4 p-4 overflow-hidden flex-col lg:flex-row">
        {/* Left Panel: Opportunities */}
        <div className="w-full lg:w-1/4 flex flex-col min-h-0">
          <OpportunityList
            opportunities={opportunities}
            selectedOpportunity={selectedOpportunity}
            onSelect={handleOpportunitySelect}
            mode={executionMode}
            loading={loading}
          />
        </div>

        {/* Center Panel: Execution */}
        <div className="w-full lg:w-1/3 flex flex-col min-h-0">
          {selectedOpportunity && userReputation ? (
            <ExecutionPanel
              opportunity={selectedOpportunity}
              mode={executionMode}
              userReputation={userReputation}
              onExecute={handleExecute}
              onClose={() => setSelectedOpportunity(null)}
            />
          ) : (
            <div className="flex items-center justify-center flex-1 rounded border border-slate-700 bg-slate-900/50">
              <p className="text-slate-400">Select an opportunity to execute</p>
            </div>
          )}
        </div>

        {/* Right Panel: Market Info */}
        <div className="w-full lg:w-2/5 flex flex-col min-h-0">
          <MarketInfoPanel
            marketContext={marketContext}
            insights={insights}
            loading={loading}
          />
        </div>
      </div>

      {/* Bottom: Memory Lane */}
      {showMemoryLane && (
        <div className="w-full lg:h-1/3 h-1/4 border-t border-slate-700 overflow-hidden">
          <MemoryLane receipts={receipts} loading={loading} />
        </div>
      )}
    </div>
  );
}
