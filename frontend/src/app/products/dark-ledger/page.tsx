"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function DarkLedgerProductPage() {
  return (
    <ProductPageFrame
      title="Dark Ledger"
      status="BUILT"
      summary="Private internal settlement for high-signal execution paths where public transfer traces are minimized."
      description="Dark Ledger is the private settlement rail behind advanced privacy-tier operations. Instead of exposing operational token movement publicly for each action, settlement can be tracked through internal ledger state and verifiable receipts."
      capabilities={[
        "Available as a deposit method inside vault flows.",
        "Transfer-in request path and ledger credit flow are integrated in backend APIs.",
        "Activity and receipt rails expose verifiable outcomes without revealing full execution detail.",
        "Designed for private strategy operations that require minimal on-chain footprint.",
      ]}
      deepLinkHref="/agent?v=vault&sub=ledger"
      deepLinkLabel="Open Dark Ledger"
      docsHref="/docs/privacy-features"
    />
  );
}
