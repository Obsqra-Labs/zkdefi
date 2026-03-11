"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";
import { useTokenPrices, priceOf } from "@/hooks/useTokenPrices";

export interface VaultSummary {
  loading: boolean;
  total_usd: number;
  strk_balance: number;
  eth_balance: number;
}

const DEFAULTS: VaultSummary = {
  loading: true,
  total_usd: 0,
  strk_balance: 0,
  eth_balance: 0,
};

// Sepolia token contracts
const ETH_TOKEN = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK_TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Read a single token balance via Starknet RPC balanceOf call. */
async function readOnChainBalance(
  provider: { callContract: (call: { contractAddress: string; entrypoint: string; calldata: string[] }) => Promise<string[]> },
  tokenAddress: string,
  ownerAddress: string,
): Promise<number> {
  for (const ep of ["balanceOf", "balance_of"]) {
    try {
      const result = await provider.callContract({
        contractAddress: tokenAddress,
        entrypoint: ep,
        calldata: [ownerAddress],
      });
      const low = BigInt(result[0] ?? "0");
      const high = BigInt(result[1] ?? "0");
      const total = low + high * (BigInt(2) ** BigInt(128));
      return Number(total);
    } catch {
      /* try next entrypoint */
    }
  }
  return 0;
}

/**
 * Fetch aggregate vault balances for the given address.
 *
 * Tries the V2 vault summary endpoint first, then falls back to reading
 * on-chain token balances directly via Starknet RPC.
 * 
 * Uses AbortController to cancel in-flight requests when address changes.
 */
export function useVaultSummary(address: string | undefined): VaultSummary {
  const [state, setState] = useState<VaultSummary>(DEFAULTS);
  const { prices } = useTokenPrices();

  useEffect(() => {
    if (!address) {
      setState({ ...DEFAULTS, loading: false });
      return;
    }

    const priceStrk = priceOf(prices, "STRK");
    const priceEth = priceOf(prices, "ETH");

    const ac = new AbortController();
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        // Race: try V2 API and on-chain RPC in parallel — use whichever resolves first with data
        const v2Promise = apiFetch<Record<string, unknown>>(
          `/api/v2/vault/summary/${address}`,
          { signal: ac.signal },
        ).catch(() => null);

        const rpcPromise = (async () => {
          try {
            const { RpcProvider } = await import("starknet");
            const provider = new RpcProvider({
              nodeUrl:
                process.env.NEXT_PUBLIC_RPC_URL ||
                "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7",
            });

            const [strkRaw, ethRaw] = await Promise.all([
              readOnChainBalance(provider, STRK_TOKEN, address),
              readOnChainBalance(provider, ETH_TOKEN, address),
            ]);

            const strkBal = strkRaw / 1e18;
            const ethBal = ethRaw / 1e18;
            return { strkBal, ethBal, totalUsd: strkBal * priceStrk + ethBal * priceEth };
          } catch {
            return null;
          }
        })();

        // Wait for V2 API first (quick)
        const d = await v2Promise;
        if (ac.signal.aborted) return;

        if (d && typeof d === "object") {
          const totalUsd = Number(d.total_usd ?? d.total_value_usd ?? 0);
          const strkWei = Number(d.strk_balance ?? d.strk ?? 0);
          const ethWei = Number(d.eth_balance ?? d.eth ?? 0);
          const strkBal = strkWei > 1e15 ? strkWei / 1e18 : strkWei;
          const ethBal = ethWei > 1e15 ? ethWei / 1e18 : ethWei;

          if (totalUsd > 0 || strkBal > 0 || ethBal > 0) {
            setState({
              loading: false,
              total_usd: totalUsd > 0 ? totalUsd : strkBal * priceStrk + ethBal * priceEth,
              strk_balance: strkBal,
              eth_balance: ethBal,
            });
            return;
          }
        }

        // V2 had no data — wait for RPC fallback (already running in parallel)
        const rpcResult = await rpcPromise;
        if (ac.signal.aborted) return;

        if (rpcResult) {
          setState({
            loading: false,
            total_usd: rpcResult.totalUsd,
            strk_balance: rpcResult.strkBal,
            eth_balance: rpcResult.ethBal,
          });
          return;
        }

        // Last fallback: collateral health endpoint
        const h = await apiFetch<Record<string, unknown>>(
          `/api/v1/zkdefi/collateral/health/${address}`,
          { signal: ac.signal },
        ).catch(() => null);

        if (ac.signal.aborted) return;

        if (h && typeof h === "object") {
          const strkBal = Number(h.strk_collateral_wei ?? 0) / 1e18;
          const ethBal = Number(h.eth_collateral_wei ?? 0) / 1e18;
          setState({
            loading: false,
            total_usd: Number(h.total_collateral_usd ?? 0) || (strkBal * priceStrk + ethBal * priceEth),
            strk_balance: strkBal,
            eth_balance: ethBal,
          });
          return;
        }

        setState({ ...DEFAULTS, loading: false });
      } catch {
        if (!ac.signal.aborted) setState({ ...DEFAULTS, loading: false });
      }
    })();

    return () => {
      ac.abort();
    };
  }, [address, prices]);

  return state;
}
