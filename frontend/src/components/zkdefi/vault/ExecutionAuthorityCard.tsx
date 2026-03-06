"use client";

import { useState, useEffect } from "react";
import { ShieldCheck } from "lucide-react";
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

  useEffect(() => {
    if (!address) {
      setSessionData(null);
      setSessionLoading(false);
      return;
    }
    let dead = false;
    setSessionLoading(true);
    apiFetch<SessionKeyListResponse>(`/api/v1/zkdefi/session_keys/list/${address}`)
      .then((data) => {
        if (!dead) setSessionData(data);
      })
      .catch(() => {
        if (!dead) setSessionData(null);
      })
      .finally(() => {
        if (!dead) setSessionLoading(false);
      });
    return () => { dead = true; };
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

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-5 h-5 text-blue-400" />
        <h3 className="text-base font-semibold text-white">Execution Authority</h3>
      </div>

      <div className="space-y-3">
        {/* Session Key */}
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              loading
                ? "bg-zinc-600 animate-pulse"
                : sessionActive
                  ? "bg-emerald-500"
                  : "bg-rose-500"
            }`}
          />
          <span className="text-sm text-zinc-400">Session Key:</span>
          <span className="text-sm text-white">
            {loading
              ? "--"
              : sessionActive
                ? daysLeft != null
                  ? `Enabled (expires in ${daysLeft}d)`
                  : "Enabled"
                : "Disabled"}
          </span>
        </div>

        {/* Vault Controller */}
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              loading ? "bg-zinc-600 animate-pulse" : vaultLabel.color
            }`}
          />
          <span className="text-sm text-zinc-400">Vault Controller:</span>
          <span className="text-sm text-white">
            {loading ? "--" : vaultLabel.label}
          </span>
        </div>

        {/* Admin Breaker */}
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-500" />
          <span className="text-sm text-zinc-400">Admin Breaker:</span>
          <span className="text-sm text-white">
            Multisig 3/5 (emergency-only)
          </span>
        </div>

        {/* Relayer */}
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
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
