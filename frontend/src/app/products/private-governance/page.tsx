"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function PrivateGovernanceProductPage() {
  return (
    <ProductPageFrame
      title="Private Governance"
      status="READY"
      summary="Governance workflows with private voting semantics and verifiable outcomes."
      description="Private Governance packages proposal and voting primitives into a product surface for DAOs and protocol operators. It aligns commit/nullifier patterns with proof-based vote integrity and replay resistance."
      capabilities={[
        "Dedicated governance route with proposal and voting interfaces.",
        "Zero-knowledge voting narrative and voting-power flow are already integrated.",
        "Hackathon coverage marks private voting and prediction-market rails as READY.",
        "Built to consume existing commitment, nullifier, and Merkle membership primitives.",
      ]}
      deepLinkHref="/governance"
      deepLinkLabel="Open Governance"
      docsHref="/docs/agent-dashboard"
    />
  );
}

