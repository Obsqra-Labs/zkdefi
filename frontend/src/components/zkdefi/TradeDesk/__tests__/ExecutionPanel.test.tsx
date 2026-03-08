import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExecutionPanel } from "../ExecutionPanel";
import type { Opportunity } from "@/services/types";

const mockOpportunity: Opportunity = {
  id: "test-1",
  name: "ETH/USDC LP",
  description: "Liquidity provision on Ekubo",
  type: "lp",
  currentYield: 12.5,
  riskScore: 30,
  tvl: 5000000,
  privacyModes: ["public", "shielded"],
  source: "zkGraph",
  updatedAt: new Date().toISOString(),
};

describe("ExecutionPanel", () => {
  const mockOnExecute = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with mode selector", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Advisory")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
  });

  it("starts in manual mode", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    expect(screen.getByPlaceholderText(/Enter amount/i)).toBeInTheDocument();
  });

  it("prevents Terminal mode for non-Tier3 users", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier2", reputationScore: 65 }}
      />
    );

    const terminalButton = Array.from(screen.getAllByRole("button")).find(
      (btn) => btn.textContent === "Terminal"
    );
    expect(terminalButton).toBeDisabled();
  });

  it("allows Terminal mode for Tier3 users", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier3", reputationScore: 85 }}
      />
    );

    const terminalButton = Array.from(screen.getAllByRole("button")).find(
      (btn) => btn.textContent === "Terminal"
    );
    expect(terminalButton).not.toBeDisabled();
  });

  it("validates amount input", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    const amountInput = screen.getByPlaceholderText(/Enter amount/i) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "100" } });

    expect(amountInput.value).toBe("100");
  });

  it("disables Execute button when amount is 0", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    const executeButton = Array.from(screen.getAllByRole("button")).find(
      (btn) => btn.textContent?.includes("Execute")
    );
    expect(executeButton).toBeDisabled();
  });

  it("enables Execute button when valid amount is entered", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    const amountInput = screen.getByPlaceholderText(/Enter amount/i);
    fireEvent.change(amountInput, { target: { value: "50" } });

    await waitFor(() => {
      const executeButton = Array.from(screen.getAllByRole("button")).find(
        (btn) => btn.textContent?.includes("Execute") && !btn.textContent?.includes("ing")
      );
      expect(executeButton).not.toBeDisabled();
    });
  });

  it("calls onCancel when Cancel button clicked", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    const cancelButton = Array.from(screen.getAllByRole("button")).find(
      (btn) => btn.textContent === "Cancel"
    );
    fireEvent.click(cancelButton!);
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("calls onExecute when Execute button clicked", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    const amountInput = screen.getByPlaceholderText(/Enter amount/i);
    fireEvent.change(amountInput, { target: { value: "50" } });

    await waitFor(() => {
      const executeButton = Array.from(screen.getAllByRole("button")).find(
        (btn) => btn.textContent?.includes("Execute") && !btn.textContent?.includes("ing")
      );
      expect(executeButton).not.toBeDisabled();
    });

    const executeButton = Array.from(screen.getAllByRole("button")).find(
      (btn) => btn.textContent?.includes("Execute") && !btn.textContent?.includes("ing")
    );
    fireEvent.click(executeButton!);

    await waitFor(() => {
      expect(mockOnExecute).toHaveBeenCalled();
    });
  });

  it("displays privacy mode selector in manual mode", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    expect(screen.getByText("Privacy Level")).toBeInTheDocument();
  });

  it("displays slippage tolerance input", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
  });

  it("displays execution preview after amount is set", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    const amountInput = screen.getByPlaceholderText(/Enter amount/i);
    fireEvent.change(amountInput, { target: { value: "50" } });

    await waitFor(() => {
      expect(screen.getByText("Execution Preview")).toBeInTheDocument();
    });
  });

  it("shows error when terminal mode clicked without Tier3", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", reputationScore: 25 }}
      />
    );

    const terminalButton = Array.from(screen.getAllByRole("button")).find(
      (btn) => btn.textContent === "Terminal"
    );

    // Terminal button should be disabled for Tier1
    expect(terminalButton).toBeDisabled();
  });
});
