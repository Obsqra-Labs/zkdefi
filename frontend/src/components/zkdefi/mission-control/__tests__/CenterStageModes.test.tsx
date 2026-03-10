import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CenterStageModes } from "../CenterStageModes";

const apiFetchMock = vi.fn().mockResolvedValue({});

vi.mock("@/lib/api/client", () => ({
  API_BASE: "http://localhost:8003",
  apiFetch: (...args: any[]) => apiFetchMock(...args),
  apiUrl: (path: string) => `http://localhost:8003${path}`,
}));

vi.mock("@/lib/api/ekubo", () => ({
  getEkuboPositions: vi.fn().mockResolvedValue({ positions: [] }),
}));

vi.mock("../UnifiedStream", () => ({
  UnifiedStream: () => <div data-testid="unified-stream">stream mock</div>,
}));

vi.mock("../GovernanceOverlay", () => ({
  GovernanceOverlay: () => <div data-testid="governance-overlay">governance mock</div>,
}));

vi.mock("@/components/zkdefi/surfaces/OracleSurfaceContainer", () => ({
  OracleSurfaceContainer: () => <div data-testid="oracle-surface">oracle mock</div>,
}));

vi.mock("../PrivacyPoolsPanel", () => ({
  PrivacyPoolsPanel: () => <div data-testid="privacy-pools">pools mock</div>,
}));

vi.mock("../PoolIntelligencePanel", () => ({
  PoolIntelligencePanel: () => <div data-testid="pool-intel-panel">pool intel mock</div>,
}));

vi.mock("../PoolIntelligence", () => ({
  PoolIntelligence: () => <div data-testid="pool-intelligence">pool intelligence mock</div>,
}));

vi.mock("@/components/zkdefi/EkuboPositionsList", () => ({
  EkuboPositionsList: () => <div data-testid="ekubo-list">ekubo mock</div>,
  computeEkuboStats: () => ({ totalPositions: 0, earningCount: 0, idleCount: 0, avgApr: 0, groups: [] }),
  formatAmount: (v: number) => String(v),
  tokenLabel: (t: string) => t,
}));

vi.mock("@/components/zkdefi/LendingConsole", () => ({
  LendingConsole: () => <div data-testid="lending-console">lending mock</div>,
}));

vi.mock("@/components/zkdefi/vault/EnrichedActivityTab", () => ({
  EnrichedActivityTab: () => <div data-testid="activity-tab">activity mock</div>,
}));

vi.mock("@/components/zkdefi/TradeDesk", () => ({
  TradeDesk: () => <div data-testid="trade-desk">trade mock</div>,
}));

vi.mock("@/components/zkdefi/MarketplaceConsole", () => ({
  MarketplaceConsole: () => <div data-testid="marketplace-console">marketplace mock</div>,
}));

vi.mock("@/components/zkdefi/vault/VaultHealthMeter", () => ({
  VaultHealthMeter: () => <div data-testid="health-meter">health mock</div>,
}));

vi.mock("@/components/zkdefi/vault/PositionsOverview", () => ({
  __esModule: true,
  default: () => <div data-testid="positions-overview">positions mock</div>,
}));

vi.mock("@/components/zkdefi/vault/ConstraintGuard", () => ({
  ConstraintGuard: () => <div data-testid="constraint-guard">constraint mock</div>,
}));

vi.mock("@/hooks/useAdapterRegistry", () => ({
  useAdapterRegistry: () => ({ adapters: [] }),
}));

vi.mock("@/hooks/useVaultController", () => ({
  useVaultController: () => ({ cooldownRemaining: 0 }),
}));

vi.mock("@/hooks/useVaultSummary", () => ({
  useVaultSummary: () => ({ loading: false, strk_balance: 100, eth_balance: 0.5, total_usd: 500 }),
}));

vi.mock("@/hooks/useHealthPassport", () => ({
  useHealthPassport: () => ({ loading: false, tier: 2, trust_score: 75, proof_count: 3, proofs_required: 5 }),
}));

vi.mock("@/lib/telemetry", () => ({
  trackEvent: vi.fn(),
}));

describe("CenterStageModes", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({});
  });

  it("renders unified stream and vault tabs, and switches between them", () => {
    render(<CenterStageModes address="0xabc" />);

    // UnifiedStream should render
    expect(screen.getByTestId("unified-stream")).toBeTruthy();

    // Oracle surface renders in the intelligence section
    expect(screen.getByTestId("oracle-surface")).toBeTruthy();

    // Default tab is overview — should show vault overview components
    expect(screen.getByTestId("positions-overview")).toBeTruthy();
    expect(screen.getByTestId("health-meter")).toBeTruthy();

    // Switch to Activity tab
    fireEvent.click(screen.getByText("Activity"));
    expect(screen.getByTestId("activity-tab")).toBeTruthy();

    // Switch to Pools tab
    fireEvent.click(screen.getByText("Pools"));
    expect(screen.getByTestId("pool-intel-panel")).toBeTruthy();

    // Switch to Lending tab
    fireEvent.click(screen.getByText("Lending"));
    expect(screen.getByTestId("lending-console")).toBeTruthy();
  });
});
