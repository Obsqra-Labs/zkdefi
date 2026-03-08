"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { UserReputation } from "@/services/ReputationGatingService";
import type { ReceiptWithImpact } from "@/services/ReceiptService";
import type { UnifiedOpportunity, MarketContext } from "@/services/TradeDeskApiService";
import { tradeDeskApi } from "@/services/TradeDeskApiService";
import { ReputationGatingService } from "@/services/ReputationGatingService";
import { ReceiptService } from "@/services/ReceiptService";
import { TradeDeskHeader } from "./TradeDesk/TradeDeskHeader";
import { OpportunityExplorer } from "./TradeDesk/OpportunityExplorer";
import { ActionPanel } from "./TradeDesk/ActionPanel";
import { MemoryLane } from "./TradeDesk/MemoryLane";
import { PrivacySidebar } from "./TradeDesk/PrivacySidebar";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { OpportunityListSkeleton } from "@/components/ui/Skeleton";

export interface TradeDeskProps {
  userAddress?: string;
  autoRefresh?: boolean;
  showMemoryLane?: boolean;
  onClose?: () => void;
}

export function TradeDesk({
  userAddress,
  autoRefresh = true,
  showMemoryLane = true,
  onClose,
}: TradeDeskProps) {
  const [opportunities, setOpportunities] = useState<UnifiedOpportunity[]>([]);
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<UnifiedOpportunity | null>(null);
  const [userReputation, setUserReputation] = useState<UserReputation | null>(null);
  const [receipts, setReceipts] = useState<ReceiptWithImpact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reputationService = useMemo(() => new ReputationGatingService(), []);
  const receiptService = useMemo(() => new ReceiptService(), []);

  // --- initial load ---
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const [oppData, ctx] = await Promise.all([
          tradeDeskApi.getOpportunities(),
          tradeDeskApi.getMarketContext(),
        ]);

        if (cancelled) return;
        setOpportunities(oppData.opportunities);
        setMarketContext(ctx);

        if (userAddress) {
          const [rep, rcpts] = await Promise.all([
            reputationService.getUserReputation(userAddress).catch(() => null),
            receiptService.getReceipts({ address: userAddress }).catch(() => [] as ReceiptWithImpact[]),
          ]);
          if (!cancelled) {
            setUserReputation(rep);
            setReceipts(rcpts);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Trade Desk data");
          console.error("TradeDesk load error:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [userAddress, reputationService, receiptService]);

  // --- polling ---
  useEffect(() => {
    if (!autoRefresh) return;

    const marketTimer = setInterval(async () => {
      try {
        const ctx = await tradeDeskApi.getMarketContext();
        setMarketContext(ctx);
      } catch { /* swallow */ }
    }, 30_000);

    const receiptsTimer = setInterval(async () => {
      if (!userAddress) return;
      try {
        const r = await receiptService.getReceipts({ address: userAddress });
        setReceipts(r);
      } catch { /* swallow */ }
    }, 60_000);

    return () => {
      clearInterval(marketTimer);
      clearInterval(receiptsTimer);
    };
  }, [autoRefresh, userAddress, receiptService]);

  // --- handlers ---
  const handleSelect = useCallback((opp: UnifiedOpportunity) => {
    setSelectedOpportunity(opp);
  }, []);

  const handleExecute = useCallback(
    async (receipt: any) => {
      try {
        if (userAddress) {
          const [newReceipts, newOpps] = await Promise.all([
            receiptService.getReceipts({ address: userAddress }),
            tradeDeskApi.getOpportunities(),
          ]);
          setReceipts(newReceipts);
          setOpportunities(newOpps.opportunities);
        }
        setSelectedOpportunity(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Post-execution refresh failed");
      }
    },
    [userAddress, receiptService],
  );

  // --- loading state ---
  if (loading && opportunities.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
        <TradeDeskHeader reputation={userReputation} receipts={receipts} marketContext={marketContext} />
        <div className="flex-1 p-4">
          <OpportunityListSkeleton count={8} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Error bar */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 bg-red-900/20 border border-red-700 text-red-200 text-sm flex items-center justify-between"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* Header */}
      <ErrorBoundary>
        <TradeDeskHeader
          reputation={userReputation}
          receipts={receipts}
          marketContext={marketContext}
        />
      </ErrorBoundary>

      {/* Main layout */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {/* Left ~60% — opportunity explorer */}
        <div className="flex-[3] flex flex-col min-w-0 overflow-hidden">
          <ErrorBoundary>
            <OpportunityExplorer
              opportunities={opportunities}
              selectedId={selectedOpportunity?.id ?? null}
              onSelect={handleSelect}
              loading={loading}
            />
          </ErrorBoundary>
        </div>

        {/* Right ~40% — action panel */}
        <div className="flex-[2] flex flex-col min-w-0 overflow-hidden">
          <ErrorBoundary>
            <ActionPanel
              opportunity={selectedOpportunity}
              marketContext={marketContext}
              userAddress={userAddress ?? null}
              onExecute={handleExecute}
            />
          </ErrorBoundary>
        </div>

        {/* Privacy sidebar */}
        <ErrorBoundary>
          <PrivacySidebar userAddress={userAddress ?? null} />
        </ErrorBoundary>
      </div>

      {/* Memory Lane */}
      {showMemoryLane && receipts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-t border-slate-700 bg-slate-900/50"
        >
          <ErrorBoundary>
            <MemoryLane
              receipts={receipts}
              userAddress={userAddress}
              compact={true}
              showFilters={true}
              limit={10}
              loading={false}
            />
          </ErrorBoundary>
        </motion.div>
      )}

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-slate-800 rounded transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
