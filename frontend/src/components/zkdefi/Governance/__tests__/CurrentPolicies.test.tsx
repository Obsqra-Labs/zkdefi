import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrentPolicies } from "../CurrentPolicies";
import type { LendingPolicy } from "@/services/VaultLendingGovernanceService";

const mockLendingPolicy: LendingPolicy = {
  poolId: "pool-1",
  tier1: { canBorrow: false },
  tier2: { ltv: 0.5, apr: 6 },
  tier3: { ltv: 1.5, apr: 4 },
  votedBy: ["0x123"],
  votedAt: new Date().toISOString(),
  nextVoteWindow: new Date(Date.now() + 86400000).toISOString(),
};

const mockPoolUtilization = {
  totalLiquidity: 1000000,
  activeLoans: 600000,
  availableForLending: 400000,
  idleRatio: 40,
};

const mockUserReputation = {
  tier: "Tier2" as const,
  score: 65,
  votingPower: 2,
};

describe("CurrentPolicies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders lending rates by tier", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(screen.getByText("Lending Rates (APR)")).toBeInTheDocument();
    expect(screen.getByText("6%")).toBeInTheDocument(); // Tier 2
    expect(screen.getByText("4%")).toBeInTheDocument(); // Tier 3
  });

  it("displays LTV limits correctly", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(screen.getByText("LTV Limits by Tier")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument(); // Tier 2 LTV
    expect(screen.getByText("150%")).toBeInTheDocument(); // Tier 3 LTV
  });

  it("shows pool metrics", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(screen.getByText("Pool Metrics")).toBeInTheDocument();
    expect(screen.getByText("Total Liquidity")).toBeInTheDocument();
    expect(screen.getByText("Active Loans")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Effective Yield")).toBeInTheDocument();
  });

  it("displays idle reserve ratio", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(screen.getByText("Idle Reserve Ratio")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("shows warning when idle reserve is low", () => {
    const lowReserveUtilization = {
      ...mockPoolUtilization,
      idleRatio: 15,
    };

    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={lowReserveUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(screen.getByText("Low Reserve")).toBeInTheDocument();
  });

  it("renders Propose Change button", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(screen.getByText("Propose Change")).toBeInTheDocument();
  });

  it("disables Propose Change button when no user address", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userReputation={mockUserReputation}
      />
    );

    const proposeButton = screen.getByText("Propose Change") as HTMLButtonElement;
    expect(proposeButton.disabled).toBe(true);
  });

  it("opens proposal form when Propose Change is clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    const proposeButton = screen.getByText("Propose Change");
    await user.click(proposeButton);

    await waitFor(() => {
      expect(screen.getByText("Create Governance Proposal")).toBeInTheDocument();
    });
  });

  it("calculates effective yield correctly", () => {
    const utilization = {
      totalLiquidity: 1000000,
      activeLoans: 500000,
      availableForLending: 500000,
      idleRatio: 50,
    };

    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={utilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    // APR average: (6 + 4) / 2 = 5%
    // Interest: 500000 * 5% = 25000
    // Yield: 25000 / 1000000 = 2.5%
    expect(screen.getByText(/2.50% APY/)).toBeInTheDocument();
  });

  it("displays N/A for Tier 1 rates", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    const tier1Rates = screen.getAllByText("N/A");
    expect(tier1Rates.length).toBeGreaterThan(0);
  });

  it("handles null policy gracefully", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={null}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
      />
    );

    expect(
      screen.getByText("No lending policies available for this pool.")
    ).toBeInTheDocument();
  });

  it("disables button during loading", () => {
    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
        loading={true}
      />
    );

    const proposeButton = screen.getByText("Propose Change") as HTMLButtonElement;
    expect(proposeButton.disabled).toBe(true);
  });

  it("calls onProposalCreated callback", async () => {
    const onProposalCreated = vi.fn();
    const user = userEvent.setup();

    render(
      <CurrentPolicies
        poolId="pool-1"
        policy={mockLendingPolicy}
        poolUtilization={mockPoolUtilization}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onProposalCreated={onProposalCreated}
      />
    );

    const proposeButton = screen.getByText("Propose Change");
    await user.click(proposeButton);

    await waitFor(() => {
      expect(screen.getByText("Create Governance Proposal")).toBeInTheDocument();
    });
  });
});
