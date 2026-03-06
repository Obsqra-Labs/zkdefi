"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function RiskPassportProductPage() {
  return (
    <ProductPageFrame
      title="Risk Passport"
      status="READY"
      summary="Portable, proof-backed financial reputation for wallets, agents, and strategy execution."
      description="Risk Passport is the productized trust primitive for zkde.fi. It turns private behavior into verifiable attestations so protocols can enforce policy using reputation and risk posture without accessing full wallet state."
      capabilities={[
        "Profile trust and reputation tabs surface passport posture and proof-backed metrics.",
        "Risk passport proof endpoints are available for tiered verification workflows.",
        "Works with receipt timeline patterns to build long-lived portable reputation.",
        "Designed for cross-protocol policy checks with selective disclosure.",
      ]}
      deepLinkHref="/profile?tab=trust"
      deepLinkLabel="Open Risk Passport"
      docsHref="/docs/risk-passport"
    />
  );
}
