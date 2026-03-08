"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Opportunity, MarketContext, MarketInsights, TradeReceipt as ExecutionTradeReceipt } from "@/services/types";
import type { UserReputation } from "@/services/ReputationGatingService";
import { MarketDataService } from "@/services/MarketDataService";
import { ReputationGatingService } from "@/services/ReputationGatingService";
import { AIRecommendationService } from "@/services/AIRecommendationService";
import { ReceiptService, type ReceiptWithImpact } from "@/services/ReceiptService";
import { OpportunityList } from "@/components/zkdefi/TradeDesk/OpportunityList";
import { ExecutionPanel } from "@/components/zkdefi/TradeDesk/ExecutionPanel";
import { MarketInfoPanel } from "@/components/zkdefi/TradeDesk/MarketInfoPanel";
import { MemoryLane } from "@/components/zkdefi/TradeDesk/MemoryLane";

export interface TradeDeskProps {
  userAddress?: string;
  autoRefresh?: boolean;
  showMemoryLane?: boolean;
}

function normalizeExecutionReceipt(
  source: ExecutionTradeReceipt,
  opportunity?: Opportunity | null
) {
  return {
    id: source.id,
    timestamp: source.executedAt || new Date().toISOString(),
    action: source.type || "execute",
    adapter: source.adapter || "trade_desk",
    opportunityName: opportunity?.name || String(source?.details?.opportunity || "Execution"),
    amount: Number(source?.details?.parameters?.amount || 0),
    privacyLevel: (source?.details?.parameters?.privacyLevel || "public") as "public" | "shielded" | "dark_ledger",
    yieldImpact: Number(source?.details?.impact?.estimatedYield || 0),
    trustDelta: source.status === "executed" ? 2 : 0,
    txHash: source.transactionHash,
    status: source.status === "executed" ? "confirmed" : source.status === "failed" ? "failed" : "pending",
  };
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const marketDataService = useMemo(() => new MarketDataService(), []);
  const reputationService = useMemo(() => new ReputationGatingService(), []);
  const aiService = useMemo(() => new AIRecommendationService(), []);
  const receiptService = useMemo(() => new ReceiptService(), []);

  const refreshReceipts = useCallback(async () => {
    try {
      const r = await receiptService.getReceipts({ address: userAddress });
      setReceipts(r);
    } catch {
      setReceipts([]);
    }
  }, [receiptService, userAddress]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [context, aiInsights] = await Promise.all([
        marketDataService.getMarketContext().catch(() => null),
        aiService.getMarketInsights().catch(() => null),
      ]);
      setMarketContext(context);
      setInsights(aiInsights);

      if (userAddress) {
        const rep = await reputationService.getUserReputation(userAddress).catch(() => null);
        setUserReputation(rep);
      } else {
        setUserReputation(null);
      }

      await refreshReceipts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trade Desk load failed");
    } finally {
      setLoading(false);
    }
  }, [marketDataService, aiService, userAddress, reputationService, refreshReceipts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(loadData, 30_000);
    return () => clearInterval(t);
  }, [autoRefresh, loadData]);

  const handleExecute = useCallback(
    async (receipt: ExecutionTradeReceipt) => {
      try {
        const normalized = normalizeExecutionReceipt(receipt, selectedOpportunity);
        await receiptService.recordReceipt(normalized as any);
        await refreshReceipts();
        setSelectedOpportunity(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Execution failed");
      }
    },
    [receiptService, selectedOpportunity, refreshReceipts]
  );

  const tierForExecution = userReputation?.tier ?? "Tier1";
  const scoreForExecution = userReputation?.reputationScore ?? 0;

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100">
      {error && (
        <div className="px-4 py-2 text-sm bg-red-900/20 border-b border-red-900/40 text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 p-3">
        <div className="col-span-12 lg:col-span-3 min-h-0">
          <OpportunityList onSelectOpportunity={setSelectedOpportunity} />
        </div>

        <div className="col-span-12 lg:col-span-6 min-h-0 flex flex-col gap-3">
          <div className="flex-1 min-h-0">
            {selectedOpportunity ? (
              <div className="h-full overflow-auto">
                <ExecutionPanel
                  opportunity={selectedOpportunity}
                  onExecute={handleExecute}
                  onCancel={() => setSelectedOpportunity(null)}
                  userReputation={{ tier: tierForExecution, score: scoreForExecution }}
                />
              </div>
            ) : (
              <div className="h-full rounded border border-zinc-800 bg-zinc-900/40 flex items-center justify-center text-zinc-500 text-sm">
                Select an opportunity to execute.
              </div>
            )}
          </div>

          {showMemoryLane && (
            <div className="h-[280px] min-h-[220px]">
              <MemoryLane receipts={receipts} compact={false} showFilters={true} loading={loading} />
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-3 min-h-0">
          <MarketInfoPanel marketContext={marketContext} insights={insights} loading={loading} />
        </div>
      </div>
    </div>
  );
}
