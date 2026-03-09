import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultGovernancePanel } from "../VaultGovernancePanel";

global.fetch = vi.fn();

const mockLendingPolicy = {
  poolId: "pool-1",
  tier1: { canBorrow: false as const },
  tier2: { ltv: 0.5, apr: 6 },
  tier3: { ltv: 1.5, apr: 4 },
  votedBy: ["0x123", "0x456"],
  votedAt: new Date(Date.now() - 86400000).toISOString(),
  nextVoteWindow: new Date(Date.now() + 86400000).toISOString(),
};

const mockUserReputation = {
  tier: "Tier2" as const,
  score: 65,
  votingPower: 2,
};

function mockResponse(payload: unknown, status: number = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    headers: new Headers(),
  });
}

function setupDefaultFetch() {
  (global.fetch as any).mockImplementation((url: string) => {
    if (url.includes("/dao/pools/pool-1/lending-policy")) {
      return mockResponse(mockLendingPolicy);
    }
    if (url.includes("/dao/pools/pool-1/loans/active")) {
      return mockResponse([]);
    }
    return mockResponse({ detail: "Not found" }, 404);
  });
}

describe("VaultGovernancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultFetch();
  });

  it("renders successfully with all tabs", async () => {
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Current Policies")).toBeInTheDocument();
      expect(screen.getByText("Active Proposals")).toBeInTheDocument();
      expect(screen.getByText("Voting History")).toBeInTheDocument();
      expect(screen.getByText("Analytics")).toBeInTheDocument();
    });
  });

  it("loads lending policy on mount", async () => {
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("6%")).toBeInTheDocument();
      expect(screen.getByText("4%")).toBeInTheDocument();
      expect(screen.getByText("50%")).toBeInTheDocument();
      expect(screen.getByText("150%")).toBeInTheDocument();
    });
  });

  it("displays tier information correctly", async () => {
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("N/A")).toBeInTheDocument();
      expect(screen.getByText("Limited leverage")).toBeInTheDocument();
      expect(screen.getByText("Full leverage")).toBeInTheDocument();
    });
  });

  it("switches between tabs", async () => {
    const user = userEvent.setup();
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    await user.click(await screen.findByText("Active Proposals"));

    await waitFor(() => {
      expect(screen.getByText("Active Governance Proposals")).toBeInTheDocument();
      expect(screen.getByText("No proposals found")).toBeInTheDocument();
    });
  });

  it("shows error state when loading fails", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/dao/pools/pool-1/lending-policy")) {
        return mockResponse({ detail: "Failed to fetch policy" }, 500);
      }
      if (url.includes("/dao/pools/pool-1/loans/active")) {
        return mockResponse([]);
      }
      return mockResponse({ detail: "Not found" }, 404);
    });

    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch policy/)).toBeInTheDocument();
    });
  });

  it("opens proposal modal from current policies tab", async () => {
    const user = userEvent.setup();

    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    const proposeButton = await screen.findByText("Propose Change");
    await user.click(proposeButton);

    await waitFor(() => {
      expect(screen.getByText("Create Governance Proposal")).toBeInTheDocument();
    });
  });

  it("displays loading state initially", () => {
    (global.fetch as any).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({
            ok: true,
            status: 200,
            json: async () => mockLendingPolicy,
            headers: new Headers(),
          }), 1000)
        )
    );

    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(screen.getByText(/Loading governance data/)).toBeInTheDocument();
  });

  it("requires user address to show voting options", async () => {
    const user = userEvent.setup();

    render(<VaultGovernancePanel poolId="pool-1" userReputation={mockUserReputation} />);

    await user.click(await screen.findByText("Active Proposals"));
    await waitFor(() => {
      expect(screen.getByText(/Connect wallet to vote/)).toBeInTheDocument();
    });
  });

  it("disables propose button when user is not logged in", async () => {
    render(<VaultGovernancePanel poolId="pool-1" />);

    await waitFor(() => {
      const proposeButton = screen.getByText("Propose Change") as HTMLButtonElement;
      expect(proposeButton.disabled).toBe(true);
    });
  });

  it("renders empty proposals state when no active proposals", async () => {
    const user = userEvent.setup();
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    await user.click(await screen.findByText("Active Proposals"));
    await waitFor(() => {
      expect(screen.getByText("No proposals found")).toBeInTheDocument();
    });
  });
});
