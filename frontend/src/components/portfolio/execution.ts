"use client";

import type { Call } from "starknet";

import type { ExecutionResponse, SupportedAsset } from "./types";

const ASSET_DECIMALS: Record<SupportedAsset, number> = {
  ETH: 18,
  STRK: 18,
  USDC: 6,
};

const MAINNET_TOKEN_BY_SYMBOL: Record<SupportedAsset, `0x${string}`> = {
  ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
};

export function fromWei(amountWei: number, asset: SupportedAsset): number {
  if (!Number.isFinite(amountWei) || amountWei <= 0) return 0;
  return amountWei / 10 ** ASSET_DECIMALS[asset];
}

export function minSwapAmountForAsset(asset: SupportedAsset): number {
  switch (asset) {
    case "ETH":
      return 0.00001;
    case "STRK":
      return 0.1;
    case "USDC":
      return 1;
    default:
      return 0.00001;
  }
}

export function toWei(amount: string, asset: SupportedAsset): number {
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 10 ** ASSET_DECIMALS[asset]);
}

function splitUint256(value: bigint): [string, string] {
  const one = BigInt(1);
  const bitWidth = BigInt(128);
  const mask = (one << bitWidth) - one;
  return [(value & mask).toString(), (value >> bitWidth).toString()];
}

function uint256ToBigInt(low?: string, high?: string): bigint {
  const lowPart = BigInt(low ?? "0");
  const highPart = BigInt(high ?? "0");
  return lowPart + (highPart << BigInt(128));
}

function buildApproveCall(asset: SupportedAsset, routerAddress: string, amountWei: bigint): Call {
  const [amountLow, amountHigh] = splitUint256(amountWei);
  return {
    contractAddress: MAINNET_TOKEN_BY_SYMBOL[asset],
    entrypoint: "approve",
    calldata: [routerAddress, amountLow, amountHigh],
  };
}

function mergeApproveCalls(calls: Call[]): Call[] {
  const approvals = new Map<string, { asset: SupportedAsset; router: string; amountWei: bigint }>();
  const approvalOrder: string[] = [];
  const others: Call[] = [];

  for (const call of calls) {
    if (call.entrypoint !== "approve") {
      others.push(call);
      continue;
    }
    const calldata = Array.isArray(call.calldata) ? call.calldata.map(String) : [];
    const router = String(calldata[0] ?? "");
    const amountWei = uint256ToBigInt(String(calldata[1] ?? "0"), String(calldata[2] ?? "0"));
    const asset = (Object.entries(MAINNET_TOKEN_BY_SYMBOL).find(([, address]) => address === call.contractAddress)?.[0] ??
      null) as SupportedAsset | null;
    if (!router || amountWei <= BigInt(0) || !asset) {
      others.push(call);
      continue;
    }
    const key = `${asset}:${router}`;
    const current = approvals.get(key);
    if (!current) {
      approvals.set(key, { asset, router, amountWei });
      approvalOrder.push(key);
      continue;
    }
    approvals.set(key, { ...current, amountWei: current.amountWei + amountWei });
  }

  const mergedApprovals = approvalOrder.map((key) => {
    const approval = approvals.get(key)!;
    return buildApproveCall(approval.asset, approval.router, approval.amountWei);
  });

  return [...mergedApprovals, ...others];
}

export function buildWalletCallsFromExecution(payload: ExecutionResponse): { calls: Call[]; error?: string } {
  if (payload.wallet_calls?.length) {
    return {
      calls: payload.wallet_calls.map((call) => ({
        contractAddress: call.contract_address as `0x${string}`,
        entrypoint: call.entrypoint,
        calldata: call.calldata.map(String),
      })),
    };
  }

  if (payload.calldata?.contract_address && payload.calldata.entrypoint && payload.calldata.calldata?.length) {
    const step = payload.gate.swap_steps[0];
    if (!step) {
      return { calls: [], error: "Prepared swap payload is missing the underlying step." };
    }
    const routerAddress = payload.calldata.contract_address as `0x${string}`;
    return {
      calls: [
        buildApproveCall(step.from_asset, routerAddress, BigInt(step.amount_wei)),
        {
          contractAddress: routerAddress,
          entrypoint: payload.calldata.entrypoint,
          calldata: payload.calldata.calldata.map(String),
        },
      ],
    };
  }

  if (!payload.prepared_calls?.length) {
    return { calls: [], error: "Execution preview did not include prepared wallet calls." };
  }

  const directWalletCalls = payload.prepared_calls.flatMap((item) =>
    (item.wallet_calls ?? []).map((call) => ({
      contractAddress: call.contract_address as `0x${string}`,
      entrypoint: call.entrypoint,
      calldata: call.calldata.map(String),
    })),
  );
  if (directWalletCalls.length) {
    const errored = payload.prepared_calls.find((item) => item.status === "error");
    if (errored) {
      return {
        calls: [],
        error: errored.error ?? errored.calldata?.error ?? "Prepared rebalance contains invalid steps.",
      };
    }
    return { calls: directWalletCalls };
  }

  const readyCalls = payload.prepared_calls.filter(
    (item) =>
      item.status === "ready" &&
      item.calldata?.contract_address &&
      item.calldata.entrypoint &&
      item.calldata.calldata?.length,
  );
  if (!readyCalls.length) {
    return { calls: [], error: payload.warning ?? "Prepared rebalance contains no executable swap calls." };
  }
  if (readyCalls.length !== payload.prepared_calls.length) {
    return { calls: [], error: "Prepared rebalance contains invalid steps. Review the gate output first." };
  }

  const approvals = new Map<string, { asset: SupportedAsset; router: `0x${string}`; amountWei: bigint }>();
  const swapCalls: Call[] = [];

  for (const item of readyCalls) {
    const call = item.calldata!;
    const routerAddress = call.contract_address as `0x${string}`;
    const approvalKey = `${item.step.from_asset}:${routerAddress}`;
    const current = approvals.get(approvalKey);
    approvals.set(approvalKey, {
      asset: item.step.from_asset,
      router: routerAddress,
      amountWei: (current?.amountWei ?? BigInt(0)) + BigInt(item.step.amount_wei),
    });
    swapCalls.push({
      contractAddress: routerAddress,
      entrypoint: call.entrypoint!,
      calldata: call.calldata!.map(String),
    });
  }

  const approvalCalls = Array.from(approvals.values()).map((approval) =>
    buildApproveCall(approval.asset, approval.router, approval.amountWei),
  );

  return {
    calls: [...approvalCalls, ...swapCalls],
  };
}

async function readAllowanceWei(
  tokenAddress: `0x${string}`,
  ownerAddress: string,
  spenderAddress: string,
  rpcUrl?: string,
): Promise<bigint> {
  const { RpcProvider } = await import("starknet");
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  for (const entrypoint of ["allowance", "allowance_of"]) {
    try {
      const result = await provider.callContract({
        contractAddress: tokenAddress,
        entrypoint,
        calldata: [ownerAddress, spenderAddress],
      });
      return uint256ToBigInt(result[0], result[1]);
    } catch {
      continue;
    }
  }
  return BigInt(0);
}

export async function optimizeWalletCallsForExecution(
  calls: Call[],
  ownerAddress: string,
  rpcUrl?: string,
): Promise<{ calls: Call[]; skippedApprovals: number }> {
  const mergedCalls = mergeApproveCalls(calls);
  const optimized: Call[] = [];
  let skippedApprovals = 0;

  for (const call of mergedCalls) {
    if (call.entrypoint !== "approve") {
      optimized.push(call);
      continue;
    }
    const calldata = Array.isArray(call.calldata) ? call.calldata.map(String) : [];
    const spender = String(calldata[0] ?? "");
    const required = uint256ToBigInt(String(calldata[1] ?? "0"), String(calldata[2] ?? "0"));
    if (!spender || required <= BigInt(0) || !rpcUrl) {
      optimized.push(call);
      continue;
    }
    try {
      const allowance = await readAllowanceWei(call.contractAddress as `0x${string}`, ownerAddress, spender, rpcUrl);
      if (allowance >= required) {
        skippedApprovals += 1;
        continue;
      }
    } catch {
      // Keep the approve call if allowance lookup fails.
    }
    optimized.push(call);
  }

  return { calls: optimized, skippedApprovals };
}

export function extractExecutionError(payload: ExecutionResponse): string | null {
  if (payload.error) return payload.error;
  if (payload.calldata?.error) return payload.calldata.error;
  const preparedError = payload.prepared_calls?.find((item) => item.error || item.calldata?.error);
  if (preparedError?.error) return preparedError.error;
  if (preparedError?.calldata?.error) return preparedError.calldata.error;
  return null;
}
