import { describe, expect, it } from "vitest";
import { selector } from "starknet";
import addresses from "../../integration/addresses.json";
import { computeProtocolFootprint } from "../src/footprint/index";
import type { StarknetRPC } from "../src/rpc-client";

function mockRpc(opts: {
  blockNumber?: number;
  classHashes?: Record<string, string | Error>;
  getEventsImpl?: (filter: unknown) => unknown[][];
  getBlockTransactionsTracesImpl?: (blockNumber: number) => unknown[];
}): StarknetRPC {
  let requestCount = 0;

  return {
    getNonce: async () => {
      requestCount += 1;
      return 0;
    },
    getClassHashAt: async (address: string) => {
      requestCount += 1;
      const result = opts.classHashes?.[address];
      if (result instanceof Error) {
        throw result;
      }
      return result ?? "0x1";
    },
    getBlockNumber: async () => {
      requestCount += 1;
      return opts.blockNumber ?? 900_000;
    },
    async *getEvents(filter: unknown): AsyncGenerator<unknown[]> {
      requestCount += 1;
      const pages = opts.getEventsImpl?.(filter) ?? [[]];
      for (const page of pages) {
        yield page;
      }
    },
    getBlockTransactionsTraces: async (blockNumber: number) => {
      requestCount += 1;
      return opts.getBlockTransactionsTracesImpl?.(blockNumber) ?? [];
    },
    getRequestCount: () => requestCount,
  } as unknown as StarknetRPC;
}

describe("computeProtocolFootprint", () => {
  it("computes windowed receipt metrics and blocks mist traces for oversized windows", async () => {
    const issuedSelector = selector.getSelectorFromName("ReceiptIssued");
    const consumedSelector = selector.getSelectorFromName("ReceiptConsumed");
    const anchoredSelector = selector.getSelectorFromName("CidAnchored");
    const ekuboSwapSelector = selector.getSelectorFromName("swap");

    const rpc = mockRpc({
      blockNumber: 810_000,
      classHashes: {
        [addresses.mainnet.receipt_registry_v01]: "0xaaa",
        [addresses.mainnet.receipt_archive_v01]: "0xbbb",
        "0x06f8dcc500131b6be6b33f4534ec6d33df33e61083ec2b051555d52e75654444": new Error("Contract not found"),
      },
      getEventsImpl: (filter) => {
        const eventFilter = filter as { address?: string; keys?: string[][] };
        const eventSelector = eventFilter.keys?.[0]?.[0];

        if (eventFilter.address === addresses.mainnet.receipt_registry_v01 && eventSelector === issuedSelector) {
          return [[
            { keys: [issuedSelector, "0x1", "0xabc"], data: ["0x64"] },
            { keys: [issuedSelector, "0x2", "0xdef"], data: ["0xc8"] },
          ]];
        }

        if (eventFilter.address === addresses.mainnet.receipt_registry_v01 && eventSelector === consumedSelector) {
          return [[
            { keys: [consumedSelector, "0x2", "0x999"], data: [] },
          ]];
        }

        if (eventFilter.address === addresses.mainnet.receipt_archive_v01 && eventSelector === anchoredSelector) {
          return [[
            { keys: [anchoredSelector, "0x1", "0x555"], data: [] },
          ]];
        }

        if (
          eventFilter.address === "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b"
          && eventSelector === ekuboSwapSelector
        ) {
          return [[]];
        }

        return [[]];
      },
    });

    const snapshot = await computeProtocolFootprint(rpc, {
      fromBlock: 800_000,
      toBlock: 810_000,
    });

    expect(snapshot.window).toEqual({ from_block: 800_000, to_block: 810_000 });
    expect(snapshot.metrics.verified_deployed_contracts).toBe(3);
    expect(snapshot.metrics.windowed.receipts_issued).toBe(2);
    expect(snapshot.metrics.windowed.receipts_consumed).toBe(1);
    expect(snapshot.metrics.windowed.cid_anchors).toBe(1);
    expect(snapshot.metrics.windowed.unique_receipt_ids_issued).toBe(2);
    expect(snapshot.metrics.windowed.unique_receipt_ids_consumed).toBe(1);
    expect(snapshot.metrics.windowed.unique_receipt_ids_anchored).toBe(1);
    expect(snapshot.metrics.windowed.unique_receipt_ids_touched).toBe(2);
    expect(snapshot.coverage.blocked_sources).toContain("mist_chamber.deployment");
    expect(snapshot.coverage.blocked_sources).toContain("mist_chamber.trace_window");
    expect(snapshot.notional_metrics.gross_public_execution_notional).toEqual({
      route_attribution: {
        ekubo_direct: 0,
      },
      ekubo_swap: {
        event_count: 0,
        unique_callers: 0,
        gross_amount0_abs_raw: "0",
        gross_amount1_abs_raw: "0",
      },
      note: expect.any(String),
    });
    expect(snapshot.notional_metrics.private_mist_notional).toBeNull();
  });

  it("computes public Ekubo route attribution and gross delta totals", async () => {
    const ekuboSwapSelector = selector.getSelectorFromName("swap");
    const ekubo = "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b";
    const starkPrime = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");
    const negativeDelta = (starkPrime - 5n).toString();

    const rpc = mockRpc({
      blockNumber: 200,
      classHashes: {
        [addresses.mainnet.receipt_registry_v01]: "0xaaa",
        [addresses.mainnet.receipt_archive_v01]: "0xbbb",
        [ekubo]: "0xeee",
        "0x06f8dcc500131b6be6b33f4534ec6d33df33e61083ec2b051555d52e75654444": "0xccc",
      },
      getEventsImpl: (filter) => {
        const eventFilter = filter as { address?: string; keys?: string[][] };
        const eventSelector = eventFilter.keys?.[0]?.[0];
        if (eventFilter.address === ekubo && eventSelector === ekuboSwapSelector) {
          return [[
            { keys: [ekuboSwapSelector], data: ["0xpool", "0x14", "0x3", "0xabc"] },
            { keys: [ekuboSwapSelector], data: ["0xpool", negativeDelta, "0x2", "0xdef"] },
          ]];
        }
        return [[]];
      },
      getBlockTransactionsTracesImpl: () => [],
    });

    const snapshot = await computeProtocolFootprint(rpc, {
      fromBlock: 190,
      toBlock: 200,
    });

    expect(snapshot.notional_metrics.gross_public_execution_notional).toEqual({
      route_attribution: {
        ekubo_direct: 2,
      },
      ekubo_swap: {
        event_count: 2,
        unique_callers: 2,
        gross_amount0_abs_raw: "25",
        gross_amount1_abs_raw: "5",
      },
      note: expect.any(String),
    });
  });

  it("computes bounded mist chamber trace totals from decoded calldata", async () => {
    const depositSelector = selector.getSelectorFromName("deposit");
    const withdrawSelector = selector.getSelectorFromName("withdraw_no_zk");
    const handleZkpSelector = selector.getSelectorFromName("handle_zkp");
    const chamber = "0x06f8dcc500131b6be6b33f4534ec6d33df33e61083ec2b051555d52e75654444";
    const token = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

    const rpc = mockRpc({
      blockNumber: 100,
      classHashes: {
        [addresses.mainnet.receipt_registry_v01]: "0xaaa",
        [addresses.mainnet.receipt_archive_v01]: "0xbbb",
        [chamber]: "0xccc",
      },
      getEventsImpl: () => [[]],
      getBlockTransactionsTracesImpl: (blockNumber) => {
        if (blockNumber !== 99 && blockNumber !== 100) {
          return [];
        }

        return [
          {
            trace_root: {
              contract_address: chamber,
              entry_point_selector: depositSelector,
              calldata: ["0x1", "0x0", "0x64", "0x0", token],
              calls: [],
            },
          },
          {
            trace_root: {
              contract_address: chamber,
              entry_point_selector: withdrawSelector,
              calldata: ["0x2", "0x0", "0xabc", "0x32", "0x0", token, "0x0"],
              calls: [],
            },
          },
          {
            trace_root: {
              contract_address: chamber,
              entry_point_selector: handleZkpSelector,
              calldata: ["0x03", "0x123"],
              calls: [],
            },
          },
        ];
      },
    });

    const priorMax = process.env.FOOTPRINT_TRACE_MAX_BLOCKS;
    process.env.FOOTPRINT_TRACE_MAX_BLOCKS = "10";

    try {
      const snapshot = await computeProtocolFootprint(rpc, {
        fromBlock: 99,
        toBlock: 100,
      });

      expect(snapshot.coverage.blocked_sources).not.toContain("mist_chamber.trace_window");
      expect(snapshot.notional_metrics.private_mist_notional).not.toBeNull();
      expect(snapshot.notional_metrics.private_mist_notional?.deposit.call_count).toBe(2);
      expect(snapshot.notional_metrics.private_mist_notional?.deposit.token_totals_raw[token]).toBe("200");
      expect(snapshot.notional_metrics.private_mist_notional?.deposit.token_totals).toEqual([
        {
          token_address: token,
          symbol: "ETH",
          decimals: 18,
          amount_raw: "200",
          amount_decimal: "0.0000000000000002",
        },
      ]);
      expect(snapshot.notional_metrics.private_mist_notional?.trace_chunk_count).toBe(1);
      expect(snapshot.notional_metrics.private_mist_notional?.withdraw_no_zk.call_count).toBe(2);
      expect(snapshot.notional_metrics.private_mist_notional?.withdraw_no_zk.token_totals_raw[token]).toBe("100");
      expect(snapshot.notional_metrics.private_mist_notional?.handle_zkp_call_count).toBe(2);
    } finally {
      if (priorMax === undefined) {
        delete process.env.FOOTPRINT_TRACE_MAX_BLOCKS;
      } else {
        process.env.FOOTPRINT_TRACE_MAX_BLOCKS = priorMax;
      }
    }
  });

  it("aggregates mist chamber traces across configured chunks and emits checkpoints", async () => {
    const depositSelector = selector.getSelectorFromName("deposit");
    const chamber = "0x06f8dcc500131b6be6b33f4534ec6d33df33e61083ec2b051555d52e75654444";
    const token = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
    const seenChunks: Array<{ from_block: number; to_block: number; call_count: number }> = [];

    const rpc = mockRpc({
      blockNumber: 104,
      classHashes: {
        [addresses.mainnet.receipt_registry_v01]: "0xaaa",
        [addresses.mainnet.receipt_archive_v01]: "0xbbb",
        [chamber]: "0xccc",
      },
      getEventsImpl: () => [[]],
      getBlockTransactionsTracesImpl: (blockNumber) => {
        if (blockNumber === 100 || blockNumber === 103) {
          return [{
            trace_root: {
              contract_address: chamber,
              entry_point_selector: depositSelector,
              calldata: ["0x1", "0x0", blockNumber === 100 ? "0x5" : "0x7", "0x0", token],
              calls: [],
            },
          }];
        }

        return [];
      },
    });

    const priorMax = process.env.FOOTPRINT_TRACE_MAX_BLOCKS;
    process.env.FOOTPRINT_TRACE_MAX_BLOCKS = "2";

    try {
      const snapshot = await computeProtocolFootprint(rpc, {
        fromBlock: 100,
        toBlock: 104,
        traceChunkSize: 2,
        onTraceChunkComplete: (chunk) => {
          seenChunks.push({
            from_block: chunk.window.from_block,
            to_block: chunk.window.to_block,
            call_count: chunk.call_count,
          });
        },
      });

      expect(snapshot.coverage.blocked_sources).not.toContain("mist_chamber.trace_window");
      expect(snapshot.notional_metrics.private_mist_notional?.trace_chunk_count).toBe(3);
      expect(snapshot.notional_metrics.private_mist_notional?.deposit.call_count).toBe(2);
      expect(snapshot.notional_metrics.private_mist_notional?.deposit.token_totals_raw[token]).toBe("12");
      expect(snapshot.notional_metrics.private_mist_notional?.deposit.token_totals).toEqual([
        {
          token_address: token,
          symbol: "ETH",
          decimals: 18,
          amount_raw: "12",
          amount_decimal: "0.000000000000000012",
        },
      ]);
      expect(snapshot.sources.find((source) => source.id === "mist_chamber.trace_window")?.chunk_count).toBe(3);
      expect(seenChunks).toEqual([
        { from_block: 100, to_block: 101, call_count: 1 },
        { from_block: 102, to_block: 103, call_count: 1 },
        { from_block: 104, to_block: 104, call_count: 0 },
      ]);
    } finally {
      if (priorMax === undefined) {
        delete process.env.FOOTPRINT_TRACE_MAX_BLOCKS;
      } else {
        process.env.FOOTPRINT_TRACE_MAX_BLOCKS = priorMax;
      }
    }
  });

  it("reuses preloaded mist trace chunks instead of rescanning them", async () => {
    const chamber = "0x06f8dcc500131b6be6b33f4534ec6d33df33e61083ec2b051555d52e75654444";
    const token = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
    let traceRequests = 0;
    const resolvedChunks: Array<{ chunk_index: number; source: string; call_count: number }> = [];

    const rpc = mockRpc({
      blockNumber: 101,
      classHashes: {
        [addresses.mainnet.receipt_registry_v01]: "0xaaa",
        [addresses.mainnet.receipt_archive_v01]: "0xbbb",
        [chamber]: "0xccc",
      },
      getEventsImpl: () => [[]],
      getBlockTransactionsTracesImpl: () => {
        traceRequests += 1;
        return [];
      },
    });

    const priorMax = process.env.FOOTPRINT_TRACE_MAX_BLOCKS;
    process.env.FOOTPRINT_TRACE_MAX_BLOCKS = "1";

    try {
      const snapshot = await computeProtocolFootprint(rpc, {
        fromBlock: 100,
        toBlock: 101,
        traceChunkSize: 1,
        preloadedTraceChunks: [
          {
            chunk_index: 1,
            chunk_count: 2,
            window: { from_block: 100, to_block: 100 },
            call_count: 1,
            notional: {
              trace_window_block_span: 1,
              trace_chunk_count: 1,
              deposit: {
                call_count: 1,
                token_totals_raw: { [token]: "9" },
                token_totals: [
                  {
                    token_address: token,
                    symbol: "ETH",
                    decimals: 18,
                    amount_raw: "9",
                    amount_decimal: "0.000000000000000009",
                  },
                ],
              },
              withdraw_no_zk: {
                call_count: 0,
                token_totals_raw: {},
                token_totals: [],
              },
              seek_and_hide_no_zk: {
                call_count: 0,
                token_totals_raw: {},
                token_totals: [],
              },
              handle_zkp_call_count: 0,
              note: "preloaded",
            },
          },
          {
            chunk_index: 2,
            chunk_count: 2,
            window: { from_block: 101, to_block: 101 },
            call_count: 0,
            notional: {
              trace_window_block_span: 1,
              trace_chunk_count: 1,
              deposit: {
                call_count: 0,
                token_totals_raw: {},
                token_totals: [],
              },
              withdraw_no_zk: {
                call_count: 0,
                token_totals_raw: {},
                token_totals: [],
              },
              seek_and_hide_no_zk: {
                call_count: 0,
                token_totals_raw: {},
                token_totals: [],
              },
              handle_zkp_call_count: 0,
              note: "preloaded",
            },
          },
        ],
        onTraceChunkResolved: (chunk, source) => {
          resolvedChunks.push({
            chunk_index: chunk.chunk_index,
            source,
            call_count: chunk.call_count,
          });
        },
      });

      expect(traceRequests).toBe(0);
      expect(snapshot.notional_metrics.private_mist_notional?.deposit.token_totals_raw[token]).toBe("9");
      expect(snapshot.notional_metrics.private_mist_notional?.trace_chunk_count).toBe(2);
      expect(resolvedChunks).toEqual([
        { chunk_index: 1, source: "reused", call_count: 1 },
        { chunk_index: 2, source: "reused", call_count: 0 },
      ]);
    } finally {
      if (priorMax === undefined) {
        delete process.env.FOOTPRINT_TRACE_MAX_BLOCKS;
      } else {
        process.env.FOOTPRINT_TRACE_MAX_BLOCKS = priorMax;
      }
    }
  });
});
