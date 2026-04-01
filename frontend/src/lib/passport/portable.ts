/**
 * Portable Passport Profile (PPP) v1 — canonical types.
 *
 * Every trust/reputation surface in the app should consume these types
 * instead of rolling independent shapes.
 */

// ---------------------------------------------------------------------------
// Core sections
// ---------------------------------------------------------------------------

export interface PPPSubject {
  starknet_address: string;
  subject_id: string;
}

export interface PPPIdentity {
  linked_addresses: string[];
  session_state?: {
    count: number;
    active_count: number;
  };
  privacy_mode: "public" | "selective" | "private";
}

export interface PPPReputation {
  tier: number;
  tier_name: string;
  score: number | string; // string when banded in public card
  credit_score: number | null;
  letter_rating: string;
  tenure_days?: number;
  successful_txns?: number;
  failed_txns?: number;
  transaction_count?: number;
  total_volume_eth?: number;
  collateral_eth?: number;
  gates?: Record<string, boolean>;
  upgrade_eligible?: boolean;
  upgrade_requirements?: {
    target_tier: number;
    needs_tenure_days?: number;
    needs_successful_txns?: number;
    needs_collateral_eth?: number;
  } | null;
}

export interface PPPBuilderActivity {
  deploy_count: number;
  verified_receipt_count: number;
  proof_count: number;
}

export interface PPPDefiActivity {
  tvl_usd: number | string; // string when banded in public card
  protocol_count: number;
  position_count: number;
  protocols_active?: string[];
  turnover_30d_usd?: number;
  lending_value_usd?: number;
  staking_value_usd?: number;
  wallet_value_usd?: number;
}

export interface PPPBridgeDeposit {
  block_number: number;
  l1_sender: string;
  amount_eth: number;
  tx_hash: string;
}

export interface PPPOnChainActivity {
  starknet_nonce: number;
  bridge_deposit_count: number;
  bridge_total_eth: number;
  bridge_deposits: PPPBridgeDeposit[];
  collateral_eth: number;
  total_value_usd: number;
  account_age_days?: number;
  swap_count?: number;
  first_tx_timestamp?: number;
}

export interface PPPActivity {
  builder: PPPBuilderActivity;
  defi: PPPDefiActivity;
  on_chain?: PPPOnChainActivity;
}

export interface PPPEvidence {
  receipt_root: string;
  portfolio_snapshot_hash: string;
  proof_registry_refs: string[];
}

export interface PPPExecutionEligibility {
  allowed: boolean;
  mode: "allow" | "advisory" | "block";
  reason_codes: string[];
  confidence_band?: string;
}

export interface PPPLendingEligibility {
  allowed: boolean;
  mode: "allow" | "advisory" | "block";
  max_ltv?: number;
  reason_codes: string[];
}

export interface PPPRiskPosture {
  label: string;
  tier: number;
  composite_score: number;
}

export interface PPPClaims {
  execution_eligibility: PPPExecutionEligibility;
  lending_eligibility: PPPLendingEligibility;
  risk_posture: PPPRiskPosture;
}

export interface PPPProvenance {
  generated_at: string;
  policy_hash: string;
  circuits: string[];
  proof_mode: "groth16" | "advisory" | "hybrid";
}

export interface PPPSourceHealth {
  name: string;
  status: "ok" | "error" | "pending";
  latency_ms: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Full PPP object
// ---------------------------------------------------------------------------

export interface PortablePassportProfile {
  version: "ppp.v1";
  subject: PPPSubject;
  identity: PPPIdentity;
  reputation: PPPReputation;
  activity: PPPActivity;
  evidence: PPPEvidence;
  claims: PPPClaims;
  provenance: PPPProvenance;
  source_health?: PPPSourceHealth[];
}

// ---------------------------------------------------------------------------
// Public card variant (redacted)
// ---------------------------------------------------------------------------

export type PPPPublicCard = Omit<PortablePassportProfile, "source_health"> & {
  reputation: {
    tier: number;
    tier_name: string;
    score: string; // always banded
    letter_rating: string;
  };
};

// ---------------------------------------------------------------------------
// Evidence-only variant
// ---------------------------------------------------------------------------

export interface PPPEvidenceOnly {
  version: string;
  subject: PPPSubject;
  evidence: PPPEvidence;
  provenance: PPPProvenance;
}
