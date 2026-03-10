import { describe, it, expect, beforeEach, vi } from "vitest";
import { MarketDataService } from "../MarketDataService";
import type { Opportunity, PoolData, MarketContext } from "../types";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe("MarketDataService", () => {
  let service: MarketDataService;

  beforeEach(() => {
    service = new MarketDataService();
    apiFetchMock.mockReset();
  });

  describe("getOpportunities", () => {
    const mockOpportunities: Opportunity[] = [
      {
        id: "opp-1",
        name: "ETH/USDC Swap",
        description: "Swap ETH for USDC",
        type: "swap",
        tokenA: "ETH",
        tokenB: "USDC",
        currentYield: 0,
        riskScore: 10,
        privacyModes: ["public"],
        source: "zkGraph",
        updatedAt: "2026-03-07T10:00:00Z",
      },
    ];

    it("tries live endpoint first and then list endpoint as fallback", async () => {
      apiFetchMock.mockRejectedValueOnce(new Error("live endpoint down"));
      apiFetchMock.mockResolvedValueOnce({ opportunities: mockOpportunities });

      const result = await service.getOpportunities();

      expect(result).toEqual(mockOpportunities);
      expect(apiFetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/v1/zkdefi/opportunities/live",
        { method: "GET" }
      );
      expect(apiFetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/v1/zkdefi/opportunities/list",
        { method: "GET" }
      );
    });

    it("includes all query filters in request URL", async () => {
      apiFetchMock.mockResolvedValueOnce({ opportunities: mockOpportunities });

      await service.getOpportunities({
        type: "lp",
        minYield: 10,
        maxRisk: 40,
        privacyMode: "public",
      });

      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("type=lp"),
        { method: "GET" }
      );
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("minYield=10"),
        { method: "GET" }
      );
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("maxRisk=40"),
        { method: "GET" }
      );
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("privacyMode=public"),
        { method: "GET" }
      );
    });

    it("throws when all opportunity sources fail or return empty", async () => {
      apiFetchMock.mockResolvedValueOnce({ opportunities: [] });
      apiFetchMock.mockResolvedValueOnce([]);

      await expect(service.getOpportunities({ minYield: 100 })).rejects.toThrow(
        "Failed to fetch opportunities from any source"
      );
    });

    it("caches unfiltered opportunities for 30 seconds", async () => {
      apiFetchMock.mockResolvedValueOnce(mockOpportunities);

      const result1 = await service.getOpportunities();
      const result2 = await service.getOpportunities();

      expect(result1).toEqual(result2);
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPoolData", () => {
    it("fetches pool data by poolId", async () => {
      const mockPoolData: PoolData = {
        poolId: "pool-eth-usdc",
        token0: "ETH",
        token1: "USDC",
        liquidity: 5000000,
        volume24h: 1500000,
        apy: 12.5,
        tvl: 5000000,
        fee: 0.05,
        riskFactors: { impermanentLoss: 2.5, slippage: 1.2 },
        lastUpdated: "2026-03-07T10:00:00Z",
      };

      apiFetchMock.mockResolvedValueOnce(mockPoolData);

      const result = await service.getPoolData("pool-eth-usdc");

      expect(result).toEqual(mockPoolData);
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/v1/zkdefi/pools/pool-eth-usdc/data",
        { method: "GET" }
      );
    });
  });

  describe("getMarketContext", () => {
    it("fetches market context", async () => {
      const mockContext: MarketContext = {
        volatilityIndex: 65,
        sentiment: "neutral",
        riskWarnings: ["Stablecoin depegging risk"],
        trendingPairs: [
          { tokenA: "ETH", tokenB: "USDC", volume24h: 2000000 },
          { tokenA: "STRK", tokenB: "USDC", volume24h: 1500000 },
        ],
        timestamp: "2026-03-07T10:00:00Z",
      };

      apiFetchMock.mockResolvedValueOnce(mockContext);

      const result = await service.getMarketContext();
      expect(result).toEqual(mockContext);
    });
  });

  describe("streamOpportunities", () => {
    it("returns a subscribable stream that emits opportunities", async () => {
      const mockOpportunities: Opportunity[] = [
        {
          id: "opp-stream-1",
          name: "Streaming Opp",
          description: "Real-time opportunity",
          type: "swap",
          currentYield: 0,
          riskScore: 10,
          privacyModes: ["public"],
          source: "zkGraph",
          updatedAt: "2026-03-07T10:00:00Z",
        },
      ];

      apiFetchMock.mockResolvedValueOnce(mockOpportunities);

      const observable = service.streamOpportunities();

      await new Promise<void>((resolve) => {
        observable.subscribe((opps) => {
          expect(opps).toEqual(mockOpportunities);
          resolve();
        });
      });
    });
  });
});
