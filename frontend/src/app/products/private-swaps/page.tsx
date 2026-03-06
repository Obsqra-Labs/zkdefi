"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function PrivateSwapsProductPage() {
  return (
    <ProductPageFrame
      title="Private Swaps"
      status="BUILT"
      summary="Swap execution with privacy-aware intent handling and proof-gated risk controls."
      description="Private Swaps runs inside the vault trade surface and supports swap, LP, limits, and DCA modes with shared intent context. Market discovery happens in Oracle and execution remains tied to vault policies."
      capabilities={[
        "Trade context across swap, LP, limits, and DCA paths.",
        "Deep-link support into vault trade execution mode.",
        "Oracle-to-vault handoff for opportunity-driven execution.",
        "Slippage and policy settings integrated with proof-gated flows.",
      ]}
      deepLinkHref="/agent?v=vault&sub=trade"
      deepLinkLabel="Open Private Swaps"
      docsHref="/docs/agent-dashboard"
    />
  );
}

