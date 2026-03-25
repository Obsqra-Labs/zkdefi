export interface ReputationVector {
  version: "0.1";
  wallet: string;
  timestamp: number;
  chain: "starknet-mainnet" | "starknet-sepolia";

  signals: {
    wallet_age_days: number | null;
    wallet_age_source: "deploy_account_tx" | "first_invoke_tx" | null;
    account_type: "argent" | "braavos" | "openzeppelin" | "unknown";
    transaction_count: number;
    transaction_count_note: "outbound_only_getNonce";
    protocol_categories: string[];
    protocol_category_count: number;
    liquidation_count: number | null;
    liquidation_predicate: "has_lending_activity" | "no_lending_activity";
    bridge_inflow: BridgeInflow | null;
  };

  privacy_behavior_profile: null;
  deferred_signals: string[];
  coverage: {
    protocols_indexed: string[];
    protocols_attempted_no_events: string[];
    blocks_scanned_from: number;
    blocks_scanned_to: number;
    indexer_version: "0.1.0";
    known_gaps: string;
  };
}

export interface BridgeInflow {
  tokens: Record<string, {
    raw_amount: string;
    decimals: number;
    event_count: number;
  }>;
  total_events: number;
  bridges_indexed: string[];
}

export interface SignalResult<T> {
  value: T;
  source: string;
  blockRange: [number, number];
  requestCount: number;
}

export interface IndexerConfig {
  chain: "starknet-mainnet" | "starknet-sepolia";
  verifiedProtocols: string[];
  attemptedProtocols: string[];
}
