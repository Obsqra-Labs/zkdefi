import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeployOverlay } from "../DeployOverlay";

vi.mock("@/components/zkdefi/TradeDesk", () => ({
  TradeDesk: () => <div data-testid="trade-desk">trade desk mock</div>,
}));

vi.mock("../PrivacyPoolsPanel", () => ({
  PrivacyPoolsPanel: () => <div data-testid="privacy-pools">privacy pools mock</div>,
}));

describe("DeployOverlay", () => {
  it("defaults to Trade Desk and can switch to Privacy Pools", () => {
    render(<DeployOverlay address="0xabc" onClose={() => {}} />);

    expect(screen.getByTestId("trade-desk")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Privacy Pools/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Privacy Pools/i }));
    expect(screen.getByTestId("privacy-pools")).toBeTruthy();
  });
});
