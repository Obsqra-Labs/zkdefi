import type { SignalResult } from "../types";
import { StarknetRPC } from "../rpc-client";
import contracts from "../../../config/mainnet-contracts.json";
import selectors from "../../../config/event-selectors.json";

export interface ProtocolBreadth {
  categories: string[];
  count: number;
}

export async function getProtocolBreadth(
  rpc: StarknetRPC,
  wallet: string
): Promise<SignalResult<ProtocolBreadth>> {
  const latestBlock = await rpc.getBlockNumber();
  const lookbackBlocks = Number.parseInt(process.env.ACTIVITY_LOOKBACK_BLOCKS ?? "50000", 10);
  const fromBlock = Math.max(0, latestBlock - lookbackBlocks);
  const startRequests = rpc.getRequestCount();

  const walletNormalized = normalizeAddress(wallet);
  if (!walletNormalized) {
    return {
      value: { categories: [], count: 0 },
      source: "invalid_wallet_address",
      blockRange: [fromBlock, latestBlock],
      requestCount: rpc.getRequestCount() - startRequests,
    };
  }

  const categories = new Set<string>();

  // Bridge: match deposits into wallet from StarkGate contracts.
  const bridgeEvents = await countWalletMatches(rpc, {
    address: getAddress("starkgate_eth_bridge"),
    selector: getSelector("starkgate_eth_bridge", "deposit"),
    fromBlock,
    toBlock: latestBlock,
    matchesWallet: (data) => normalizeAddress(data[1]) === walletNormalized,
  });
  if (bridgeEvents > 0) categories.add("bridge");

  // DEX: any Ekubo swap where wallet appears in caller-ish fields.
  const dexEvents = await countWalletMatches(rpc, {
    address: getAddress("ekubo_core"),
    selector: getSelector("ekubo_core", "swap"),
    fromBlock,
    toBlock: latestBlock,
    matchesWallet: (data) => data.some((felt) => normalizeAddress(felt) === walletNormalized),
  });
  if (dexEvents > 0) categories.add("dex");

  // Lending: Vesu supply/liquidation user participation.
  const lendingSupplyEvents = await countWalletMatches(rpc, {
    address: getAddress("vesu_core"),
    selector: getSelector("vesu_core", "supply"),
    fromBlock,
    toBlock: latestBlock,
    matchesWallet: (data) => normalizeAddress(data[0]) === walletNormalized,
  });
  const lendingLiquidationEvents = await countWalletMatches(rpc, {
    address: getAddress("vesu_core"),
    selector: getSelector("vesu_core", "liquidation"),
    fromBlock,
    toBlock: latestBlock,
    matchesWallet: (data) => normalizeAddress(data[0]) === walletNormalized || normalizeAddress(data[1]) === walletNormalized,
  });
  if (lendingSupplyEvents + lendingLiquidationEvents > 0) categories.add("lending");

  return {
    value: { categories: Array.from(categories), count: categories.size },
    source: "starknet_getEvents_activity_scan",
    blockRange: [fromBlock, latestBlock],
    requestCount: rpc.getRequestCount() - startRequests,
  };
}

async function countWalletMatches(
  rpc: StarknetRPC,
  opts: {
    address?: string;
    selector?: string;
    fromBlock: number;
    toBlock: number;
    matchesWallet: (data: string[]) => boolean;
  }
): Promise<number> {
  if (!opts.address) {
    return 0;
  }

  let count = 0;
  const keys = isHexFelt(opts.selector) ? [[opts.selector]] : undefined;
  for await (const page of rpc.getEvents({
    address: opts.address,
    from_block: { block_number: opts.fromBlock },
    to_block: { block_number: opts.toBlock },
    keys,
  })) {
    for (const event of page) {
      const data = getEventData(event);
      if (data.length > 0 && opts.matchesWallet(data)) {
        count += 1;
      }
    }
  }
  return count;
}

function getAddress(contractName: "starkgate_eth_bridge" | "ekubo_core" | "vesu_core"): string | undefined {
  const entry = (contracts as Record<string, { address?: string }>)[contractName];
  return isHexFelt(entry?.address) ? entry.address : undefined;
}

function getSelector(contractName: string, eventName: string): string | undefined {
  const contractEntry = (selectors as Record<string, Record<string, { selector?: string }>>)[contractName];
  const selector = contractEntry?.[eventName]?.selector;
  return isHexFelt(selector) ? selector : undefined;
}

function getEventData(event: unknown): string[] {
  if (!event || typeof event !== "object") {
    return [];
  }
  const data = (event as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter((value): value is string => typeof value === "string");
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return null;
  }
}

function isHexFelt(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}
