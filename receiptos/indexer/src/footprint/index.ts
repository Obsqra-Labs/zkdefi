import { selector } from "starknet";
import receiptOsContracts from "../../../config/mainnet-contracts.json";
import mistTokenMetadata from "../../../config/mist-token-metadata.json";
import receiptOsAddresses from "../../../integration/addresses.json";
import type { StarknetRPC } from "../rpc-client";
import type {
  ContractFootprintStatus,
  FootprintTraceChunkCheckpoint,
  FootprintTraceChunkResolutionSource,
  FootprintComputationOptions,
  FootprintSourceStatus,
  MistPrivateNotional,
  PublicExecutionNotional,
  ProtocolFootprintSnapshot,
} from "./types";

interface EventScanSpec {
  id: string;
  label: string;
  contract: string;
  address: string;
  eventName: string;
}

interface MistTokenMetadataEntry {
  symbol?: string;
  decimals?: number;
}

const DEFAULT_LOOKBACK_BLOCKS = 50_000;
const DEFAULT_TRACE_SCAN_MAX_BLOCKS = 2_000;
const MIST_TRACE_SOURCE_ID = "mist_chamber.trace_window";
const MIST_TRACE_SOURCE_LABEL = "MIST Chamber trace scan";
const EKUBO_PUBLIC_ROUTE_SOURCE_ID = "ekubo_core.public_route_attribution";
const EKUBO_PUBLIC_ROUTE_SOURCE_LABEL = "Ekubo public route attribution";
const STARKNET_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);
const STARKNET_HALF_PRIME = STARKNET_PRIME / 2n;

const CHAMBER_SELECTORS = {
  deposit: normalizeHex(selector.getSelectorFromName("deposit")),
  withdraw_no_zk: normalizeHex(selector.getSelectorFromName("withdraw_no_zk")),
  seek_and_hide_no_zk: normalizeHex(selector.getSelectorFromName("seek_and_hide_no_zk")),
  handle_zkp: normalizeHex(selector.getSelectorFromName("handle_zkp")),
};

const CONTRACT_SPECS = {
  receipt_registry_v01: {
    label: "Receipt Registry v0.1",
    address: receiptOsAddresses.mainnet.receipt_registry_v01,
    source: "integration_addresses" as const,
  },
  receipt_archive_v01: {
    label: "Receipt Archive v0.1",
    address: receiptOsAddresses.mainnet.receipt_archive_v01,
    source: "integration_addresses" as const,
  },
  ekubo_core: {
    label: "Ekubo Core",
    address: getContractAddress("ekubo_core"),
    source: "mainnet_contracts" as const,
  },
  mist_chamber: {
    label: "MIST Chamber",
    address: getContractAddress("mist_cash_contract"),
    source: "mainnet_contracts" as const,
  },
};

const EVENT_SCANS: EventScanSpec[] = [
  {
    id: "receipt_registry_v01.receipt_issued",
    label: "ReceiptIssued events",
    contract: "receipt_registry_v01",
    address: CONTRACT_SPECS.receipt_registry_v01.address,
    eventName: "ReceiptIssued",
  },
  {
    id: "receipt_registry_v01.receipt_consumed",
    label: "ReceiptConsumed events",
    contract: "receipt_registry_v01",
    address: CONTRACT_SPECS.receipt_registry_v01.address,
    eventName: "ReceiptConsumed",
  },
  {
    id: "receipt_archive_v01.cid_anchored",
    label: "CidAnchored events",
    contract: "receipt_archive_v01",
    address: CONTRACT_SPECS.receipt_archive_v01.address,
    eventName: "CidAnchored",
  },
];

const MIST_TOKEN_METADATA = Object.fromEntries(
  Object.entries(mistTokenMetadata as Record<string, MistTokenMetadataEntry>).map(([address, metadata]) => [
    normalizeHex(address),
    metadata,
  ])
);

export async function computeProtocolFootprint(
  rpc: StarknetRPC,
  options: FootprintComputationOptions = {}
): Promise<ProtocolFootprintSnapshot> {
  const startRequests = rpc.getRequestCount();
  const latestBlock = options.toBlock ?? await rpc.getBlockNumber();
  const lookbackBlocks = Number.parseInt(process.env.FOOTPRINT_LOOKBACK_BLOCKS ?? `${DEFAULT_LOOKBACK_BLOCKS}`, 10);
  const fromBlock = options.fromBlock ?? Math.max(0, latestBlock - lookbackBlocks);

  const contractEntries = await Promise.all(
    Object.entries(CONTRACT_SPECS).map(async ([id, spec]) => {
      const status = await getContractStatus(rpc, spec.label, spec.address, spec.source);
      return [id, status] as const;
    })
  );

  const contracts = Object.fromEntries(contractEntries);
  const deploymentSources = Object.entries(contracts).map(([id, status]) => ({
    id: `${id}.deployment`,
    label: `${status.label} deployment check`,
    kind: "deployment_check" as const,
    contract: id,
    address: status.address,
    status: status.deployed ? "computed" as const : "blocked" as const,
    reason: status.deployed ? undefined : (status.note ?? "deployment not confirmed"),
  }));

  const eventSources = await Promise.all(
    EVENT_SCANS.map((spec) => scanEventSource(rpc, spec, fromBlock, latestBlock))
  );
  const publicExecutionScan = await scanEkuboPublicExecution(
    rpc,
    CONTRACT_SPECS.ekubo_core.address,
    fromBlock,
    latestBlock
  );
  const mistTraceScan = await scanMistChamberTraceWindow(
    rpc,
    CONTRACT_SPECS.mist_chamber.address,
    fromBlock,
    latestBlock,
    options
  );

  const issuedScan = getEventSource(eventSources, "receipt_registry_v01.receipt_issued");
  const consumedScan = getEventSource(eventSources, "receipt_registry_v01.receipt_consumed");
  const anchoredScan = getEventSource(eventSources, "receipt_archive_v01.cid_anchored");

  const uniqueTouched = new Set<string>([
    ...issuedScan.uniqueReceiptIds,
    ...consumedScan.uniqueReceiptIds,
    ...anchoredScan.uniqueReceiptIds,
  ]);

  const sources: FootprintSourceStatus[] = [
    ...deploymentSources,
    ...eventSources.map(toSourceStatus),
    toPublicExecutionSourceStatus(publicExecutionScan),
    toTraceSourceStatus(mistTraceScan),
  ];
  const requestCount = rpc.getRequestCount() - startRequests;

  const blockedReasons: string[] = [];
  if (publicExecutionScan.status === "blocked") {
    blockedReasons.push(
      publicExecutionScan.reason
        ?? "public execution notional unavailable from Ekubo route attribution source"
    );
  }
  if (mistTraceScan.status === "blocked") {
    blockedReasons.push(mistTraceScan.reason ?? "private MIST trace scan unavailable");
  }

  return {
    version: "0.1",
    chain: "starknet-mainnet",
    generated_at: Math.floor(Date.now() / 1000),
    window: {
      from_block: fromBlock,
      to_block: latestBlock,
    },
    metrics: {
      verified_deployed_contracts: Object.values(contracts).filter((status) => status.deployed).length,
      windowed: {
        receipts_issued: issuedScan.eventCount,
        receipts_consumed: consumedScan.eventCount,
        cid_anchors: anchoredScan.eventCount,
        unique_receipt_ids_issued: issuedScan.uniqueReceiptIds.size,
        unique_receipt_ids_consumed: consumedScan.uniqueReceiptIds.size,
        unique_receipt_ids_anchored: anchoredScan.uniqueReceiptIds.size,
        unique_receipt_ids_touched: uniqueTouched.size,
      },
    },
    contracts,
    sources,
    notional_metrics: {
      gross_public_execution_notional: publicExecutionScan.notional,
      private_mist_notional: mistTraceScan.notional,
      blocked_reasons: blockedReasons,
    },
    coverage: {
      computed_sources: sources.filter((source) => source.status === "computed").map((source) => source.id),
      blocked_sources: sources.filter((source) => source.status === "blocked").map((source) => source.id),
      notes: [
        "All metrics are windowed to the requested block range and only use verified mainnet addresses.",
        "Receipt counts are derived from event scans, not contract view calls, because the deployed mainnet ABI surface has not been normalized in this workspace.",
        "Public route attribution uses Ekubo swap events and reports gross absolute deltas in raw felt units.",
        "Private MIST trace metrics are only computed for bounded block windows because the chamber does not emit deposit or withdrawal events.",
      ],
      request_count: requestCount,
    },
  };
}

interface EventScanResult {
  id: string;
  label: string;
  contract: string;
  address: string;
  status: "computed" | "blocked";
  selector: string;
  eventCount: number;
  uniqueReceiptIds: Set<string>;
  reason?: string;
}

interface TraceScanResult {
  id: string;
  label: string;
  contract: string;
  address: string;
  status: "computed" | "blocked";
  callCount: number;
  chunkCount: number;
  reason?: string;
  notional: MistPrivateNotional | null;
}

interface PublicExecutionScanResult {
  id: string;
  label: string;
  contract: string;
  address: string;
  status: "computed" | "blocked";
  selector: string;
  eventCount: number;
  uniqueCallers: Set<string>;
  grossAmount0Abs: bigint;
  grossAmount1Abs: bigint;
  reason?: string;
  notional: PublicExecutionNotional | null;
}

async function getContractStatus(
  rpc: StarknetRPC,
  label: string,
  address: string,
  source: ContractFootprintStatus["source"]
): Promise<ContractFootprintStatus> {
  if (!isHexFelt(address)) {
    return {
      label,
      address,
      source,
      deployed: false,
      class_hash: null,
      note: "invalid or unresolved mainnet address",
    };
  }

  try {
    const classHash = await rpc.getClassHashAt(address);
    return {
      label,
      address,
      source,
      deployed: true,
      class_hash: classHash,
    };
  } catch (error) {
    return {
      label,
      address,
      source,
      deployed: false,
      class_hash: null,
      note: error instanceof Error ? error.message : "deployment check failed",
    };
  }
}

async function scanEventSource(
  rpc: StarknetRPC,
  spec: EventScanSpec,
  fromBlock: number,
  toBlock: number
): Promise<EventScanResult> {
  const eventSelector = selector.getSelectorFromName(spec.eventName);
  const uniqueReceiptIds = new Set<string>();

  if (!isHexFelt(spec.address)) {
    return {
      id: spec.id,
      label: spec.label,
      contract: spec.contract,
      address: spec.address,
      status: "blocked",
      selector: eventSelector,
      eventCount: 0,
      uniqueReceiptIds,
      reason: "invalid or unresolved mainnet address",
    };
  }

  try {
    let eventCount = 0;

    for await (const page of rpc.getEvents({
      address: spec.address,
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      keys: [[eventSelector]],
    })) {
      for (const event of page) {
        eventCount += 1;
        const receiptId = getReceiptIdFromEvent(event);
        if (receiptId) {
          uniqueReceiptIds.add(receiptId);
        }
      }
    }

    return {
      id: spec.id,
      label: spec.label,
      contract: spec.contract,
      address: spec.address,
      status: "computed",
      selector: eventSelector,
      eventCount,
      uniqueReceiptIds,
    };
  } catch (error) {
    return {
      id: spec.id,
      label: spec.label,
      contract: spec.contract,
      address: spec.address,
      status: "blocked",
      selector: eventSelector,
      eventCount: 0,
      uniqueReceiptIds,
      reason: error instanceof Error ? error.message : "event scan failed",
    };
  }
}

function toSourceStatus(source: EventScanResult): FootprintSourceStatus {
  return {
    id: source.id,
    label: source.label,
    kind: "event_scan",
    contract: source.contract,
    address: source.address,
    status: source.status,
    selector: source.selector,
    event_count: source.eventCount,
    reason: source.reason,
  };
}

function toTraceSourceStatus(source: TraceScanResult): FootprintSourceStatus {
  return {
    id: source.id,
    label: source.label,
    kind: "trace_scan",
    contract: source.contract,
    address: source.address,
    status: source.status,
    call_count: source.callCount,
    chunk_count: source.chunkCount,
    reason: source.reason,
  };
}

function toPublicExecutionSourceStatus(source: PublicExecutionScanResult): FootprintSourceStatus {
  return {
    id: source.id,
    label: source.label,
    kind: "event_scan",
    contract: source.contract,
    address: source.address,
    status: source.status,
    selector: source.selector,
    event_count: source.eventCount,
    reason: source.reason,
  };
}

function getEventSource(sources: EventScanResult[], id: string): EventScanResult {
  const source = sources.find((entry) => entry.id === id);
  if (!source) {
    throw new Error(`Missing footprint event source: ${id}`);
  }
  return source;
}

function getReceiptIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const keys = (event as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.length < 2) {
    return null;
  }

  return normalizeFelt(keys[1]);
}

function normalizeFelt(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return null;
  }
}

function getContractAddress(name: string): string {
  const entry = (receiptOsContracts as Record<string, { address?: string }>)[name];
  return entry?.address ?? "unresolved";
}

async function scanEkuboPublicExecution(
  rpc: StarknetRPC,
  address: string,
  fromBlock: number,
  toBlock: number
): Promise<PublicExecutionScanResult> {
  const swapSelector = selector.getSelectorFromName("swap");
  if (!isHexFelt(address)) {
    return {
      id: EKUBO_PUBLIC_ROUTE_SOURCE_ID,
      label: EKUBO_PUBLIC_ROUTE_SOURCE_LABEL,
      contract: "ekubo_core",
      address,
      status: "blocked",
      selector: swapSelector,
      eventCount: 0,
      uniqueCallers: new Set<string>(),
      grossAmount0Abs: 0n,
      grossAmount1Abs: 0n,
      reason: "invalid or unresolved Ekubo mainnet address",
      notional: null,
    };
  }

  let eventCount = 0;
  let grossAmount0Abs = 0n;
  let grossAmount1Abs = 0n;
  const uniqueCallers = new Set<string>();

  try {
    for await (const page of rpc.getEvents({
      address,
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      keys: [[swapSelector]],
    })) {
      for (const event of page) {
        eventCount += 1;
        const data = getEventData(event);
        if (data.length >= 4) {
          const amount0 = parseSignedFelt(data[1]);
          const amount1 = parseSignedFelt(data[2]);
          if (amount0 !== null) {
            grossAmount0Abs += absBigInt(amount0);
          }
          if (amount1 !== null) {
            grossAmount1Abs += absBigInt(amount1);
          }
          const caller = normalizeFelt(data[3]);
          if (caller) {
            uniqueCallers.add(caller);
          }
        }
      }
    }
  } catch (error) {
    return {
      id: EKUBO_PUBLIC_ROUTE_SOURCE_ID,
      label: EKUBO_PUBLIC_ROUTE_SOURCE_LABEL,
      contract: "ekubo_core",
      address,
      status: "blocked",
      selector: swapSelector,
      eventCount: 0,
      uniqueCallers,
      grossAmount0Abs: 0n,
      grossAmount1Abs: 0n,
      reason: error instanceof Error ? error.message : "ekubo swap event scan failed",
      notional: null,
    };
  }

  return {
    id: EKUBO_PUBLIC_ROUTE_SOURCE_ID,
    label: EKUBO_PUBLIC_ROUTE_SOURCE_LABEL,
    contract: "ekubo_core",
    address,
    status: "computed",
    selector: swapSelector,
    eventCount,
    uniqueCallers,
    grossAmount0Abs,
    grossAmount1Abs,
    notional: {
      route_attribution: {
        ekubo_direct: eventCount,
      },
      ekubo_swap: {
        event_count: eventCount,
        unique_callers: uniqueCallers.size,
        gross_amount0_abs_raw: grossAmount0Abs.toString(),
        gross_amount1_abs_raw: grossAmount1Abs.toString(),
      },
      note: "Computed from Ekubo swap event deltas in raw felt units. USD normalization and pool token mapping are pending.",
    },
  };
}

async function scanMistChamberTraceWindow(
  rpc: StarknetRPC,
  address: string,
  fromBlock: number,
  toBlock: number,
  options: FootprintComputationOptions
): Promise<TraceScanResult> {
  const span = Math.max(0, toBlock - fromBlock + 1);
  const maxTraceScanBlocks = Number.parseInt(
    process.env.FOOTPRINT_TRACE_MAX_BLOCKS ?? `${DEFAULT_TRACE_SCAN_MAX_BLOCKS}`,
    10
  );
  const requestedChunkSize = options.traceChunkSize;

  if (!isHexFelt(address)) {
    return {
      id: MIST_TRACE_SOURCE_ID,
      label: MIST_TRACE_SOURCE_LABEL,
      contract: "mist_chamber",
      address,
      status: "blocked",
      callCount: 0,
      chunkCount: 0,
      reason: "invalid or unresolved mainnet address",
      notional: null,
    };
  }

  if (requestedChunkSize !== undefined && (!Number.isInteger(requestedChunkSize) || requestedChunkSize <= 0)) {
    return {
      id: MIST_TRACE_SOURCE_ID,
      label: MIST_TRACE_SOURCE_LABEL,
      contract: "mist_chamber",
      address,
      status: "blocked",
      callCount: 0,
      chunkCount: 0,
      reason: "traceChunkSize must be a positive integer when provided",
      notional: null,
    };
  }

  const chunkSize = requestedChunkSize ?? span;
  const preloadedChunks = indexPreloadedTraceChunks(options.preloadedTraceChunks ?? []);

  if (chunkSize > maxTraceScanBlocks) {
    return {
      id: MIST_TRACE_SOURCE_ID,
      label: MIST_TRACE_SOURCE_LABEL,
      contract: "mist_chamber",
      address,
      status: "blocked",
      callCount: 0,
      chunkCount: 0,
      reason: `private MIST trace chunks must be ${maxTraceScanBlocks} blocks or fewer`,
      notional: null,
    };
  }

  if (span > maxTraceScanBlocks && requestedChunkSize === undefined) {
    return {
      id: MIST_TRACE_SOURCE_ID,
      label: MIST_TRACE_SOURCE_LABEL,
      contract: "mist_chamber",
      address,
      status: "blocked",
      callCount: 0,
      chunkCount: 0,
      reason: `private MIST trace scan requires a bounded block window of ${maxTraceScanBlocks} blocks or fewer unless traceChunkSize is provided`,
      notional: null,
    };
  }

  const depositTotals = new Map<string, bigint>();
  const withdrawNoZkTotals = new Map<string, bigint>();
  const seekAndHideTotals = new Map<string, bigint>();
  let depositCalls = 0;
  let withdrawNoZkCalls = 0;
  let seekAndHideCalls = 0;
  let handleZkpCalls = 0;
  const chunkCount = Math.ceil(span / chunkSize);

  try {
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunkFromBlock = fromBlock + chunkIndex * chunkSize;
      const chunkToBlock = Math.min(toBlock, chunkFromBlock + chunkSize - 1);
      const preloadedChunk = preloadedChunks.get(getTraceChunkKey(chunkIndex + 1, chunkFromBlock, chunkToBlock));
      const chunkResult = preloadedChunk
        ? getChunkResultFromCheckpoint(preloadedChunk)
        : await scanMistChamberTraceChunk(rpc, address, chunkFromBlock, chunkToBlock);
      let resolvedChunk = preloadedChunk;

      mergeTokenTotals(depositTotals, chunkResult.depositTotals);
      mergeTokenTotals(withdrawNoZkTotals, chunkResult.withdrawNoZkTotals);
      mergeTokenTotals(seekAndHideTotals, chunkResult.seekAndHideTotals);
      depositCalls += chunkResult.depositCalls;
      withdrawNoZkCalls += chunkResult.withdrawNoZkCalls;
      seekAndHideCalls += chunkResult.seekAndHideCalls;
      handleZkpCalls += chunkResult.handleZkpCalls;

      if (!preloadedChunk && options.onTraceChunkComplete) {
        const checkpoint: FootprintTraceChunkCheckpoint = {
          chunk_index: chunkIndex + 1,
          chunk_count: chunkCount,
          window: {
            from_block: chunkFromBlock,
            to_block: chunkToBlock,
          },
          call_count: chunkResult.callCount,
          notional: buildMistPrivateNotional(
            chunkToBlock - chunkFromBlock + 1,
            1,
            chunkResult.depositCalls,
            chunkResult.depositTotals,
            chunkResult.withdrawNoZkCalls,
            chunkResult.withdrawNoZkTotals,
            chunkResult.seekAndHideCalls,
            chunkResult.seekAndHideTotals,
            chunkResult.handleZkpCalls,
            "Chunk-level MIST trace metrics decoded from chamber calldata."
          ),
        };
        await options.onTraceChunkComplete(checkpoint);
        resolvedChunk = checkpoint;
      }

      if (!resolvedChunk) {
        resolvedChunk = {
          chunk_index: chunkIndex + 1,
          chunk_count: chunkCount,
          window: {
            from_block: chunkFromBlock,
            to_block: chunkToBlock,
          },
          call_count: chunkResult.callCount,
          notional: buildMistPrivateNotional(
            chunkToBlock - chunkFromBlock + 1,
            1,
            chunkResult.depositCalls,
            chunkResult.depositTotals,
            chunkResult.withdrawNoZkCalls,
            chunkResult.withdrawNoZkTotals,
            chunkResult.seekAndHideCalls,
            chunkResult.seekAndHideTotals,
            chunkResult.handleZkpCalls,
            "Chunk-level MIST trace metrics decoded from chamber calldata."
          ),
        };
      }

      if (options.onTraceChunkResolved) {
        const source: FootprintTraceChunkResolutionSource = preloadedChunk ? "reused" : "traced";
        await options.onTraceChunkResolved(resolvedChunk, source);
      }
    }
  } catch (error) {
    return {
      id: MIST_TRACE_SOURCE_ID,
      label: MIST_TRACE_SOURCE_LABEL,
      contract: "mist_chamber",
      address,
      status: "blocked",
      callCount: 0,
      chunkCount: 0,
      reason: error instanceof Error ? error.message : "trace scan failed",
      notional: null,
    };
  }

  const notional = buildMistPrivateNotional(
    span,
    chunkCount,
    depositCalls,
    depositTotals,
    withdrawNoZkCalls,
    withdrawNoZkTotals,
    seekAndHideCalls,
    seekAndHideTotals,
    handleZkpCalls,
    chunkCount > 1
      ? "Deposit, withdraw_no_zk, and seek_and_hide_no_zk amounts are decoded from chamber calldata and aggregated across trace chunks. handle_zkp calls are counted but notional remains opaque in proof calldata."
      : "Deposit, withdraw_no_zk, and seek_and_hide_no_zk amounts are decoded directly from chamber calldata. handle_zkp calls are counted but notional remains opaque in proof calldata."
  );

  return {
    id: MIST_TRACE_SOURCE_ID,
    label: MIST_TRACE_SOURCE_LABEL,
    contract: "mist_chamber",
    address,
    status: "computed",
    callCount: depositCalls + withdrawNoZkCalls + seekAndHideCalls + handleZkpCalls,
    chunkCount,
    notional,
  };
}

interface MistTraceChunkScanResult {
  depositTotals: Map<string, bigint>;
  withdrawNoZkTotals: Map<string, bigint>;
  seekAndHideTotals: Map<string, bigint>;
  depositCalls: number;
  withdrawNoZkCalls: number;
  seekAndHideCalls: number;
  handleZkpCalls: number;
  callCount: number;
}

async function scanMistChamberTraceChunk(
  rpc: StarknetRPC,
  address: string,
  fromBlock: number,
  toBlock: number
): Promise<MistTraceChunkScanResult> {
  const depositTotals = new Map<string, bigint>();
  const withdrawNoZkTotals = new Map<string, bigint>();
  const seekAndHideTotals = new Map<string, bigint>();
  let depositCalls = 0;
  let withdrawNoZkCalls = 0;
  let seekAndHideCalls = 0;
  let handleZkpCalls = 0;

  for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
    const traces = await rpc.getBlockTransactionsTraces(blockNumber);
    for (const trace of traces) {
      const calls = getTraceRoots(trace);
      for (const call of calls) {
        if (normalizeHex(call.contract_address) !== normalizeHex(address)) {
          continue;
        }

        const entryPoint = normalizeHex(call.entry_point_selector);
        if (entryPoint === CHAMBER_SELECTORS.deposit) {
          depositCalls += 1;
          const decoded = decodeDepositCall(call.calldata);
          if (decoded) {
            accumulateTokenTotal(depositTotals, decoded.token, decoded.amount);
          }
          continue;
        }

        if (entryPoint === CHAMBER_SELECTORS.withdraw_no_zk) {
          withdrawNoZkCalls += 1;
          const decoded = decodeWithdrawNoZkCall(call.calldata);
          if (decoded) {
            accumulateTokenTotal(withdrawNoZkTotals, decoded.token, decoded.amount);
          }
          continue;
        }

        if (entryPoint === CHAMBER_SELECTORS.seek_and_hide_no_zk) {
          seekAndHideCalls += 1;
          const decoded = decodeSeekAndHideNoZkCall(call.calldata);
          if (decoded) {
            accumulateTokenTotal(seekAndHideTotals, decoded.token, decoded.amount);
          }
          continue;
        }

        if (entryPoint === CHAMBER_SELECTORS.handle_zkp) {
          handleZkpCalls += 1;
        }
      }
    }
  }

  return {
    depositTotals,
    withdrawNoZkTotals,
    seekAndHideTotals,
    depositCalls,
    withdrawNoZkCalls,
    seekAndHideCalls,
    handleZkpCalls,
    callCount: depositCalls + withdrawNoZkCalls + seekAndHideCalls + handleZkpCalls,
  };
}

function buildMistPrivateNotional(
  span: number,
  chunkCount: number,
  depositCalls: number,
  depositTotals: Map<string, bigint>,
  withdrawNoZkCalls: number,
  withdrawNoZkTotals: Map<string, bigint>,
  seekAndHideCalls: number,
  seekAndHideTotals: Map<string, bigint>,
  handleZkpCalls: number,
  note: string
): MistPrivateNotional {
  return {
    trace_window_block_span: span,
    trace_chunk_count: chunkCount,
    deposit: {
      call_count: depositCalls,
      token_totals_raw: mapBigIntRecord(depositTotals),
      token_totals: normalizeTokenTotals(depositTotals),
    },
    withdraw_no_zk: {
      call_count: withdrawNoZkCalls,
      token_totals_raw: mapBigIntRecord(withdrawNoZkTotals),
      token_totals: normalizeTokenTotals(withdrawNoZkTotals),
    },
    seek_and_hide_no_zk: {
      call_count: seekAndHideCalls,
      token_totals_raw: mapBigIntRecord(seekAndHideTotals),
      token_totals: normalizeTokenTotals(seekAndHideTotals),
    },
    handle_zkp_call_count: handleZkpCalls,
    note,
  };
}

function mergeTokenTotals(target: Map<string, bigint>, source: Map<string, bigint>): void {
  for (const [token, amount] of source.entries()) {
    accumulateTokenTotal(target, token, amount);
  }
}

function indexPreloadedTraceChunks(
  checkpoints: FootprintTraceChunkCheckpoint[]
): Map<string, FootprintTraceChunkCheckpoint> {
  return new Map(
    checkpoints.map((checkpoint) => [
      getTraceChunkKey(
        checkpoint.chunk_index,
        checkpoint.window.from_block,
        checkpoint.window.to_block
      ),
      checkpoint,
    ])
  );
}

function getTraceChunkKey(chunkIndex: number, fromBlock: number, toBlock: number): string {
  return `${chunkIndex}:${fromBlock}:${toBlock}`;
}

function getChunkResultFromCheckpoint(checkpoint: FootprintTraceChunkCheckpoint): MistTraceChunkScanResult {
  return {
    depositTotals: mapRecordToBigIntTotals(checkpoint.notional.deposit.token_totals_raw),
    withdrawNoZkTotals: mapRecordToBigIntTotals(checkpoint.notional.withdraw_no_zk.token_totals_raw),
    seekAndHideTotals: mapRecordToBigIntTotals(checkpoint.notional.seek_and_hide_no_zk.token_totals_raw),
    depositCalls: checkpoint.notional.deposit.call_count,
    withdrawNoZkCalls: checkpoint.notional.withdraw_no_zk.call_count,
    seekAndHideCalls: checkpoint.notional.seek_and_hide_no_zk.call_count,
    handleZkpCalls: checkpoint.notional.handle_zkp_call_count,
    callCount: checkpoint.call_count,
  };
}

function mapRecordToBigIntTotals(record: Record<string, string>): Map<string, bigint> {
  return new Map(
    Object.entries(record).map(([token, amount]) => [token, BigInt(amount)])
  );
}

function getTraceRoots(trace: unknown): ChamberCallLike[] {
  const roots = [] as unknown[];
  if (trace && typeof trace === "object") {
    const value = trace as Record<string, unknown>;
    roots.push(value.trace_root, value.execute_invocation, value.validate_invocation, value.fee_transfer_invocation);
  }

  const output: ChamberCallLike[] = [];
  const stack = roots.filter(Boolean);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    const call = current as ChamberCallLike;
    output.push(call);
    if (Array.isArray(call.calls)) {
      stack.push(...call.calls);
    }
  }
  return output;
}

type ChamberCallLike = {
  contract_address?: unknown;
  entry_point_selector?: unknown;
  calldata?: unknown;
  calls?: unknown[];
};

function decodeDepositCall(calldata: unknown): { token: string; amount: bigint } | null {
  const values = toHexArray(calldata);
  if (values.length < 5) {
    return null;
  }
  return decodeAssetAtOffset(values, 2);
}

function decodeWithdrawNoZkCall(calldata: unknown): { token: string; amount: bigint } | null {
  const values = toHexArray(calldata);
  if (values.length < 6) {
    return null;
  }
  return decodeAssetAtOffset(values, 3);
}

function decodeSeekAndHideNoZkCall(calldata: unknown): { token: string; amount: bigint } | null {
  const values = toHexArray(calldata);
  if (values.length < 6) {
    return null;
  }
  return decodeAssetAtOffset(values, 3);
}

function decodeAssetAtOffset(values: string[], offset: number): { token: string; amount: bigint } | null {
  if (values.length < offset + 3) {
    return null;
  }

  const amountLow = parseBigInt(values[offset]);
  const amountHigh = parseBigInt(values[offset + 1]);
  const token = normalizeHex(values[offset + 2]);
  if (amountLow === null || amountHigh === null || !token) {
    return null;
  }

  return {
    token,
    amount: amountLow + amountHigh * (2n ** 128n),
  };
}

function toHexArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseSignedFelt(value: unknown): bigint | null {
  const parsed = parseBigInt(value);
  if (parsed === null) {
    return null;
  }
  if (parsed > STARKNET_HALF_PRIME) {
    return parsed - STARKNET_PRIME;
  }
  return parsed;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function getEventData(event: unknown): string[] {
  if (!event || typeof event !== "object") {
    return [];
  }
  const data = (event as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter((entry): entry is string => typeof entry === "string");
}

function normalizeHex(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return String(value).toLowerCase();
  }
}

function accumulateTokenTotal(target: Map<string, bigint>, token: string, amount: bigint): void {
  target.set(token, (target.get(token) ?? 0n) + amount);
}

function mapBigIntRecord(target: Map<string, bigint>): Record<string, string> {
  return Object.fromEntries(Array.from(target.entries()).map(([token, amount]) => [token, amount.toString()]));
}

function normalizeTokenTotals(target: Map<string, bigint>): Array<{
  token_address: string;
  symbol: string | null;
  decimals: number | null;
  amount_raw: string;
  amount_decimal: string | null;
}> {
  return Array.from(target.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tokenAddress, amount]) => {
      const metadata = MIST_TOKEN_METADATA[normalizeHex(tokenAddress)] ?? {};
      const decimals = Number.isInteger(metadata.decimals) ? metadata.decimals ?? null : null;
      return {
        token_address: tokenAddress,
        symbol: metadata.symbol ?? null,
        decimals,
        amount_raw: amount.toString(),
        amount_decimal: decimals === null ? null : formatDecimalAmount(amount, decimals),
      };
    });
}

function formatDecimalAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) {
    return amount.toString();
  }

  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
}

function isHexFelt(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}
