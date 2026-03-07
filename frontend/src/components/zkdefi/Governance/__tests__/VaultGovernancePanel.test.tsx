import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultGovernancePanel } from "../VaultGovernancePanel";
import * as VaultLendingGovernanceServiceModule from "@/services/VaultLendingGovernanceService";

// Mock data
const mockLendingPolicy = {
  poolId: "pool-1",
  tier1: { canBorrow: false },
  tier2: { ltv: 0.5, apr: 6 },
  tier3: { ltv: 1.5, apr: 4 },
  votedBy: ["0x123", "0x456"],
  votedAt: new Date(Date.now() - 86400000).toISOString(),
  nextVoteWindow: new Date(Date.now() + 86400000).toISOString(),
};

const mockProposals = [
  {
    id: "prop-1",
    pool: "pool-1",
    proposedChanges: { tier2: { apr: 5.5, ltv: 0.5 } },
    proposer: "0x123",
    votingDeadline: new Date(Date.now() + 259200000).toISOString(), // 3 days
    votes: { yes: 65, no: 45 },
    status: "open" as const,
  },
];

const mockUserReputation = {
  tier: "Tier2" as const,
  score: 65,
  votingPower: 2,
};

// Mock the service
vi.mock("@/services/VaultLendingGovernanceService", () => ({
  VaultLendingGovernanceService: vi.fn(() => ({
    getLendingPolicy: vi.fn().mockResolvedValue(mockLendingPolicy),
    getActiveLoans: vi.fn().mockResolvedValue([]),
    proposeRateChange: vi.fn().mockResolvedValue("prop-123"),
    voteOnProposal: vi.fn().mockResolvedValue({
      proposalId: "prop-1",
      vote: "yes",
      timestamp: new Date().toISOString(),
    }),
    getProposalStatus: vi.fn().mockResolvedValue({
      id: "prop-1",
      status: "open",
      votes: { yes: 65, no: 45 },
      totalVoters: 120,
      participationRate: 0.75,
    }),
  })),
}));

describe("VaultGovernancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(screen.getByText("6%")).toBeInTheDocument(); // Tier 2 APR
      expect(screen.getByText("4%")).toBeInTheDocument(); // Tier 3 APR
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
      expect(screen.getByText("N/A")).toBeInTheDocument(); // Tier 1
      expect(screen.getByText("Limited leverage")).toBeInTheDocument(); // Tier 2
      expect(screen.getByText("Full leverage")).toBeInTheDocument(); // Tier 3
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

    const activeProposalsTab = screen.getByText("Active Proposals");
    await user.click(activeProposalsTab);

    await waitFor(() => {
      expect(screen.getByText("Active Governance Proposals")).toBeInTheDocument();
    });
  });

  it("displays user reputation tier correctly", async () => {
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Your voting power/)).toBeInTheDocument();
    });
  });

  it("shows error state when loading fails", async () => {
    const mockError = new Error("Failed to fetch policy");
    vi.spyOn(VaultLendingGovernanceServiceModule, "VaultLendingGovernanceService").mockImplementation(
      () => ({
        getLendingPolicy: vi.fn().mockRejectedValue(mockError),
        getActiveLoans: vi.fn().mockResolvedValue([]),
        proposeRateChange: vi.fn(),
        voteOnProposal: vi.fn(),
        getProposalStatus: vi.fn(),
      } as any)
    );

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

  it("calls onProposalCreated callback when proposal is created", async () => {
    const onProposalCreated = vi.fn();
    const user = userEvent.setup();

    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
        onProposalCreated={onProposalCreated}
      />
    );

    const proposeButton = await screen.findByText("Propose Change");
    await user.click(proposeButton);

    await waitFor(() => {
      expect(screen.getByText("Propose Policy Change")).toBeInTheDocument();
    });
  });

  it("displays loading state initially", () => {
    const slowService = {
      getLendingPolicy: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockLendingPolicy), 1000))
      ),
      getActiveLoans: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(VaultLendingGovernanceServiceModule, "VaultLendingGovernanceService").mockReturnValue(
      slowService as any
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
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userReputation={mockUserReputation}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Connect wallet to vote/)).toBeInTheDocument();
    });
  });

  it("disables propose button when user is not logged in", async () => {
    render(
      <VaultGovernancePanel
        poolId="pool-1"
      />
    );

    await waitFor(() => {
      const proposeButton = screen.getByText("Propose Change") as HTMLButtonElement;
      expect(proposeButton.disabled).toBe(true);
    });
  });

  it("handles voting on proposals", async () => {
    const voteOnProposalMock = vi.fn().mockResolvedValue({
      proposalId: "prop-1",
      vote: "yes",
      timestamp: new Date().toISOString(),
    });

    vi.spyOn(VaultLendingGovernanceServiceModule, "VaultLendingGovernanceService").mockReturnValue({
      getLendingPolicy: vi.fn().mockResolvedValue(mockLendingPolicy),
      getActiveLoans: vi.fn().mockResolvedValue([]),
      proposeRateChange: vi.fn(),
      voteOnProposal: voteOnProposalMock,
      getProposalStatus: vi.fn(),
    } as any);

    const user = userEvent.setup();
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    const proposalsTab = await screen.findByText("Active Proposals");
    await user.click(proposalsTab);

    await waitFor(() => {
      expect(screen.getByText(/Active Governance Proposals/)).toBeInTheDocument();
    });
  });

  it("filters proposals by status", async () => {
    const user = userEvent.setup();
    render(
      <VaultGovernancePanel
        poolId="pool-1"
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    const proposalsTab = await screen.findByText("Active Proposals");
    await user.click(proposalsTab);

    const filterSelect = screen.getByDisplayValue("Voting");
    await user.click(filterSelect);

    const passedOption = screen.getByText("Passed");
    await user.click(passedOption);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Passed")).toBeInTheDocument();
    });
  });
});
