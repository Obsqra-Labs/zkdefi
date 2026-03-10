import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MyAgents } from "./MyAgents";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe("MyAgents", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("handles malformed payloads without crashing", async () => {
    apiFetchMock.mockResolvedValueOnce({
      agents: [
        {
          id: "agent-1",
          name: "Alpha",
          processors: { invalid: true },
          decision_logic: { type: "not-valid" },
          created_at: "bad-timestamp",
          active: true,
        },
      ],
    });

    render(<MyAgents userAddress="0xabc" />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeTruthy();
    });

    expect(screen.getByText(/Logic:/i).textContent || "").toContain("AND");
  });

  it("shows fetch errors instead of breaking UI", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("Backend unavailable"));

    render(<MyAgents userAddress="0xabc" />);

    await waitFor(() => {
      expect(screen.getByText(/Backend unavailable/i)).toBeTruthy();
    });
  });
});
