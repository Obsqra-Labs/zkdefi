"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function PrivateStakingProductPage() {
  return (
    <ProductPageFrame
      title="Private Staking"
      status="BUILT"
      summary="Staking and delegation flows integrated with vault privacy controls and proof-aware execution."
      description="Private Staking brings delegation and rewards management into the same private-capital surface as swaps, lending, and yield. Users can route staking actions through vault policy context while preserving privacy posture and attestation continuity."
      capabilities={[
        "Staking tab is integrated inside the vault execution surface.",
        "Supports delegation pool discovery, delegation intents, and claim workflows.",
        "Staking actions can be paired with profile and proof posture from the same account context.",
        "Extends the product surface for conservative yield users and treasury operators.",
      ]}
      deepLinkHref="/agent?v=vault&sub=staking"
      deepLinkLabel="Open Private Staking"
      docsHref="/docs/agent-dashboard"
    />
  );
}
