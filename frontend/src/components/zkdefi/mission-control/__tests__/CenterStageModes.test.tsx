import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CenterStageModes } from "../CenterStageModes";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

vi.mock("../UnifiedStream", () => ({
  UnifiedStream: () => <div data-testid="unified-stream">stream mock</div>,
}));

vi.mock("../GovernanceOverlay", () => ({
  GovernanceOverlay: () => <div data-testid="governance-overlay">governance mock</div>,
}));

describe("CenterStageModes", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("switches modes and opens forensic receipt drawer", async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url.includes("/mc/receipts/timeline/")) {
        return Promise.resolve({
          timeline: [
            {
              date: "2026-03-07",
              receipts: [
                {
                  receipt_id: "rcpt-123",
                  timestamp: "2026-03-07T00:00:00Z",
                  intent_summary: "Swap ETH/USDC",
                  gate_status: "pass",
                  type: "execute",
                },
              ],
            },
          ],
        });
      }
      if (url.includes("/mc/receipts/rcpt-123")) {
        return Promise.resolve({ receipt_id: "rcpt-123", details: { ok: true } });
      }
      if (url.includes("/mc/execution/current/")) {
        return Promise.resolve({
          timestamp: "2026-03-07T00:00:00Z",
          steps: { intent: { status: "complete" }, policy: { status: "complete" } },
        });
      }
      return Promise.resolve({});
    });

    render(<CenterStageModes address="0xabc" />);

    expect(screen.getByTestId("unified-stream")).toBeTruthy();

    fireEvent.click(screen.getByText("Execution Flow"));
    await waitFor(() => {
      expect(screen.getByText(/Step 1/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Memory Lane"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search receipt ID")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Swap ETH/USDC"));
    fireEvent.click(screen.getByText("Open Forensic Drawer"));

    await waitFor(() => {
      expect(screen.getByText(/Forensic: rcpt-123/i)).toBeTruthy();
    });
  });
});
