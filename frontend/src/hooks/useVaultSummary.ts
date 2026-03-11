"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";

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

// Current approximate prices (updated 2026-03-11)
const PRICE_STRK = 0.04;
const PRICE_ETH = 2020;

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
 */
export function useVaultSummary(address: string | undefined): VaultSummary {
  const [state, setState] = useState<VaultSummary>(DEFAULTS);

  useEffect(() => {
    if (!address) {
      setState({ ...DEFAULTS, loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      try {
        // Try V2 vault summary first
        const d = await apiFetch<Record<string, unknown>>(
          `/api/v2/vault/summary/${address}`,
        ).catch(() => null);

        if (cancelled) return;

        if (d && typeof d === "object") {
          const totalUsd = Number(d.total_usd ?? d.total_value_usd ?? 0);
          const strkWei = Number(d.strk_balance ?? d.strk ?? 0);
          const ethWei = Number(d.eth_balance ?? d.eth ?? 0);
          const strkBal = strkWei > 1e15 ? strkWei / 1e18 : strkWei; // handle both wei and human
          const ethBal = ethWei > 1e15 ? ethWei / 1e18 : ethWei;

          if (totalUsd > 0 || strkBal > 0 || ethBal > 0) {
            setState({
              loading: false,
              total_usd: totalUsd > 0 ? totalUsd : strkBal * PRICE_STRK + ethBal * PRICE_ETH,
              strk_balance: strkBal,
              eth_balance: ethBal,
            });
            return;
          }
        }

        // Fallback: read on-chain balances directly via Starknet RPC
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

          if (cancelled) return;

          const strkBal = strkRaw / 1e18;
          const ethBal = ethRaw / 1e18;
          const totalUsd = strkBal * PRICE_STRK + ethBal * PRICE_ETH;

          setState({
            loading: false,
            total_usd: totalUsd,
            strk_balance: strkBal,
            eth_balance: ethBal,
          });
          return;
        } catch {
          /* RPC fallback failed, try collateral endpoint */
        }

        // Last fallback: collateral health endpoint
        const h = await apiFetch<Record<string, unknown>>(
          `/api/v1/zkdefi/collateral/health/${address}`,
        ).catch(() => null);

        if (cancelled) return;

        if (h && typeof h === "object") {
          const strkBal = Number(h.strk_collateral_wei ?? 0) / 1e18;
          const ethBal = Number(h.eth_collateral_wei ?? 0) / 1e18;
          setState({
            loading: false,
            total_usd: Number(h.total_collateral_usd ?? 0) || (strkBal * PRICE_STRK + ethBal * PRICE_ETH),
            strk_balance: strkBal,
            eth_balance: ethBal,
          });
          return;
        }

        setState({ ...DEFAULTS, loading: false });
      } catch {
        if (!cancelled) setState({ ...DEFAULTS, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return state;
}
