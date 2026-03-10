import { describe, it, expect, beforeEach, vi } from "vitest";
import { AIRecommendationService } from "../AIRecommendationService";
import type { Recommendation, RebalanceSuggestion, MarketInsights } from "../types";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe("AIRecommendationService", () => {
  let service: AIRecommendationService;

  const mockRecommendation: Recommendation = {
    id: "rec-1",
    action: "Increase staking allocation to 30%",
    reasoning: "Low risk profile matches conservative goals",
    type: "yield",
    expectedYield: 6,
    expectedRiskReduction: 0,
    confidence: 0.92,
    createdAt: "2026-03-07T10:00:00Z",
  };

  beforeEach(() => {
    service = new AIRecommendationService();
    apiFetchMock.mockReset();
  });

  describe("getRecommendations", () => {
    it("uses live recommendations when available", async () => {
      apiFetchMock.mockResolvedValueOnce([mockRecommendation]);

      const result = await service.getRecommendations({
        currentPortfolio: { staking: 0.2, lending: 0.3 },
        riskProfile: "conservative",
      });

      expect(result).toEqual([mockRecommendation]);
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/v1/zkdefi/ai/recommendations/live",
        { method: "GET" }
      );
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to POST endpoint when live returns empty", async () => {
      apiFetchMock.mockResolvedValueOnce([]);
      apiFetchMock.mockResolvedValueOnce({ recommendations: [mockRecommendation] });

      const context = {
        currentPortfolio: {},
        riskProfile: "moderate" as const,
        goals: ["maximize yield", "minimize tax"],
      };

      const result = await service.getRecommendations(context);

      expect(result).toEqual([mockRecommendation]);
      expect(apiFetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/v1/zkdefi/ai/recommendations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(context),
        })
      );
    });

    it("throws when both live and fallback have no recommendations", async () => {
      apiFetchMock.mockResolvedValueOnce([]);
      apiFetchMock.mockResolvedValueOnce([]);

      await expect(
        service.getRecommendations({
          currentPortfolio: {},
          riskProfile: "conservative",
        })
      ).rejects.toThrow("Failed to fetch recommendations from any source");
    });

    it("handles null portfolio context when fallback provides recommendations", async () => {
      apiFetchMock.mockResolvedValueOnce([]);
      apiFetchMock.mockResolvedValueOnce([mockRecommendation]);

      const result = await service.getRecommendations({
        currentPortfolio: null,
        riskProfile: "moderate",
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });
  });

  describe("getRebalancingSuggestion", () => {
    it("returns rebalancing suggestion payload", async () => {
      const mockSuggestion: RebalanceSuggestion = {
        changes: [
          { opportunityId: "lp-eth-usdc", action: "increase", amount: 5000 },
          { opportunityId: "staking-strk", action: "decrease", amount: 2000 },
        ],
        rationale: "Reduce exposure to staking, increase LP yield",
        expectedRiskReduction: 5,
        expectedYieldImpact: 8,
      };

      apiFetchMock.mockResolvedValueOnce(mockSuggestion);

      const result = await service.getRebalancingSuggestion({
        staking: 0.4,
        lp: 0.2,
        lending: 0.4,
      });

      expect(result).toEqual(mockSuggestion);
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/zkdefi/ai/rebalance", {
        method: "POST",
        body: JSON.stringify({
          portfolio: { staking: 0.4, lp: 0.2, lending: 0.4 },
        }),
      });
    });
  });

  describe("getMarketInsights", () => {
    it("fetches market insights", async () => {
      const mockInsights: MarketInsights = {
        emergingOpportunities: [],
        warnings: ["Increased smart contract risk detected"],
        narrativeExplanation: "Market remains volatile",
        timestamp: "2026-03-07T10:00:00Z",
      };

      apiFetchMock.mockResolvedValueOnce(mockInsights);

      const result = await service.getMarketInsights();
      expect(result).toEqual(mockInsights);
    });
  });

  describe("explainDecision", () => {
    it("returns explanation and alternatives", async () => {
      const mockExplanation = {
        explanation: "Use a limit order for better execution.",
        alternatives: [{ action: "Swap now", rationale: "Immediate fill" }],
      };

      apiFetchMock.mockResolvedValueOnce(mockExplanation);

      const result = await service.explainDecision({
        type: "swap",
        parameters: { tokenIn: "ETH", tokenOut: "USDC", amount: 10 },
      });

      expect(result.explanation).toBeTruthy();
      expect(result.alternatives).toHaveLength(1);
    });
  });

  describe("caching", () => {
    it("caches recommendations for 60 seconds", async () => {
      apiFetchMock.mockResolvedValueOnce([mockRecommendation]);

      const result1 = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: "moderate",
      });
      const result2 = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: "moderate",
      });

      expect(result1).toEqual(result2);
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("throws a unified error when both endpoints fail", async () => {
      apiFetchMock.mockRejectedValueOnce(new Error("live failed"));
      apiFetchMock.mockRejectedValueOnce(new Error("fallback failed"));

      await expect(
        service.getRecommendations({
          currentPortfolio: {},
          riskProfile: "conservative",
        })
      ).rejects.toThrow("Failed to fetch recommendations from any source");
    });

    it("handles malformed live response by trying fallback", async () => {
      apiFetchMock.mockResolvedValueOnce({ invalid: "response" });
      apiFetchMock.mockResolvedValueOnce([mockRecommendation]);

      const result = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: "moderate",
      });

      expect(result).toEqual([mockRecommendation]);
    });
  });
});
