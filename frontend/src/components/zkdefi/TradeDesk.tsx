"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import type { Opportunity, MarketContext, MarketInsights, TradeReceipt } from "@/services/types";
import type { UserReputation } from "@/services/ReputationGatingService";
import type { ReceiptWithImpact } from "@/services/ReceiptService";
import { MarketDataService } from "@/services/MarketDataService";
import { ReputationGatingService } from "@/services/ReputationGatingService";
import { AIRecommendationService } from "@/services/AIRecommendationService";
import { ReceiptService } from "@/services/ReceiptService";
import { OpportunityList } from "./TradeDesk/OpportunityList";
import { ExecutionPanel } from "./TradeDesk/ExecutionPanel";
import { MemoryLane } from "./TradeDesk/MemoryLane";
import { Header } from "./TradeDesk/Header";
import { MarketInfoPanel } from "./TradeDesk/MarketInfoPanel";
import { useRiskProfileV2 } from "@/hooks/useProfile";
import { getExecutionGate, getLendingGate } from "@/lib/trust/adapters";
import { isTrustSurfaceWiringEnabled } from "@/lib/trust/flags";
import { PrivacyPoolPanel } from "./TradeDesk/PrivacyPoolPanel";
import { CreditLinePanel } from "./TradeDesk/CreditLinePanel";

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
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [userReputation, setUserReputation] = useState<UserReputation | null>(null);
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null);
  const [insights, setInsights] = useState<MarketInsights | null>(null);
  const [receipts, setReceipts] = useState<ReceiptWithImpact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<"market" | "privacy" | "credit">("market");
  const trustSurfaceWiringEnabled = isTrustSurfaceWiringEnabled();
  const { profile: trustProfile } = useRiskProfileV2(
    trustSurfaceWiringEnabled ? userAddress : undefined
  );

  const marketDataService = useMemo(() => new MarketDataService(), []);
  const reputationService = useMemo(() => new ReputationGatingService(), []);
  const aiService = useMemo(() => new AIRecommendationService(), []);
  const receiptService = useMemo(() => new ReceiptService(), []);
  const executionGate = useMemo(
    () =>
      trustSurfaceWiringEnabled
        ? getExecutionGate(trustProfile)
        : { mode: "allow" as const, reasons: [], limits: {} },
    [trustSurfaceWiringEnabled, trustProfile]
  );
  const lendingGate = useMemo(
    () =>
      trustSurfaceWiringEnabled
        ? getLendingGate(trustProfile)
        : { mode: "allow" as const, reasons: [], limits: {} },
    [trustSurfaceWiringEnabled, trustProfile]
  );
  const routeHint = useMemo(() => {
    if (!trustSurfaceWiringEnabled) return "legacy-routing";
    if (executionGate.mode === "block") return "policy-blocked";
    if (executionGate.mode === "advisory") return "guarded-routing";
    return "full-routing";
  }, [trustSurfaceWiringEnabled, executionGate.mode]);

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

        if (userAddress) {
          const [reputation, rcpts] = await Promise.all([
            reputationService.getUserReputation(userAddress),
            receiptService.getReceipts({ address: userAddress }),
          ]);
          setUserReputation(reputation);
          setReceipts(rcpts as unknown as ReceiptWithImpact[]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Trade Desk data");
        console.error("TradeDesk load error:", err);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [userAddress, marketDataService, reputationService, receiptService]);

  // Real-time polling
  useEffect(() => {
    if (!autoRefresh) return;

    const marketContextInterval = setInterval(async () => {
      try {
        const context = await marketDataService.getMarketContext();
        setMarketContext(context);
      } catch (err) {
        console.warn("Failed to refresh market context:", err);
      }
    }, 30000);

    const receiptsInterval = setInterval(async () => {
      if (!userAddress) return;
      try {
        const newReceipts = await receiptService.getReceipts({ address: userAddress });
        setReceipts(newReceipts as unknown as ReceiptWithImpact[]);
      } catch (err) {
        console.warn("Failed to refresh receipts:", err);
      }
    }, 60000);

    return () => {
      clearInterval(marketContextInterval);
      clearInterval(receiptsInterval);
    };
  }, [autoRefresh, userAddress, marketDataService, receiptService]);

  const handleExecute = useCallback(
    async (receipt: TradeReceipt) => {
      if (trustSurfaceWiringEnabled && executionGate.mode === "block") {
        setError(`Execution blocked by policy gate (${executionGate.reasons.join(", ") || "no_reason"})`);
        return;
      }
      if (
        trustSurfaceWiringEnabled &&
        lendingGate.mode === "block" &&
        selectedOpportunity?.type === "lending"
      ) {
        setError(`Lending blocked by policy gate (${lendingGate.reasons.join(", ") || "no_reason"})`);
        return;
      }
      try {
        await receiptService.recordReceipt(receipt as any);
        const [newReceipts, newOpps] = await Promise.all([
          receiptService.getReceipts(userAddress ? { address: userAddress } : undefined),
          marketDataService.getOpportunities(),
        ]);
        setReceipts(newReceipts as unknown as ReceiptWithImpact[]);
        setOpportunities(newOpps);
        setSelectedOpportunity(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to execute trade");
        console.error("Trade execution error:", err);
      }
    },
    [
      trustSurfaceWiringEnabled,
      executionGate.mode,
      executionGate.reasons,
      lendingGate.mode,
      lendingGate.reasons,
      selectedOpportunity?.type,
      receiptService,
      marketDataService,
      userAddress,
    ]
  );

  const handleCancel = useCallback(() => {
    setSelectedOpportunity(null);
  }, []);

  // Compute stats for header
  const headerStats = useMemo(() => {
    const totalYield24h = receipts
      .filter(r => {
        // Use timestamp if available, fallback to executedAt
        const timeStr = (r as any).timestamp || (r as any).executedAt;
        if (!timeStr) return false;
        const receiptTime = new Date(timeStr).getTime();
        const now = Date.now();
        return now - receiptTime <= 24 * 60 * 60 * 1000;
      })
      .reduce((sum, r) => sum + ((r as any).yieldImpact || 0), 0);

    const totalYield7d = receipts
      .filter(r => {
        // Use timestamp if available, fallback to executedAt
        const timeStr = (r as any).timestamp || (r as any).executedAt;
        if (!timeStr) return false;
        const receiptTime = new Date(timeStr).getTime();
        const now = Date.now();
        return now - receiptTime <= 7 * 24 * 60 * 60 * 1000;
      })
      .reduce((sum, r) => sum + ((r as any).yieldImpact || 0), 0);

    const avgRiskScore = opportunities.length > 0
      ? opportunities.reduce((sum, o) => sum + o.riskScore, 0) / opportunities.length
      : 0;

    const borrowingPower = userReputation
      ? userReputation.tier === "Tier3"
        ? 1.5
        : userReputation.tier === "Tier2"
          ? 0.5
          : 0
      : 0;

    return {
      totalYield24h,
      totalYield7d,
      apy: (totalYield24h * 365) / 100,
      riskScore: avgRiskScore,
      borrowingPower,
    };
  }, [receipts, opportunities, userReputation]);

  if (loading && opportunities.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
        <Header
          userReputation={userReputation}
          stats={headerStats}
          trust={{
            enabled: trustSurfaceWiringEnabled,
            executionGate,
            lendingGate,
            routeHint,
          }}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="animate-spin mb-4">
              <div className="w-8 h-8 border-2 border-slate-700 border-t-cyan-400 rounded-full" />
            </div>
            <p className="text-slate-400">Loading Trade Desk...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Error Bar */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="px-4 py-3 bg-red-900/20 border border-red-700 text-red-200 text-sm flex items-center justify-between"
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-300 hover:text-red-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {trustSurfaceWiringEnabled && executionGate.mode !== "allow" && (
        <div className="px-4 py-2 bg-amber-900/20 border border-amber-700 text-amber-200 text-xs">
          Execution gate: {executionGate.mode.toUpperCase()}
          {executionGate.reasons.length ? ` (${executionGate.reasons.join(", ")})` : ""}
        </div>
      )}

      {/* Header */}
      <Header
        userReputation={userReputation}
        stats={headerStats}
        trust={{
          enabled: trustSurfaceWiringEnabled,
          executionGate,
          lendingGate,
          routeHint,
        }}
      />

      {/* Main Layout */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {/* Left: Opportunity List */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <OpportunityList
            onSelectOpportunity={(opp) => setSelectedOpportunity(opp)}
            autoHighlight={true}
            maxOpportunities={20}
          />
        </div>

      {/* Right: Execution Panel or Market Info */}
      <AnimatePresence mode="wait">
        {selectedOpportunity ? (
          <motion.div
            key="execution-panel"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-96 flex flex-col min-w-0 overflow-hidden"
          >
            <ExecutionPanel
              opportunity={selectedOpportunity}
              onExecute={handleExecute}
              onCancel={handleCancel}
              userReputation={userReputation || undefined}
            />
          </motion.div>
        ) : (
          <motion.div
            key="right-panel"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-96 flex flex-col min-w-0 overflow-hidden"
          >
            {/* Tab Buttons */}
            <div className="flex gap-2 mb-4 p-2 bg-slate-900 rounded-lg border border-slate-700">
              <button
                onClick={() => setRightPanelMode("market")}
                className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors ${
                  rightPanelMode === "market"
                    ? "bg-slate-700 text-cyan-400"
                    : "bg-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Market
              </button>
              <button
                onClick={() => setRightPanelMode("privacy")}
                className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors ${
                  rightPanelMode === "privacy"
                    ? "bg-slate-700 text-cyan-400"
                    : "bg-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Privacy
              </button>
              <button
                onClick={() => setRightPanelMode("credit")}
                className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-colors ${
                  rightPanelMode === "credit"
                    ? "bg-slate-700 text-cyan-400"
                    : "bg-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Credit
              </button>
            </div>

            {/* Panel Content */}
            <AnimatePresence mode="wait">
              {rightPanelMode === "market" && (
                <motion.div
                  key="market"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <MarketInfoPanel
                    marketContext={marketContext}
                    insights={insights}
                    loading={loading}
                  />
                </motion.div>
              )}

              {rightPanelMode === "privacy" && userAddress && (
                <motion.div
                  key="privacy"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <PrivacyPoolPanel userAddress={userAddress} />
                </motion.div>
              )}

              {rightPanelMode === "credit" && userAddress && (
                <motion.div
                  key="credit"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <CreditLinePanel userAddress={userAddress} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* Memory Lane - Optional Bottom Panel */}
      {showMemoryLane && receipts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-t border-slate-700 bg-slate-900/50"
        >
          <MemoryLane
            receipts={receipts}
            userAddress={userAddress}
            compact={true}
            showFilters={true}
            limit={10}
            loading={false}
          />
        </motion.div>
      )}

      {/* Close Button (if provided) */}
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
