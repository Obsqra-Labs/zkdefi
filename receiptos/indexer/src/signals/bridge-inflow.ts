import type { BridgeInflow, SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";
import contracts from "../../../config/mainnet-contracts.json";
import selectors from "../../../config/event-selectors.json";

export async function getBridgeInflow(
  rpc: StarknetRPC,
  wallet: string
): Promise<SignalResult<BridgeInflow | null>> {
  const latestBlock = await rpc.getBlockNumber();
  const lookbackBlocks = Number.parseInt(process.env.BRIDGE_LOOKBACK_BLOCKS ?? "50000", 10);
  const fromBlock = Math.max(0, latestBlock - lookbackBlocks);
  const startRequests = rpc.getRequestCount();

  const walletNormalized = normalizeAddress(wallet);
  if (!walletNormalized) {
    return {
      value: null,
      source: "invalid_wallet_address",
      blockRange: [fromBlock, latestBlock],
      requestCount: rpc.getRequestCount() - startRequests,
    };
  }

  const bridgeConfigs: Array<{ bridge: string; contractAddress?: string; depositSelector?: string }> = [
    {
      bridge: "starkgate_eth_bridge",
      contractAddress: getAddress("starkgate_eth_bridge"),
      depositSelector: getSelector("starkgate_eth_bridge", "deposit"),
    },
    {
      bridge: "starkgate_token_bridge",
      contractAddress: getAddress("starkgate_token_bridge"),
      depositSelector: undefined,
    },
  ];

  const tokenTotals = new Map<string, bigint>();
  const tokenEventCounts = new Map<string, number>();
  const bridgesIndexed = new Set<string>();
  let totalEvents = 0;

  for (const bridgeConfig of bridgeConfigs) {
    if (!bridgeConfig.contractAddress) {
      continue;
    }

    const keyFilter = isHexFelt(bridgeConfig.depositSelector) ? [[bridgeConfig.depositSelector as string]] : undefined;

    for await (const page of rpc.getEvents({
      address: bridgeConfig.contractAddress,
      from_block: { block_number: fromBlock },
      to_block: { block_number: latestBlock },
      keys: keyFilter,
    })) {
      for (const event of page) {
        const parsed = parseBridgeDepositEvent(event, walletNormalized);
        if (!parsed) {
          continue;
        }

        const tokenSymbol = bridgeConfig.bridge === "starkgate_eth_bridge" ? "ETH" : "BRIDGED_TOKEN";
        tokenTotals.set(tokenSymbol, (tokenTotals.get(tokenSymbol) ?? 0n) + parsed.amount);
        tokenEventCounts.set(tokenSymbol, (tokenEventCounts.get(tokenSymbol) ?? 0) + 1);
        bridgesIndexed.add(bridgeConfig.bridge);
        totalEvents += 1;
      }
    }
  }

  if (totalEvents === 0) {
    return {
      value: null,
      source: "no_bridge_deposits_in_lookback",
      blockRange: [fromBlock, latestBlock],
      requestCount: rpc.getRequestCount() - startRequests,
    };
  }

  const inflow: BridgeInflow = {
    tokens: Object.fromEntries(
      Array.from(tokenTotals.entries()).map(([token, total]) => [token, {
        raw_amount: total.toString(),
        decimals: 18,
        event_count: tokenEventCounts.get(token) ?? 0,
      }])
    ),
    total_events: totalEvents,
    bridges_indexed: Array.from(bridgesIndexed),
  };

  return {
    value: inflow,
    source: "starknet_getEvents_bridge_deposits",
    blockRange: [fromBlock, latestBlock],
    requestCount: rpc.getRequestCount() - startRequests,
  };
}

function getAddress(contractName: "starkgate_eth_bridge" | "starkgate_token_bridge"): string | undefined {
  const entry = (contracts as Record<string, { address?: string }>)[contractName];
  const address = entry?.address;
  return isHexFelt(address) ? address : undefined;
}

function getSelector(contractName: string, eventName: string): string | undefined {
  const contractEntry = (selectors as Record<string, Record<string, { selector?: string }>>)[contractName];
  const selector = contractEntry?.[eventName]?.selector;
  return isHexFelt(selector) ? selector : undefined;
}

function parseBridgeDepositEvent(
  event: unknown,
  walletNormalized: string
): { amount: bigint } | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const data = (event as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length < 3) {
    return null;
  }

  const toAddress = normalizeAddress(data[1]);
  if (!toAddress || toAddress !== walletNormalized) {
    return null;
  }

  const amount = parseBigIntFelt(data[data.length - 1]);
  if (amount === null || amount < 0n) {
    return null;
  }

  return { amount };
}

function normalizeAddress(value: unknown): string | null {
  const asBigInt = parseBigIntFelt(value);
  return asBigInt === null ? null : `0x${asBigInt.toString(16)}`;
}

function parseBigIntFelt(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    return value.startsWith("0x") || value.startsWith("0X") ? BigInt(value) : BigInt(value);
  } catch {
    return null;
  }
}

function isHexFelt(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}
