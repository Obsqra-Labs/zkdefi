"use client";

/**
 * useStarkId — resolve .stark names from Starknet addresses.
 *
 * Uses the starknetid.js SDK (StarknetIdNavigator) to:
 *  - getStarkName(address) -> "alice.stark" or null
 *  - getAddressFromStarkName(name) -> address or null
 */

import { useState, useEffect, useCallback } from "react";
import { StarknetIdNavigator } from "starknetid.js";
import { RpcProvider, constants } from "starknet";

const CHAIN = process.env.NEXT_PUBLIC_STARKNET_CHAIN ?? "sepolia";

function getProvider() {
  const envUrl = process.env.NEXT_PUBLIC_RPC_URL;
  if (envUrl) return new RpcProvider({ nodeUrl: envUrl });
  if (CHAIN === "mainnet") {
    return new RpcProvider({ nodeUrl: "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7" });
  }
  return new RpcProvider({ nodeUrl: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7" });
}

function getChainId(): constants.StarknetChainId {
  return CHAIN === "mainnet"
    ? constants.StarknetChainId.SN_MAIN
    : constants.StarknetChainId.SN_SEPOLIA;
}

let _navigator: StarknetIdNavigator | null = null;

function getNavigator(): StarknetIdNavigator {
  if (!_navigator) {
    _navigator = new StarknetIdNavigator(getProvider(), getChainId());
  }
  return _navigator;
}

export function useStarkName(address: string | undefined) {
  const [starkName, setStarkName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!address) {
      setStarkName(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nav = getNavigator();
      const name = await nav.getStarkName(address);
      setStarkName(name || null);
    } catch (e) {
      setStarkName(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    resolve();
  }, [resolve]);

  return { starkName, loading, error, refetch: resolve };
}

export function useStarkAddress(name: string | undefined) {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!name) {
      setAddress(null);
      return;
    }
    setLoading(true);
    const nav = getNavigator();
    nav
      .getAddressFromStarkName(name)
      .then((addr) => setAddress(addr || null))
      .catch(() => setAddress(null))
      .finally(() => setLoading(false));
  }, [name]);

  return { address, loading };
}
