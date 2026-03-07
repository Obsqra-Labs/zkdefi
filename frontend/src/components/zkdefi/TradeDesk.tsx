"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Opportunity, MarketContext, MarketInsights, ReceiptWithImpact, TradeReceipt } from "@/services/types";
import type { UserReputation } from "@/services/ReputationGatingService";
import { MarketDataService } from "@/services/MarketDataService";
import { ReputationGatingService } from "@/services/ReputationGatingService";
import { AIRecommendationService } from "@/services/AIRecommendationService";
import { ReceiptService } from "@/services/ReceiptService";

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

        const [opps, context] = await Promise.all([
          marketDataService.getOpportunities(),
          marketDataService.getMarketContext(),
        ]);

        setOpportunities(opps);
        setMarketContext(context);
        
        // Note: aiService.getRecommendations requires portfolio context
        // This will be populated when user connects wallet

        if (userAddress) {
          const [reputation, rcpts] = await Promise.all([
            reputationService.getUserReputation(userAddress),
            receiptService.getReceipts(),
          ]);
          setUserReputation(reputation);
          setReceipts(rcpts as unknown as ReceiptWithImpact[]);
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
        setReceipts(newReceipts as unknown as ReceiptWithImpact[]);
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
        await receiptService.recordReceipt(receipt as any);
        // Refresh receipts and opportunities
        const [newReceipts, newOpps] = await Promise.all([
          receiptService.getReceipts(),
          marketDataService.getOpportunities(),
        ]);
        setReceipts(newReceipts as unknown as ReceiptWithImpact[]);
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
      {error && (
        <div className="px-4 py-3 bg-red-900/20 border border-red-700 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-1 gap-4 p-4 overflow-hidden flex-col lg:flex-row">
        <div className="w-full flex items-center justify-center rounded border border-slate-700 bg-slate-900/50">
          <p className="text-slate-400">TradeDesk: Other components to be integrated</p>
        </div>
      </div>
    </div>
  );
}
