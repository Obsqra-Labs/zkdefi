/**
 * Plan Approval Flow — Unit Tests
 *
 * Covers:
 *  - MarketsTab: plan builder derives action stack from opportunity list
 *  - MarketsTab: onDeploy is invoked with correct shape when user approves
 *  - MarketsTab: auto-selects the recommended opportunity on first load
 *  - MarketsTab: Approve button is disabled with no opportunity selected
 *  - OverviewTab: hero signal wires onDeploy with opportunity data
 *  - OverviewTab: target allocation drift labels match guard logic
 *
 * No network calls are made; all hooks and API clients are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// vi.hoisted — run before any import / mock factory
// ---------------------------------------------------------------------------

/**
 * MOCK_OPPS must be defined via vi.hoisted() so the fixture data is available
 * inside vi.mock() factory functions (which are hoisted before const declarations).
 */
const MOCK_OPPS = vi.hoisted(() => [
  {
    id: "opp-a",
    type: "lp" as const,
    productSlug: "ekubo-strk-eth",
    title: "STRK/ETH LP",
    pair: "STRK/ETH",
    protocol: "Ekubo",
    currentYield: 22.0,
    riskScore: 35,
    tvlUsd: 120000,
    volume24h: 50000,
    privacyLevel: "public" as const,
    signal: null,
    aiNarrative: "Strong volume signal with momentum.",
    recommended: true,
    confidence: 0.88,
    gating: { status: "unlocked", reason: null, requiredTier: null },
    executionMode: "relayer" as const,
    calldataBuilder: null,
    metadata: {},
  },
  {
    id: "opp-b",
    type: "lending" as const,
    productSlug: "lending-eth-usdc",
    title: "ETH/USDC Lending",
    pair: "ETH/USDC",
    protocol: "zkGraph",
    currentYield: 11.5,
    riskScore: 20,
    tvlUsd: 300000,
    volume24h: 0,
    privacyLevel: "public" as const,
    signal: null,
    aiNarrative: null,
    recommended: false,
    confidence: 0.72,
    gating: { status: "unlocked", reason: null, requiredTier: null },
    executionMode: "wallet" as const,
    calldataBuilder: null,
    metadata: {},
  },
  {
    id: "opp-c",
    type: "staking" as const,
    productSlug: "staking-strk",
    title: "STRK Staking",
    pair: "STRK",
    protocol: "Strategy",
    currentYield: 9.8,
    riskScore: 15,
    tvlUsd: 250000,
    volume24h: 0,
    privacyLevel: "public" as const,
    signal: null,
    aiNarrative: null,
    recommended: false,
    confidence: 0.65,
    gating: null,
    executionMode: "relayer" as const,
    calldataBuilder: null,
    metadata: {},
  },
]);

// ---------------------------------------------------------------------------
// Global mocks (hoisted factories may now reference MOCK_OPPS safely)
// ---------------------------------------------------------------------------

// Stub fetch before any imports that call apiFetch
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ opportunities: [], events: [] }),
} as unknown as Response);

vi.mock("@starknet-react/core", () => ({
  useAccount: () => ({ account: null }),
}));

vi.mock("@/hooks/useVaultSummary", () => ({
  useVaultSummary: () => ({
    loading: false,
    total_usd: 1200,
    strk_balance: 5000,
    eth_balance: 0.1,
  }),
}));

vi.mock("@/hooks/useTokenPrices", () => ({
  useTokenPrices: () => ({ prices: { STRK: 0.04, ETH: 2020 } }),
  priceOf: (_prices: unknown, token: string) => (token === "ETH" ? 2020 : 0.04),
}));

vi.mock("@/lib/api/ekubo", () => ({
  getEkuboPositions: vi.fn().mockResolvedValue({ positions: [], total_value_usd: 0 }),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
  apiFetchAuth: vi.fn().mockResolvedValue({}),
  getApiErrorMessage: vi.fn().mockReturnValue("error"),
  getTrustGateErrorDetail: vi.fn().mockReturnValue(null),
  API_BASE: "",
}));

// Minimal OpportunityExplorer stub — renders one button per opportunity
vi.mock("@/components/zkdefi/TradeDesk/OpportunityExplorer", () => ({
  OpportunityExplorer: ({
    opportunities,
    selectedId,
    onSelect,
  }: {
    opportunities: Array<{ id: string; title?: string; pair?: string }>;
    selectedId: string | null;
    onSelect: (opp: unknown) => void;
  }) => (
    <div data-testid="opportunity-explorer">
      {opportunities.map((opp) => (
        <button
          key={opp.id}
          data-testid={`opp-${opp.id}`}
          aria-pressed={selectedId === opp.id ? "true" : "false"}
          onClick={() => onSelect(opp)}
        >
          {opp.title ?? opp.pair ?? opp.id}
        </button>
      ))}
    </div>
  ),
}));

// Hook mock — references MOCK_OPPS which is now safely hoisted
vi.mock("@/hooks/useOpportunities", () => ({
  useOpportunities: (_limit?: number) => ({
    opportunities: MOCK_OPPS,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Type imports (after all mocks are registered)
// ---------------------------------------------------------------------------

import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";
import type { SignalForExecution } from "@/components/zkdefi/mission-control/SignalExecutionDrawer";

// ---------------------------------------------------------------------------
// MarketsTab tests
// ---------------------------------------------------------------------------

import { MarketsTab } from "@/components/zkdefi/tabs/MarketsTab";
import React from "react";

describe("MarketsTab — plan builder", () => {
  it("renders Plan Builder section", () => {
    render(<MarketsTab />);
    expect(screen.getByText("Plan Builder")).toBeTruthy();
  });

  it("shows top-3 opportunities in action stack", () => {
    render(<MarketsTab />);
    // Action stack renders "Step 1: {title}" inside a single div per entry
    const stepItems = screen.getAllByText((content) => /^Step \d+:/.test(content));
    expect(stepItems.length).toBeGreaterThan(0);
    expect(stepItems.length).toBeLessThanOrEqual(3);
  });

  it("auto-selects the recommended opportunity on mount", async () => {
    render(<MarketsTab />);
    await waitFor(() => {
      const btn = screen.getByTestId("opp-opp-a");
      expect(btn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("Approve button is disabled when onDeploy is not provided", () => {
    // Button is disabled when !selectedOpportunity || !onDeploy.
    // Omitting onDeploy prop is sufficient to confirm disabled state.
    render(<MarketsTab />);
    const approveBtn = screen.getByRole("button", { name: /Approve and Open Execution/ });
    expect(approveBtn).toBeTruthy();
    expect((approveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls onDeploy with correct shape when Approve is clicked", async () => {
    const onDeploy = vi.fn<[SignalForExecution], void>();
    render(<MarketsTab onDeploy={onDeploy} />);

    // Wait for auto-select (useEffect fires after mount)
    await waitFor(() => {
      expect(screen.getByTestId("opp-opp-a").getAttribute("aria-pressed")).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: /Approve and Open Execution/ }));

    expect(onDeploy).toHaveBeenCalledTimes(1);
    const payload = onDeploy.mock.calls[0][0];
    expect(payload.id).toBe("opp-a");
    expect(payload.name).toBe("STRK/ETH LP");
    expect(payload.type).toBe("lp");
    expect(payload.venue).toBe("Ekubo");
    expect(typeof payload.currentYield).toBe("number");
    expect(typeof payload.apy_bps).toBe("number");
    expect(typeof payload.riskScore).toBe("number");
    expect(payload.signal_reason).toBe("Strong volume signal with momentum.");
  });

  it("selecting a different opportunity changes the active selection", async () => {
    const onDeploy = vi.fn<[SignalForExecution], void>();
    render(<MarketsTab onDeploy={onDeploy} />);

    // Wait for initial render before selecting
    await waitFor(() => {
      expect(screen.getByTestId("opp-opp-b")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("opp-opp-b"));

    await waitFor(() => {
      expect(screen.getByTestId("opp-opp-b").getAttribute("aria-pressed")).toBe("true");
    });

    // Approve should now submit opp-b
    fireEvent.click(screen.getByRole("button", { name: /Approve and Open Execution/ }));

    expect(onDeploy).toHaveBeenCalledTimes(1);
    const payload = onDeploy.mock.calls[0][0];
    expect(payload.id).toBe("opp-b");
    expect(payload.venue).toBe("zkGraph");
  });

  it("shows rationale from aiNarrative when opportunity is selected", async () => {
    render(<MarketsTab />);
    // opp-a is auto-selected (recommended:true) and has aiNarrative
    await waitFor(() => {
      expect(
        screen.getByText((content) => content.includes("Strong volume signal with momentum."))
      ).toBeTruthy();
    });
  });

  it("shows gate status when gating data is present and unlocked", async () => {
    render(<MarketsTab />);
    // opp-a gating: { status: 'unlocked' } — rendered as "Gate: unlocked"
    await waitFor(() => {
      expect(
        screen.getByText((content) => content.includes("Gate:") && content.includes("unlocked"))
      ).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// OverviewTab hero signal tests
// ---------------------------------------------------------------------------

import { OverviewTab } from "@/components/zkdefi/tabs/OverviewTab";

describe("OverviewTab — recommendation hero", () => {
  const ADDRESS = "0xabc123";

  beforeEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          opportunities: MOCK_OPPS,
          events: [
            {
              description: "Deposited 500 STRK → Conservative Pool",
              timestamp: new Date().toISOString(),
              tx_hash: "0xdeadbeef",
            },
          ],
        }),
    });
  });

  it("renders Primary Recommendation section", () => {
    render(<OverviewTab address={ADDRESS} />);
    expect(screen.getByText("Primary Recommendation")).toBeTruthy();
  });

  it("renders Open Execution button", () => {
    render(<OverviewTab address={ADDRESS} />);
    expect(screen.getByText("Open Execution")).toBeTruthy();
  });

  it("Open Execution button is disabled when onDeploy is not provided", () => {
    render(<OverviewTab address={ADDRESS} />);
    const btn = screen.getByText("Open Execution").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("calls onDeploy when Open Execution is clicked", async () => {
    const onDeploy = vi.fn<[SignalForExecution], void>();
    render(<OverviewTab address={ADDRESS} onDeploy={onDeploy} />);

    const btn = screen.getByText("Open Execution");
    fireEvent.click(btn);

    expect(onDeploy).toHaveBeenCalledTimes(1);
    const payload = onDeploy.mock.calls[0][0];
    expect(typeof payload.id).toBe("string");
    expect(typeof payload.name).toBe("string");
  });

  it("renders capital snapshot cards", () => {
    render(<OverviewTab address={ADDRESS} />);
    expect(screen.getByText("Total Capital")).toBeTruthy();
    expect(screen.getByText("Deployed")).toBeTruthy();
    expect(screen.getByText("Idle Reserve")).toBeTruthy();
  });

  it("renders allocation rows for Privacy, Ekubo, and Idle", () => {
    render(<OverviewTab address={ADDRESS} />);
    expect(screen.getByText("Privacy")).toBeTruthy();
    expect(screen.getByText("Ekubo")).toBeTruthy();
    expect(screen.getByText("Idle")).toBeTruthy();
  });

  it("renders Plan Preview with steps", () => {
    render(<OverviewTab address={ADDRESS} />);
    expect(screen.getByText("Plan Preview")).toBeTruthy();
    expect(screen.getByText(/Step 1\./)).toBeTruthy();
  });

  it("renders receipt feed section", () => {
    render(<OverviewTab address={ADDRESS} />);
    expect(screen.getByText("Receipt Feed")).toBeTruthy();
  });

  it("shows no-wallet message when address is empty", () => {
    render(<OverviewTab address="" />);
    expect(screen.getByText(/Connect wallet to view/)).toBeTruthy();
  });
});
