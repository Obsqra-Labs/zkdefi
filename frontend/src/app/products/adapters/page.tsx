"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function AdaptersProductPage() {
  return (
    <ProductPageFrame
      title="Adapters"
      status="ADAPTER"
      summary="Composable strategy adapters that let protocols plug into zkde.fi privacy and proof gates."
      description="Adapters are the extension layer for protocol-specific deployment paths. They inherit privacy, constraint enforcement, and proof-backed execution while letting teams implement their own strategy logic."
      capabilities={[
        "IStrategyAdapter contract shape documented in hackathon coverage.",
        "Adapter path intended for BTC yield vaults, CDPs, and protocol-specific integrations.",
        "Keeps core privacy/risk/verifier stack reusable across new strategy modules.",
        "Lets ecosystem teams build features without forking core execution primitives.",
      ]}
      deepLinkHref="/docs/developers"
      deepLinkLabel="Open Adapter Docs"
      docsHref="/docs/developers"
    />
  );
}

