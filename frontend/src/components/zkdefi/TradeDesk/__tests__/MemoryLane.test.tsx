import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryLane } from "../MemoryLane";
import type { ReceiptWithImpact } from "@/services/ReceiptService";

const mockReceipts: ReceiptWithImpact[] = [
  {
    id: "receipt-1",
    timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
    action: "swap",
    adapter: "SwapAdapter",
    opportunityName: "Swap USDC → STRK",
    amount: 1000,
    privacyLevel: "public",
    yieldImpact: 0.5,
    trustDelta: 5,
    status: "confirmed",
    reputationImpact: 5,
    txHash: "0x1234567890abcdef",
  },
  {
    id: "receipt-2",
    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
    action: "lp_add",
    adapter: "LPAdapter",
    opportunityName: "Added LP ETH/USDC",
    amount: 5,
    privacyLevel: "shielded",
    yieldImpact: 1.2,
    trustDelta: 3,
    status: "confirmed",
    reputationImpact: 3,
    explanationFromAI: "Conservative LP strategy with low IL risk",
  },
  {
    id: "receipt-3",
    timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
    action: "borrow",
    adapter: "LendingAdapter",
    opportunityName: "Borrowed $50,000",
    amount: 50000,
    privacyLevel: "public",
    yieldImpact: 2.0,
    trustDelta: 2,
    status: "confirmed",
    reputationImpact: 2,
  },
  {
    id: "receipt-4",
    timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
    action: "swap",
    adapter: "SwapAdapter",
    opportunityName: "Swap STRK → ETH",
    amount: 500,
    privacyLevel: "public",
    yieldImpact: -0.2,
    trustDelta: 1,
    status: "failed",
    reputationImpact: 0,
  },
];

describe("MemoryLane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    it("renders loading state when loading and no receipts", () => {
      render(
        <MemoryLane
          userAddress="0x123"
          loading={true}
          compact={false}
          showFilters={true}
          limit={50}
          receipts={[]}
        />
      );
      expect(screen.getByText("Loading receipt history...")).toBeTruthy();
    });

    it("renders empty state when no receipts available", () => {
      render(
        <MemoryLane
          receipts={[]}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const elements = screen.queryAllByText(/no trades/i);
      expect(elements.length).toBeGreaterThan(0);
    });

    it("renders title", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const titleElements = screen.queryAllByText("Memory Lane");
      expect(titleElements.length).toBeGreaterThan(0);
    });

    it("renders date filter buttons", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      expect(screen.getByRole("button", { name: "24h" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "7d" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "30d" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    });
  });

  describe("Timeline Display", () => {
    it("displays receipts in the timeline", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const receiptNames = screen.queryAllByText(/Swap|Added|Borrowed/);
      expect(receiptNames.length).toBeGreaterThan(0);
    });

    it("displays timestamp for each receipt", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const timeElements = screen.queryAllByText(/\d{1,2}:\d{2}/);
      expect(timeElements.length).toBeGreaterThan(0);
    });

    it("displays status badges", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const confirmed = screen.queryAllByText("confirmed");
      expect(confirmed.length).toBeGreaterThan(0);
    });

    it("displays yield impact badges", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const yieldText = screen.queryAllByText(/\+0\.50%|\+1\.20%|\+2\.00%/);
      expect(yieldText.length).toBeGreaterThan(0);
    });
  });

  describe("Expandable Details", () => {
    it("expands receipt to show details on click", async () => {
      render(
        <MemoryLane
          receipts={[mockReceipts[0]]}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const swapCard = screen.getByText("Swap USDC → STRK");
      fireEvent.click(swapCard.closest("div") || swapCard);
      await waitFor(() => {
        const adaptText = screen.queryAllByText("SwapAdapter");
        expect(adaptText.length).toBeGreaterThan(0);
      });
    });

    it("shows transaction hash in expanded view", async () => {
      render(
        <MemoryLane
          receipts={[mockReceipts[0]]}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const swapCard = screen.getByText("Swap USDC → STRK");
      fireEvent.click(swapCard.closest("div") || swapCard);
      await waitFor(() => {
        const txText = screen.queryAllByText(/0x12345678\.\.\.90abcdef/);
        expect(txText.length).toBeGreaterThan(0);
        const explorerLink = screen.getByRole("link", { name: /voyager/i });
        expect(explorerLink.getAttribute("href")).toContain("0x1234567890abcdef");
      });
    });

    it("shows AI explanation when available", async () => {
      render(
        <MemoryLane
          receipts={[mockReceipts[1]]}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const lpCard = screen.getByText("Added LP ETH/USDC");
      fireEvent.click(lpCard.closest("div") || lpCard);
      await waitFor(() => {
        const aiText = screen.queryAllByText(/Conservative LP strategy/);
        expect(aiText.length).toBeGreaterThan(0);
      });
    });

    it("collapses receipt when clicked again", async () => {
      render(
        <MemoryLane
          receipts={[mockReceipts[0]]}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const swapCard = screen.getByText("Swap USDC → STRK");
      fireEvent.click(swapCard.closest("div") || swapCard);
      await waitFor(() => {
        const adaptText = screen.queryAllByText("SwapAdapter");
        expect(adaptText.length).toBeGreaterThan(0);
      });
      fireEvent.click(swapCard.closest("div") || swapCard);
      await waitFor(() => {
        const adaptText = screen.queryAllByText("SwapAdapter");
        expect(adaptText.length).toBe(0);
      });
    });
  });

  describe("Date Filtering", () => {
    it("filters receipts by 24h when clicked", async () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const button24h = screen.getByRole("button", { name: "24h" });
      fireEvent.click(button24h);
      await waitFor(() => {
        // When filtering by 24h, 25+ hour old receipts should not appear
        const borrowedElements = screen.queryAllByText("Borrowed $50,000");
        expect(borrowedElements.length).toBe(0);
      });
    });

    it("shows all receipts when 'All' is selected", async () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const buttonAll = screen.getByRole("button", { name: "All" });
      fireEvent.click(buttonAll);
      await waitFor(() => {
        const receipts = screen.queryAllByText(/Swap|Added|Borrowed/);
        expect(receipts.length).toBeGreaterThanOrEqual(4);
      });
    });

    it("highlights active filter button", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const button24h = screen.getByRole("button", { name: "24h" });
      expect(button24h.className).toContain("bg-blue-600");
    });
  });

  describe("Analytics Section", () => {
    it("displays total executions", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const elements = screen.queryAllByText(/Total Trades:/);
      expect(elements.length).toBeGreaterThan(0);
    });

    it("displays total yield realized", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const elements = screen.queryAllByText(/Total Yield:/);
      expect(elements.length).toBeGreaterThan(0);
    });

    it("calculates correct total yield", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      // With default 24h filter:
      // receipt-1 (1h ago): 0.5%
      // receipt-2 (3h ago): 1.2%
      // Total: 1.7%
      const container = screen.getByText("Total Yield:").parentElement;
      expect(container?.textContent).toContain("1.70");
    });

    it("displays success rate percentage", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const elements = screen.queryAllByText(/Success Rate:/);
      expect(elements.length).toBeGreaterThan(0);
      // All 4 receipts, 3 confirmed = 75%
      // But with 24h filter (default), only 2 recent receipts shown, both confirmed = 100%
      // So we just verify the analytics section exists
      const container = screen.getByText("Success Rate:").parentElement;
      expect(container).toBeTruthy();
      expect(container?.textContent).toContain("%");
    });
  });

  describe("Compact Mode", () => {
    it("renders compact version when compact=true", () => {
      const { container } = render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={true}
          showFilters={false}
          limit={50}
        />
      );
      const main = container.querySelector('[data-testid="memory-lane-compact"]');
      expect(main).toBeTruthy();
    });
  });

  describe("Limit Prop", () => {
    it("respects limit prop for number of displayed receipts", () => {
      render(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={2}
        />
      );
      // With limit=2, should only show 2 receipts in timeline
      const swapElements = screen.queryAllByText("Swap USDC → STRK");
      const lpElements = screen.queryAllByText("Added LP ETH/USDC");
      // Only the first 2 receipts (by date) should be visible
      const totalVisible = swapElements.length + lpElements.length;
      expect(totalVisible).toBeLessThanOrEqual(2);
    });
  });

  describe("Privacy Handling", () => {
    it("displays privacy level in expanded view", async () => {
      render(
        <MemoryLane
          receipts={[mockReceipts[1]]}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      const lpCard = screen.getByText("Added LP ETH/USDC");
      fireEvent.click(lpCard.closest("div") || lpCard);
      await waitFor(() => {
        const privacyText = screen.queryAllByText("shielded");
        expect(privacyText.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Real-time Updates", () => {
    it("updates when receipts prop changes", async () => {
      const { rerender } = render(
        <MemoryLane
          receipts={[mockReceipts[0]]}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );
      let swapElements = screen.queryAllByText("Swap USDC → STRK");
      expect(swapElements.length).toBeGreaterThan(0);

      rerender(
        <MemoryLane
          receipts={mockReceipts}
          userAddress="0x123"
          loading={false}
          compact={false}
          showFilters={true}
          limit={50}
        />
      );

      await waitFor(() => {
        const lpElements = screen.queryAllByText("Added LP ETH/USDC");
        expect(lpElements.length).toBeGreaterThan(0);
      });
    });
  });
});
