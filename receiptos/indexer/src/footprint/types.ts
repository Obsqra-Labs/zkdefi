export interface FootprintComputationOptions {
  fromBlock?: number;
  toBlock?: number;
  traceChunkSize?: number;
  preloadedTraceChunks?: FootprintTraceChunkCheckpoint[];
  onTraceChunkComplete?: (chunk: FootprintTraceChunkCheckpoint) => void | Promise<void>;
  onTraceChunkResolved?: (
    chunk: FootprintTraceChunkCheckpoint,
    source: FootprintTraceChunkResolutionSource
  ) => void | Promise<void>;
}

export interface ContractFootprintStatus {
  label: string;
  address: string;
  source: "integration_addresses" | "mainnet_contracts";
  deployed: boolean;
  class_hash: string | null;
  note?: string;
}

export interface FootprintSourceStatus {
  id: string;
  label: string;
  kind: "deployment_check" | "event_scan" | "trace_scan";
  contract: string;
  address: string;
  status: "computed" | "blocked";
  selector?: string;
  event_count?: number;
  call_count?: number;
  chunk_count?: number;
  reason?: string;
}

export interface WindowedFootprintMetrics {
  receipts_issued: number;
  receipts_consumed: number;
  cid_anchors: number;
  unique_receipt_ids_issued: number;
  unique_receipt_ids_consumed: number;
  unique_receipt_ids_anchored: number;
  unique_receipt_ids_touched: number;
}

export interface ProtocolFootprintSnapshot {
  version: "0.1";
  chain: "starknet-mainnet";
  generated_at: number;
  window: {
    from_block: number;
    to_block: number;
  };
  metrics: {
    verified_deployed_contracts: number;
    windowed: WindowedFootprintMetrics;
  };
  contracts: Record<string, ContractFootprintStatus>;
  sources: FootprintSourceStatus[];
  notional_metrics: {
    gross_public_execution_notional: PublicExecutionNotional | null;
    private_mist_notional: MistPrivateNotional | null;
    blocked_reasons: string[];
  };
  coverage: {
    computed_sources: string[];
    blocked_sources: string[];
    notes: string[];
    request_count: number;
  };
}

export interface PublicExecutionNotional {
  route_attribution: Record<string, number>;
  ekubo_swap: {
    event_count: number;
    unique_callers: number;
    gross_amount0_abs_raw: string;
    gross_amount1_abs_raw: string;
  };
  note: string;
}

export interface MistTokenTotals {
  call_count: number;
  token_totals_raw: Record<string, string>;
  token_totals: MistNormalizedTokenTotal[];
}

export interface MistNormalizedTokenTotal {
  token_address: string;
  symbol: string | null;
  decimals: number | null;
  amount_raw: string;
  amount_decimal: string | null;
}

export interface MistPrivateNotional {
  trace_window_block_span: number;
  trace_chunk_count: number;
  deposit: MistTokenTotals;
  withdraw_no_zk: MistTokenTotals;
  seek_and_hide_no_zk: MistTokenTotals;
  handle_zkp_call_count: number;
  note: string;
}

export interface FootprintTraceChunkCheckpoint {
  chunk_index: number;
  chunk_count: number;
  window: {
    from_block: number;
    to_block: number;
  };
  call_count: number;
  notional: MistPrivateNotional;
}

export type FootprintTraceChunkResolutionSource = "traced" | "reused";

export interface FootprintTraceManifestChunk {
  chunk_index: number;
  from_block: number;
  to_block: number;
  checkpoint_file: string;
}

export interface FootprintTraceManifest {
  version: "0.1";
  chain: "starknet-mainnet";
  trace_chunk_size: number;
  checkpoint_dir: string;
  window: {
    from_block: number;
    to_block: number;
  };
  completed_chunks: FootprintTraceManifestChunk[];
  updated_at: number;
}
