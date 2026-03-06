"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function PrivateVaultProductPage() {
  return (
    <ProductPageFrame
      title="Private Vault"
      status="BUILT"
      summary="The operational vault for shielded capital, policy-gated execution, and verifiable activity."
      description="Private Vault combines privacy tiers, vault controls, and proof-gated policies into one surface. Users can deposit, withdraw, deploy, and monitor activity while preserving execution privacy."
      capabilities={[
        "Unified vault surface with portfolio, yield, trade, lending, staking, and activity tabs.",
        "Privacy-tiered deposit and withdraw flows with commitment/nullifier mechanics.",
        "Execution authority and session-key context visible during operations.",
        "Proof timeline and receipts available through the activity path.",
      ]}
      deepLinkHref="/agent?v=vault"
      deepLinkLabel="Open Vault Surface"
      docsHref="/docs/agent-dashboard"
    />
  );
}

