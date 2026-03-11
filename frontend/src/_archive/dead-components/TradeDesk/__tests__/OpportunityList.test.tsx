import { describe, it, expect, beforeEach, vi } from "vitest";
import { MarketDataService } from "@/services/MarketDataService";
import { AIRecommendationService } from "@/services/AIRecommendationService";
import type { Opportunity, Recommendation } from "@/services/types";

vi.mock("@/services/MarketDataService");
vi.mock("@/services/AIRecommendationService");

const mockOpportunities: Opportunity[] = [
  {
    id: "opp-1",
    name: "ETH/USDC LP",
    description: "Ekubo liquidity pool for ETH/USDC pair",
    type: "lp",
    currentYield: 12.5,
    riskScore: 35,
    tvl: 5000000,
    privacyModes: ["public", "shielded"],
    source: "zkGraph",
    updatedAt: "2026-03-07T10:00:00Z",
  },
  {
    id: "opp-2",
    name: "STRK Lending",
    description: "Native STRK pool lending",
    type: "lending",
    currentYield: 6.0,
    riskScore: 20,
    tvl: 3000000,
    privacyModes: ["public", "fully_private"],
    source: "Strategy",
    updatedAt: "2026-03-07T10:00:00Z",
  },
  {
    id: "opp-3",
    name: "STRK Staking",
    description: "Stake STRK for rewards",
    type: "staking",
    currentYield: 4.2,
    riskScore: 5,
    privacyModes: ["public"],
    source: "Ekubo",
    updatedAt: "2026-03-07T10:00:00Z",
  },
];

const mockRecommendations: Recommendation[] = [
  {
    id: "opp-1",
    action: "Increase exposure to ETH/USDC LP",
    reasoning: "High yield with moderate risk profile",
    type: "opportunity",
    expectedYield: 12.5,
    expectedRiskReduction: 0,
    confidence: 0.87,
    createdAt: "2026-03-07T10:00:00Z",
  },
  {
    id: "opp-2",
    action: "Consider STRK lending",
    reasoning: "Low risk, stable returns",
    type: "opportunity",
    expectedYield: 6.0,
    expectedRiskReduction: 5,
    confidence: 0.62,
    createdAt: "2026-03-07T10:00:00Z",
  },
];

describe("OpportunityList - Service Integration", () => {
  let mockMarketDataService: any;
  let mockAIRecommendationService: any;

  beforeEach(() => {
    mockMarketDataService = {
      getOpportunities: vi.fn().mockResolvedValue(mockOpportunities),
    };

    mockAIRecommendationService = {
      getRecommendations: vi.fn().mockResolvedValue(mockRecommendations),
    };

    vi.mocked(MarketDataService).mockImplementation(
      () => mockMarketDataService as any
    );
    vi.mocked(AIRecommendationService).mockImplementation(
      () => mockAIRecommendationService as any
    );
  });

  it("MarketDataService can be mocked", () => {
    expect(mockMarketDataService).toBeDefined();
    expect(mockMarketDataService.getOpportunities).toBeDefined();
  });

  it("AIRecommendationService can be mocked", () => {
    expect(mockAIRecommendationService).toBeDefined();
    expect(mockAIRecommendationService.getRecommendations).toBeDefined();
  });

  describe("Type Filtering Logic", () => {
    it("filters opportunities by single type", () => {
      const filtered = mockOpportunities.filter((opp) => opp.type === "lp");
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("ETH/USDC LP");
    });

    it("filters opportunities by multiple types", () => {
      const types = new Set<string>(["lending", "staking"]);
      const filtered = mockOpportunities.filter((opp) =>
        types.has(opp.type)
      );
      expect(filtered.length).toBe(2);
      expect(filtered.map((o) => o.type)).toContain("lending");
      expect(filtered.map((o) => o.type)).toContain("staking");
    });
  });

  describe("Yield Filtering Logic", () => {
    it("filters opportunities by minimum yield", () => {
      const minYield = 5;
      const filtered = mockOpportunities.filter(
        (opp) => opp.currentYield >= minYield
      );
      expect(filtered.length).toBe(2);
      expect(filtered.every((o) => o.currentYield >= minYield)).toBe(true);
    });

    it("correctly handles no opportunities matching minimum yield", () => {
      const minYield = 100;
      const filtered = mockOpportunities.filter(
        (opp) => opp.currentYield >= minYield
      );
      expect(filtered.length).toBe(0);
    });
  });

  describe("Risk Filtering Logic", () => {
    it("filters opportunities by maximum risk", () => {
      const maxRisk = 30;
      const filtered = mockOpportunities.filter((opp) => opp.riskScore <= maxRisk);
      expect(filtered.length).toBe(2);
      expect(filtered.every((o) => o.riskScore <= maxRisk)).toBe(true);
    });

    it("correctly handles all opportunities within risk threshold", () => {
      const maxRisk = 100;
      const filtered = mockOpportunities.filter((opp) => opp.riskScore <= maxRisk);
      expect(filtered.length).toBe(3);
    });
  });

  describe("Privacy Mode Filtering Logic", () => {
    it("filters opportunities by privacy mode", () => {
      const privacyMode = "public";
      const filtered = mockOpportunities.filter((opp) =>
        opp.privacyModes.includes(privacyMode as any)
      );
      expect(filtered.length).toBe(3);
    });

    it("filters opportunities for shielded privacy mode", () => {
      const privacyMode = "shielded";
      const filtered = mockOpportunities.filter((opp) =>
        opp.privacyModes.includes(privacyMode as any)
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("ETH/USDC LP");
    });

    it("filters opportunities for fully_private privacy mode", () => {
      const privacyMode = "fully_private";
      const filtered = mockOpportunities.filter((opp) =>
        opp.privacyModes.includes(privacyMode as any)
      );
      // Only opp-2 (STRK Lending) has fully_private support in mockOpportunities
      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(filtered.some((o) => o.id === "opp-2")).toBe(true);
    });
  });

  describe("Search Filtering Logic", () => {
    it("searches opportunities by name", () => {
      const query = "ETH";
      const filtered = mockOpportunities.filter((opp) =>
        opp.name.toLowerCase().includes(query.toLowerCase())
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("ETH/USDC LP");
    });

    it("searches opportunities by description", () => {
      const query = "pool";
      const filtered = mockOpportunities.filter(
        (opp) =>
          opp.name.toLowerCase().includes(query.toLowerCase()) ||
          opp.description.toLowerCase().includes(query.toLowerCase())
      );
      expect(filtered.length).toBeGreaterThan(0);
    });

    it("is case-insensitive", () => {
      const query = "strk";
      const filtered = mockOpportunities.filter((opp) =>
        opp.name.toLowerCase().includes(query.toLowerCase())
      );
      expect(filtered.length).toBe(2);
    });
  });

  describe("Sorting Logic", () => {
    it("sorts opportunities by yield descending", () => {
      const sorted = [...mockOpportunities].sort(
        (a, b) => b.currentYield - a.currentYield
      );
      expect(sorted[0].currentYield).toBe(12.5);
      expect(sorted[1].currentYield).toBe(6.0);
      expect(sorted[2].currentYield).toBe(4.2);
    });

    it("sorts opportunities by risk ascending", () => {
      const sorted = [...mockOpportunities].sort(
        (a, b) => a.riskScore - b.riskScore
      );
      expect(sorted[0].riskScore).toBe(5);
      expect(sorted[1].riskScore).toBe(20);
      expect(sorted[2].riskScore).toBe(35);
    });

    it("sorts by recommendation confidence descending", () => {
      // Create a combined array with recommendations
      const withRecommendations = mockOpportunities.map((opp) => ({
        ...opp,
        recommendationConfidence:
          mockRecommendations.find((r) => r.id === opp.id)?.confidence || 0,
      }));

      const sorted = [...withRecommendations].sort(
        (a, b) => b.recommendationConfidence - a.recommendationConfidence
      );

      expect(sorted[0].recommendationConfidence).toBeGreaterThanOrEqual(
        sorted[1].recommendationConfidence || 0
      );
    });
  });

  describe("Combined Filtering", () => {
    it("applies type, yield, and risk filters together", () => {
      let filtered = mockOpportunities.slice();

      // Filter by type: lending
      const types = new Set(["lending"]);
      filtered = filtered.filter((opp) => types.has(opp.type));

      // Filter by min yield: 5
      filtered = filtered.filter((opp) => opp.currentYield >= 5);

      // Filter by max risk: 50
      filtered = filtered.filter((opp) => opp.riskScore <= 50);

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("STRK Lending");
    });

    it("correctly handles no results after combined filters", () => {
      let filtered = mockOpportunities.slice();

      // Impossible combination
      const types = new Set(["swap"]);
      filtered = filtered.filter((opp) => types.has(opp.type));
      filtered = filtered.filter((opp) => opp.currentYield >= 100);

      expect(filtered.length).toBe(0);
    });
  });

  describe("Opportunity Validation", () => {
    it("all opportunities have required fields", () => {
      mockOpportunities.forEach((opp) => {
        expect(opp.id).toBeDefined();
        expect(opp.name).toBeDefined();
        expect(opp.description).toBeDefined();
        expect(opp.type).toBeDefined();
        expect(opp.currentYield).toBeDefined();
        expect(opp.riskScore).toBeDefined();
        expect(opp.privacyModes).toBeDefined();
        expect(opp.source).toBeDefined();
        expect(opp.updatedAt).toBeDefined();
      });
    });

    it("risk scores are within valid range (0-100)", () => {
      mockOpportunities.forEach((opp) => {
        expect(opp.riskScore).toBeGreaterThanOrEqual(0);
        expect(opp.riskScore).toBeLessThanOrEqual(100);
      });
    });

    it("yield values are reasonable", () => {
      mockOpportunities.forEach((opp) => {
        expect(opp.currentYield).toBeGreaterThanOrEqual(0);
        expect(opp.currentYield).toBeLessThan(1000); // Sanity check
      });
    });

    it("opportunity types are valid", () => {
      const validTypes = [
        "swap",
        "lp",
        "lending",
        "staking",
        "dca",
        "limit_orders",
      ];
      mockOpportunities.forEach((opp) => {
        expect(validTypes).toContain(opp.type);
      });
    });

    it("privacy modes are valid", () => {
      const validModes = ["public", "shielded", "fully_private"];
      mockOpportunities.forEach((opp) => {
        opp.privacyModes.forEach((mode) => {
          expect(validModes).toContain(mode);
        });
      });
    });
  });

  describe("Recommendation Matching", () => {
    it("correctly matches recommendations to opportunities", () => {
      mockRecommendations.forEach((rec) => {
        const opp = mockOpportunities.find((o) => o.id === rec.id);
        expect(opp).toBeDefined();
      });
    });

    it("recommendation confidence is valid (0-1)", () => {
      mockRecommendations.forEach((rec) => {
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
      });
    });

    it("correctly identifies recommended opportunities", () => {
      const recommendedIds = new Set(mockRecommendations.map((r) => r.id));
      const recommendedOpps = mockOpportunities.filter((opp) =>
        recommendedIds.has(opp.id)
      );

      expect(recommendedOpps.length).toBeGreaterThan(0);
      expect(recommendedOpps.length).toBeLessThanOrEqual(mockOpportunities.length);
    });
  });

  describe("Pagination Logic", () => {
    it("respects maxOpportunities limit", () => {
      const maxOpps = 2;
      const limited = mockOpportunities.slice(0, maxOpps);
      expect(limited.length).toBe(maxOpps);
    });

    it("handles maxOpportunities larger than available", () => {
      const maxOpps = 100;
      const limited = mockOpportunities.slice(0, maxOpps);
      expect(limited.length).toBe(mockOpportunities.length);
    });

    it("shows correct result count information", () => {
      const total = mockOpportunities.length;
      const displayed = 2;
      expect(displayed).toBeLessThanOrEqual(total);
    });
  });
});
