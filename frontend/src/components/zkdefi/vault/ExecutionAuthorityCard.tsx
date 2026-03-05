"use client";

import { useState, useEffect } from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { useVaultController } from "@/hooks/useVaultController";
import { apiFetch } from "@/lib/api/client";
import type { SessionKeyListResponse } from "@/types/ekubo";

export interface ExecutionAuthorityCardProps {
  address: string | undefined;
}

function daysUntilExpiry(expiresAt: string): number {
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  return Math.max(0, Math.ceil((exp - now) / (24 * 60 * 60 * 1000)));
}

export function ExecutionAuthorityCard({ address }: ExecutionAuthorityCardProps) {
  const { vaultState, loading: vaultLoading } = useVaultController(address);
  const [sessionData, setSessionData] = useState<SessionKeyListResponse | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const fetchSession = (addr: string) => {
    setSessionLoading(true);
    setSessionError(false);
    apiFetch<SessionKeyListResponse>(`/api/v1/zkdefi/session_keys/list/${addr}`)
      .then((data) => {
        setSessionData(data);
      })
      .catch(() => {
        setSessionData(null);
        setSessionError(true);
      })
      .finally(() => {
        setSessionLoading(false);
      });
  };

  useEffect(() => {
    if (!address) {
      setSessionData(null);
      setSessionLoading(false);
      setSessionError(false);
      return;
    }
    fetchSession(address);
  }, [address]);

  const sessionActive = sessionData?.sessions?.some(
    (s) => s.is_active && !s.is_expired
  ) ?? false;
  const earliestExpiry = sessionData?.sessions
    ?.filter((s) => s.is_active && !s.is_expired
      && new Date(s.expires_at).getTime() > Date.now())
    ?.map((s) => s.expires_at)
    ?.sort()[0];
  const daysLeft = earliestExpiry ? daysUntilExpiry(earliestExpiry) : null;

  const vaultLabel = (() => {
    switch (vaultState) {
      case "ACTIVE":
        return { label: "Active", color: "bg-emerald-500" };
      case "PAUSED":
      case "COOLDOWN":
      case "PENDING_REBALANCE":
        return { label: "Paused", color: "bg-amber-500" };
      case "EMERGENCY":
        return { label: "Emergency", color: "bg-rose-500" };
      default:
        return { label: "Active", color: "bg-emerald-500" };
    }
  })();

  const loading = vaultLoading || (!!address && sessionLoading);

  // No wallet connected
  if (!address) {
    return (
      <div
        className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-all duration-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
      >
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-blue-400" aria-hidden="true" />
          <h3 className="text-base font-semibold text-white">Execution Authority</h3>
        </div>
        <p className="text-sm text-zinc-500 text-center py-4">Connect your wallet to view execution authority status.</p>
      </div>
    );
  }

  // Loading skeleton
  if (loading) {
    return (
      <div
        className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
        aria-busy="true"
        aria-label="Loading execution authority"
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 bg-zinc-700 rounded animate-pulse" />
          <div className="h-5 w-40 bg-zinc-700 rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-2 w-2 bg-zinc-700 rounded-full animate-pulse" />
              <div className="h-4 w-24 bg-zinc-700 rounded animate-pulse" />
              <div className="h-4 w-20 bg-zinc-700 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-all duration-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
      aria-label="Execution authority status"
    >
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-5 h-5 text-blue-400" aria-hidden="true" />
        <h3 className="text-base font-semibold text-white">Execution Authority</h3>
      </div>

      <div className="space-y-3">
        {/* Session Key */}
        {sessionError ? (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span className="text-sm text-amber-400">Session key check failed</span>
            <button
              type="button"
              onClick={() => address && fetchSession(address)}
              className="text-xs text-amber-300 underline underline-offset-2 hover:text-white transition-colors ml-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              aria-label="Retry session key check"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                sessionActive ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-label={sessionActive ? "Session key enabled" : "Session key disabled"}
            />
            <span className="text-sm text-zinc-400">Session Key:</span>
            <span className="text-sm text-white">
              {sessionActive
                ? daysLeft != null
                  ? `Enabled (expires in ${daysLeft}d)`
                  : "Enabled"
                : "Disabled"}
            </span>
          </div>
        )}

        {/* Vault Controller */}
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${vaultLabel.color}`}
            aria-label={`Vault controller: ${vaultLabel.label}`}
          />
          <span className="text-sm text-zinc-400">Vault Controller:</span>
          <span className="text-sm text-white">{vaultLabel.label}</span>
        </div>

        {/* Admin Breaker */}
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-zinc-500"
            aria-label="Admin breaker: Multisig 3/5"
          />
          <span className="text-sm text-zinc-400">Admin Breaker:</span>
          <span className="text-sm text-white">
            Multisig 3/5 (emergency-only)
          </span>
        </div>

        {/* Relayer */}
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
            aria-label="Relayer: Enabled"
          />
          <span className="text-sm text-zinc-400">Relayer:</span>
          <span className="text-sm text-white">
            Enabled (shielded withdrawals)
          </span>
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Only the vault controller can deploy your capital. You control all boundaries.
      </p>
    </div>
  );
}
