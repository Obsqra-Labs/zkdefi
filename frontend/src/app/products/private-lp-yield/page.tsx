"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function PrivateLpYieldProductPage() {
  return (
    <ProductPageFrame
      title="Private LP + Yield"
      status="BUILT"
      summary="LP and yield operations with private allocations and verifiable optimization."
      description="Private LP + Yield combines liquidity deployment, yield strategy routing, and vault-level policy controls. It is where private capital is actively allocated while retaining proof-backed guardrails."
      capabilities={[
        "Yield and LP operations available from the vault workspace.",
        "Deploy-to-Ekubo and strategy recommendation integration.",
        "Built-in DCA and allocation tooling through trade and yield tabs.",
        "Circuit coverage for yield optimality, slippage, and anomaly/risk checks.",
      ]}
      deepLinkHref="/agent?v=vault&sub=yield"
      deepLinkLabel="Open LP + Yield"
      docsHref="/docs/rebalancing"
    />
  );
}

