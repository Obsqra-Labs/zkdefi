import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalCard } from "../ProposalCard";

const mockProposal = {
  id: "0x123abc",
  pool: "pool-1",
  proposedChanges: { tier2: { apr: 5.5, ltv: 0.5 } },
  proposer: "0x456",
  votingDeadline: new Date(Date.now() + 259200000).toISOString(), // 3 days
  votes: { yes: 78, no: 22 },
  status: "open" as const,
};

const mockUserReputation = {
  tier: "Tier2" as const,
  score: 65,
  votingPower: 2,
};

describe("ProposalCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders proposal details correctly", () => {
    const onVote = vi.fn();
    render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.getByText(/0x123abc\.\.\./)).toBeInTheDocument();
    expect(screen.getByText(/^Voting \(/)).toBeInTheDocument();
  });

  it("displays voting results with percentages", () => {
    const onVote = vi.fn();
    render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.getByText("(78.0%)")).toBeInTheDocument();
    expect(screen.getByText("(22.0%)")).toBeInTheDocument();
  });

  it("shows proposal status badge", () => {
    const onVote = vi.fn();
    const { rerender } = render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.getByText(/^Voting \(/)).toBeInTheDocument();

    const passedProposal = { ...mockProposal, status: "passed" as const };
    rerender(
      <ProposalCard
        proposal={passedProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.getByText(/Passed/)).toBeInTheDocument();
  });

  it("renders vote buttons when status is open", () => {
    const onVote = vi.fn();
    render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.getByText("Vote Yes")).toBeInTheDocument();
    expect(screen.getByText("Vote No")).toBeInTheDocument();
  });

  it("handles vote submission", async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    const yesButton = screen.getByText("Vote Yes");
    await user.click(yesButton);

    await waitFor(() => {
      expect(onVote).toHaveBeenCalledWith("0x123abc", "yes");
    });
  });

  it("shows passed/failed outcome prediction", () => {
    const onVote = vi.fn();
    const passedProposal = {
      ...mockProposal,
      votes: { yes: 78, no: 22 }, // 78% yes = passes
    };

    render(
      <ProposalCard
        proposal={passedProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.getByText(/on track to pass/)).toBeInTheDocument();
  });

  it("shows voting power tooltip", async () => {
    const onVote = vi.fn();
    const user = userEvent.setup();

    render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.getByText(/Your voting power/)).toBeInTheDocument();
    expect(screen.getByText(/Tier2: 2 votes/)).toBeInTheDocument();
  });

  it("disables vote buttons when already voted", () => {
    const onVote = vi.fn();
    const { rerender } = render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
        hasVoted={false}
      />
    );

    const yesButton = screen.getByText("Vote Yes") as HTMLButtonElement;
    expect(yesButton.disabled).toBe(false);

    rerender(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
        hasVoted={true}
      />
    );

    expect(yesButton.disabled).toBe(true);
  });

  it("shows user's previous vote", () => {
    const onVote = vi.fn();
    render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        userVote="yes"
        hasVoted={true}
        onVote={onVote}
      />
    );

    const voteBanner = screen.getByText(/Your vote:/i);
    expect(voteBanner).toHaveTextContent("YES");
  });

  it("handles error during voting", async () => {
    const onVote = vi.fn().mockRejectedValue(new Error("Vote failed"));
    const user = userEvent.setup();

    render(
      <ProposalCard
        proposal={mockProposal}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    const yesButton = screen.getByText("Vote Yes");
    await user.click(yesButton);

    await waitFor(() => {
      expect(screen.getByText(/Vote failed/)).toBeInTheDocument();
    });
  });

  it("hides vote buttons when user not connected", () => {
    const onVote = vi.fn();
    render(
      <ProposalCard
        proposal={mockProposal}
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    expect(screen.queryByText("Vote Yes")).not.toBeInTheDocument();
    expect(screen.queryByText("Vote No")).not.toBeInTheDocument();
  });

  it("updates countdown timer", async () => {
    const onVote = vi.fn();
    const futureDeadline = new Date(Date.now() + 7200000).toISOString(); // 2 hours
    const proposalWithTime = { ...mockProposal, votingDeadline: futureDeadline };

    render(
      <ProposalCard
        proposal={proposalWithTime}
        userAddress="0x123"
        userReputation={mockUserReputation}
        onVote={onVote}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/1h/)).toBeInTheDocument();
    });
  });
});
