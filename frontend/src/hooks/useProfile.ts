"use client";

import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "@/lib/api/client";

export function useProfileReputation(address: string | undefined) {
  const [userRep, setUserRep] = useState<any>(null);
  const [error, setError] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setError(false);
    fetch(apiUrl(`/api/v1/zkdefi/reputation/user/${address}`))
      .then((r) => {
        if (!r.ok) {
          setError(true);
          return null;
        }
        return r.json();
      })
      .then((data) => setUserRep(data ?? null))
      .catch(() => {
        setError(true);
        setUserRep(null);
      });
  }, [address]);

  useEffect(() => {
    if (!address) {
      setUserRep(null);
      setError(false);
      return;
    }
    refetch();
  }, [address, refetch]);

  return { userRep, error, refetch };
}

export function useOnboardingStatus(address: string | undefined) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setLoading(true);
    fetch(apiUrl(`/api/v1/zkdefi/onboarding/status/${address}`))
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) {
      setStatus(null);
      return;
    }
    refetch();
  }, [address, refetch]);

  return { status, loading, refetch };
}

export function useRiskPassport(address: string | undefined) {
  const [passport, setPassport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setLoading(true);
    setError(false);
    fetch(apiUrl(`/api/v1/zkdefi/risk_passport/user/${address}`))
      .then((r) => {
        if (!r.ok) {
          setError(true);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        setPassport(data ?? null);
      })
      .catch(() => {
        setError(true);
        setPassport(null);
      })
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) {
      setPassport(null);
      setError(false);
      setLoading(false);
      return;
    }
    refetch();
  }, [address, refetch]);

  return { passport, loading, error, refetch };
}

export type LinkedAddresses = { eth?: string; arb?: string; base?: string; opt?: string };
export type LinkedDraft = { eth: string; arb: string; base: string; opt: string };

export function useLinkedAddresses(address: string | undefined) {
  const [linked, setLinked] = useState<LinkedAddresses>({});
  const [draft, setDraft] = useState<LinkedDraft>({ eth: "", arb: "", base: "", opt: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setLoading(true);
    fetch(apiUrl(`/api/v1/zkdefi/linked_addresses/${address}`))
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string>) => {
        setLinked(data);
        setDraft({
          eth: data.eth ?? "",
          arb: data.arb ?? "",
          base: data.base ?? "",
          opt: data.opt ?? "",
        });
      })
      .catch(() => {
        setLinked({});
        setDraft({ eth: "", arb: "", base: "", opt: "" });
      })
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) {
      setLinked({});
      setDraft({ eth: "", arb: "", base: "", opt: "" });
      return;
    }
    refetch();
  }, [address, refetch]);

  const save = useCallback(async () => {
    if (!address) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl("/api/v1/zkdefi/linked_addresses"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starknet_address: address,
          eth: draft.eth || undefined,
          arb: draft.arb || undefined,
          base: draft.base || undefined,
          opt: draft.opt || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLinked(data);
        setDraft({
          eth: (data as Record<string, string>).eth ?? "",
          arb: (data as Record<string, string>).arb ?? "",
          base: (data as Record<string, string>).base ?? "",
          opt: (data as Record<string, string>).opt ?? "",
        });
        return true;
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [address, draft]);

  return { linked, draft, setDraft, save, loading, saving, refetch };
}
