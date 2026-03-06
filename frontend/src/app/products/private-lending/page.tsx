"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function PrivateLendingProductPage() {
  return (
    <ProductPageFrame
      title="Private Lending"
      status="BUILT"
      summary="Lending workflows with private posture and proof-backed eligibility checks."
      description="Private Lending is exposed through the vault lending tab and linked profile signals. It is designed for supply/borrow flows that can consume credit and risk attestations without disclosing full wallet state."
      capabilities={[
        "Lending panel integrated in the core vault workspace.",
        "Credit eligibility proof path available in the reputation/lending stack.",
        "Risk and liquidation safety primitives already present in circuits.",
        "Portfolio and compliance context available through profile tabs.",
      ]}
      deepLinkHref="/agent?v=vault&sub=lending"
      deepLinkLabel="Open Private Lending"
      docsHref="/docs/reputation-system"
    />
  );
}

