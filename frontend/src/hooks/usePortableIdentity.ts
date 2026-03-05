"use client";

/**
 * usePortableIdentity — React hook for ERC-8004 portable agent identity.
 *
 * Fetches and caches the portable identity bundle for the connected
 * address. Used by the Identity surface and Brain surface for
 * displaying agent card, reputation, and disclosures.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getPortableIdentity,
  type ERC8004PortableIdentity,
} from "@/lib/identity/erc8004";

export function usePortableIdentity(address: string | undefined) {
  const [identity, setIdentity] = useState<ERC8004PortableIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setIdentity(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getPortableIdentity(address);
      setIdentity(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load identity");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { identity, loading, error, refresh };
}
