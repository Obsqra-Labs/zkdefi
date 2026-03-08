import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentBuilderDrawer } from "../AgentBuilderDrawer";

vi.mock("@/components/zkdefi/ModelComposer", () => ({
  ModelComposer: ({ onAgentCreated, onLog }: any) => (
    <div>
      <button
        onClick={() => {
          onLog?.("success", "Composer created agent");
          onAgentCreated?.({
            id: "agent-123",
            name: "Drawer Agent",
            processors: ["risk_scoring"],
            decision_logic: { type: "AND" },
            active: true,
            created_at: 123,
          });
        }}
      >
        Trigger Create
      </button>
    </div>
  ),
}));

vi.mock("@/components/zkdefi/MyAgents", () => ({
  MyAgents: ({ highlightAgentId }: any) => <div data-testid="my-agents">highlight:{highlightAgentId}</div>,
}));

describe("AgentBuilderDrawer", () => {
  it("switches to My Agents and highlights newly created agent", async () => {
    render(<AgentBuilderDrawer userAddress="0xabc" />);

    fireEvent.click(screen.getByText("Trigger Create"));

    await waitFor(() => {
      expect(screen.getByTestId("my-agents").textContent).toContain("agent-123");
    });

    expect(screen.getByText(/Created Drawer Agent/i)).toBeTruthy();
  });
});
