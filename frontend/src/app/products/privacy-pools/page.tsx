"use client";

import { ProductPageFrame } from "@/components/marketing/ProductPageFrame";

export default function PrivacyPoolsProductPage() {
  return (
    <ProductPageFrame
      title="Privacy Pools"
      status="BUILT"
      summary="Tiered privacy pools for depositing and withdrawing capital with selective disclosure controls."
      description="Privacy Pools package the commitment, Merkle, and nullifier rails into a product surface that users can operate directly from the vault. Users choose a privacy mode, submit proofs, and keep strategy-level intent hidden while contracts still enforce policy."
      capabilities={[
        "Supports multiple privacy methods including commitment shield, nullifier set, hashed proof, and dark ledger mode.",
        "Deposit and withdraw flows are wired to commitment/nullifier proof mechanics.",
        "Policy and risk constraints remain enforceable even when balances and source paths are private.",
        "Backed by compiled privacy circuits and the full privacy pool contract path.",
      ]}
      deepLinkHref="/agent?v=vault&sub=portfolio"
      deepLinkLabel="Open Privacy Pools"
      docsHref="/docs/privacy-features"
    />
  );
}
