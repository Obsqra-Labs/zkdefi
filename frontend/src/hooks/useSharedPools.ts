"use client";

import { useCallback, useState } from "react";
import {
  createSharedPool,
  createSharedPoolProposal,
  executeSharedPoolProposal,
  getSharedPool,
  joinSharedPool,
  updateSharedPoolEnvelope,
  updateSharedPoolMember,
} from "@/lib/api/sharedPools";
import { SharedPoolRecord } from "@/types/ekubo";

export function useSharedPools() {
  const [pool, setPool] = useState<SharedPoolRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPool = useCallback(async (sharedPoolId: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await getSharedPool(sharedPoolId);
      setPool(next);
      return next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load shared pool";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createPool = useCallback(async (request: Parameters<typeof createSharedPool>[0]) => {
    setLoading(true);
    setError(null);
    try {
      const next = await createSharedPool(request);
      setPool(next);
      return next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create shared pool";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveEnvelope = useCallback(async (sharedPoolId: string, envelope: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const next = await updateSharedPoolEnvelope(sharedPoolId, envelope);
      setPool(next);
      return next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update envelope";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const join = useCallback(async (sharedPoolId: string, request: Parameters<typeof joinSharedPool>[1]) => {
    setLoading(true);
    setError(null);
    try {
      const member = await joinSharedPool(sharedPoolId, request);
      await loadPool(sharedPoolId);
      return member;
    } finally {
      setLoading(false);
    }
  }, [loadPool]);

  const updateMember = useCallback(
    async (
      sharedPoolId: string,
      memberAddress: string,
      patch: Parameters<typeof updateSharedPoolMember>[2],
    ) => {
      setLoading(true);
      setError(null);
      try {
        const member = await updateSharedPoolMember(sharedPoolId, memberAddress, patch);
        await loadPool(sharedPoolId);
        return member;
      } finally {
        setLoading(false);
      }
    },
    [loadPool],
  );

  const propose = useCallback(async (sharedPoolId: string, request: Parameters<typeof createSharedPoolProposal>[1]) => {
    setLoading(true);
    setError(null);
    try {
      const proposal = await createSharedPoolProposal(sharedPoolId, request);
      await loadPool(sharedPoolId);
      return proposal;
    } finally {
      setLoading(false);
    }
  }, [loadPool]);

  const execute = useCallback(async (sharedPoolId: string, request: Parameters<typeof executeSharedPoolProposal>[1]) => {
    setLoading(true);
    setError(null);
    try {
      const result = await executeSharedPoolProposal(sharedPoolId, request);
      await loadPool(sharedPoolId);
      return result;
    } finally {
      setLoading(false);
    }
  }, [loadPool]);

  return {
    pool,
    loading,
    error,
    loadPool,
    createPool,
    saveEnvelope,
    join,
    updateMember,
    propose,
    execute,
  };
}
