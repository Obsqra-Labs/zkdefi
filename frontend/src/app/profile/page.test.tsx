import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import ProfilePage from "./page";

const useAccountMock = vi.fn();
const useWalletSettledMock = vi.fn();
const useRiskProfileV2Mock = vi.fn();
const useLinkedAddressesMock = vi.fn();
const getUserSessionsMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("@starknet-react/core", () => ({
  useAccount: () => useAccountMock(),
}));

vi.mock("@/lib/useWalletSettled", () => ({
  useWalletSettled: () => useWalletSettledMock(),
}));

vi.mock("@/components/zkdefi/ConnectButton", () => ({
  ConnectButton: () => <button type="button">Connect</button>,
}));

vi.mock("@/hooks/useProfile", () => ({
  useRiskProfileV2: (...args: unknown[]) => useRiskProfileV2Mock(...args),
  useLinkedAddresses: (...args: unknown[]) => useLinkedAddressesMock(...args),
}));

vi.mock("@/lib/sessionKeys", () => ({
  getUserSessions: (...args: unknown[]) => getUserSessionsMock(...args),
  generateSessionRequest: vi.fn(),
  confirmSessionGrant: vi.fn(),
  revokeSession: vi.fn(),
  confirmSessionRevoke: vi.fn(),
  formatTimeRemaining: () => "1h 0m",
}));

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<{ apiUrl: (path: string) => string }>("@/lib/api/client");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  };
});

vi.mock("@/lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

function mockCommonHooks() {
  useWalletSettledMock.mockReturnValue({ settled: true });

  useLinkedAddressesMock.mockReturnValue({
    linked: { eth: "", arb: "", base: "", opt: "" },
    draft: { eth: "", arb: "", base: "", opt: "" },
    setDraft: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    saving: false,
    linkedVerification: {},
    startVerify: vi.fn(),
    completeVerify: vi.fn(),
    verifying: false,
  });

  getUserSessionsMock.mockResolvedValue([]);
  apiFetchMock.mockResolvedValue({ proofs: [] });
}

describe("ProfilePage V2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommonHooks();
  });

  it("renders connect prompt when wallet is disconnected", async () => {
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false });
    useRiskProfileV2Mock.mockReturnValue({
      profile: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText("Connect wallet to open Profile V2")).toBeTruthy();
    });
  });

  it("renders four trust lenses and fallback safety banner when v2 API fails", async () => {
    useAccountMock.mockReturnValue({
      address: "0x123",
      isConnected: true,
    });
    useRiskProfileV2Mock.mockReturnValue({
      profile: {
        profile_version: "2.0",
        address: "0x123",
        identity: {
          has_agent: true,
          linked_addresses: [],
          session_summary: { count: 0, active_count: 0 },
          dual_wallet_session: { active: false, status: "missing" },
        },
        reputation: {
          tier: 2,
          tier_name: "Active",
          tenure_days: 14,
          transaction_count: 10,
          successful_txns: 8,
          collateral_eth: 0.4,
          total_volume_eth: 2.1,
        },
        passport: {
          composite_score: 68,
          letter_rating: "B",
          tier: 2,
          tier_name: "Active",
          receipt_summary: { count: 0, by_type: {} },
        },
        governance: {
          voting_power: 3.2,
          lp_usd: 1000,
          lending_usd: 250,
          staking_usd: 100,
          tier_multiplier: 1.1,
          formula_version: "vp_v2",
        },
        decisions: {
          relayer: { mode: "advisory", reason_codes: [] },
          execution: { mode: "advisory", reason_codes: [] },
          lending: { mode: "allow", reason_codes: [] },
        },
      },
      loading: false,
      error: "backend unavailable",
      refetch: vi.fn(),
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/V2 profile unavailable/i)).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: /Identity/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reputation/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Credit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Governance/i })).toBeTruthy();
  });
});
