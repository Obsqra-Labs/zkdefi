import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeployOverlay } from "../DeployOverlay";

vi.mock("@/components/zkdefi/TradeDesk", () => ({
  TradeDesk: () => <div data-testid="trade-desk">trade desk mock</div>,
}));

describe("DeployOverlay", () => {
  it("defaults to Trade Desk (privacy pools live in main vault Pools tab)", () => {
    render(<DeployOverlay address="0xabc" onClose={() => {}} />);

    expect(screen.getByTestId("trade-desk")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Trade Desk/i })).toBeTruthy();
  });
});
