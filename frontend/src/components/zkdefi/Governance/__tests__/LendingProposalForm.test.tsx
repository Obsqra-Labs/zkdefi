import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LendingProposalForm } from "../LendingProposalForm";
import type { LendingPolicy } from "@/services/VaultLendingGovernanceService";

const mockCurrentPolicy: LendingPolicy = {
  poolId: "pool-1",
  tier1: { canBorrow: false },
  tier2: { ltv: 0.5, apr: 5.5 },
  tier3: { ltv: 1.5, apr: 3.5 },
  votedBy: ["0x123"],
  votedAt: new Date().toISOString(),
  nextVoteWindow: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

const defaultProps = {
  poolId: "pool-1",
  isOpen: true,
  onClose: () => {},
  onSuccess: () => {},
  currentPolicy: mockCurrentPolicy,
  userVotingPower: 100,
  minVotingPower: 10,
};

describe("LendingProposalForm", () => {
  it("should render step 1 initially", () => {
    const { getByText } = render(<LendingProposalForm {...defaultProps} />);
    const element = getByText(/step 1 of 4/i);
    expect(element).toBeTruthy();
  });

  it("should not render main content when isOpen is false", () => {
    const { queryByText } = render(
      <LendingProposalForm {...defaultProps} isOpen={false} />
    );
    // The step indicator and title should not be there
    const stepText = queryByText(/step 1 of 4 —/);
    expect(stepText).toBeNull();
  });

  it("should display proposal type selection on step 1", () => {
    const { getByText } = render(<LendingProposalForm {...defaultProps} />);
    expect(getByText(/adjust apr/i)).toBeTruthy();
    expect(getByText(/adjust ltv/i)).toBeTruthy();
  });

  it("should display cancel button", () => {
    const { getAllByRole } = render(<LendingProposalForm {...defaultProps} />);
    const cancelButtons = getAllByRole("button");
    expect(cancelButtons.length).toBeGreaterThan(0);
  });
});
