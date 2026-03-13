"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Key,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Copy,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

export interface SessionKeyInfo {
  key_id: string;
  signing_key_prefix: string;
  permissions: string[];
  expires_at: number;
  ttl_seconds: number;
  status: "active" | "expired" | "revoked";
}

interface SessionWalletProps {
  walletAddress: string;
  sessionId: string;
  l3Address: string;
  /** Pre-issued key from onboard (optional). */
  initialKey?: SessionKeyInfo | null;
  onKeyIssued?: (key: SessionKeyInfo) => void;
}

/* ─── helpers ──────────────────────────────────────────────────────── */

function timeLeft(expiresAt: number): string {
  const diff = Math.max(0, expiresAt - Date.now() / 1000);
  if (diff <= 0) return "Expired";
  const m = Math.floor(diff / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(diff)}s`;
}

const PERM_LABELS: Record<string, { label: string; color: string }> = {
  paper_trade: { label: "Trade", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  snapshot: { label: "Snapshot", color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" },
  proof: { label: "Proof", color: "text-violet-400 border-violet-500/30 bg-violet-500/10" },
};

/* ─── component ────────────────────────────────────────────────────── */

export function SessionWallet({
  walletAddress,
  sessionId,
  l3Address,
  initialKey,
  onKeyIssued,
}: SessionWalletProps) {
  const [key, setKey] = useState<SessionKeyInfo | null>(initialKey ?? null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState("");

  // Countdown timer
  useEffect(() => {
    if (!key || key.status !== "active") return;
    const tick = () => setTimeRemaining(timeLeft(key.expires_at));
    tick();
    const interval = setInterval(tick, 10_000);
    return () => clearInterval(interval);
  }, [key]);

  const issueKey = useCallback(async () => {
    setIsIssuing(true);
    setError(null);
    try {
      const res = await apiFetch<SessionKeyInfo & { key_id: string }>("/api/v1/paper-trade/session-keys/issue", {
        method: "POST",
        body: JSON.stringify({
          wallet_address: walletAddress,
          session_id: sessionId,
          ttl_seconds: 3600,
          permissions: ["paper_trade", "snapshot", "proof"],
        }),
        timeoutMs: 15_000,
      });
      const newKey: SessionKeyInfo = {
        key_id: res.key_id,
        signing_key_prefix: res.signing_key_prefix,
        permissions: res.permissions,
        expires_at: res.expires_at,
        ttl_seconds: res.ttl_seconds,
        status: "active",
      };
      setKey(newKey);
      onKeyIssued?.(newKey);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to issue key");
    } finally {
      setIsIssuing(false);
    }
  }, [walletAddress, sessionId, onKeyIssued]);

  const revokeKey = useCallback(async () => {
    if (!key) return;
    try {
      await apiFetch(`/api/v1/paper-trade/session-keys/${key.key_id}`, {
        method: "DELETE",
        timeoutMs: 10_000,
      });
      setKey({ ...key, status: "revoked" });
    } catch {
      /* swallow — UI still shows revoked */
    }
  }, [key]);

  const copyKeyId = () => {
    if (!key) return;
    navigator.clipboard.writeText(key.key_id);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  };

  const isExpired = key?.status === "expired" || (key && Date.now() / 1000 > key.expires_at);
  const isRevoked = key?.status === "revoked";
  const isActive = key && !isExpired && !isRevoked;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/50">
        <Key className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
          Embedded Session Wallet
        </span>
        {isActive && (
          <span className="ml-auto flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-400">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Active
          </span>
        )}
        {isExpired && !isRevoked && (
          <span className="ml-auto flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400">
            <AlertTriangle className="h-2.5 w-2.5" />
            Expired
          </span>
        )}
        {isRevoked && (
          <span className="ml-auto flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[9px] font-medium text-rose-400">
            <XCircle className="h-2.5 w-2.5" />
            Revoked
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* No key yet — issue button */}
        {!key && (
          <div className="flex flex-col items-center gap-2 py-2">
            <p className="text-xs text-zinc-500 text-center">
              Issue a session key so paper trades, snapshots, and proofs are signed
              automatically — no wallet popups for 1 hour.
            </p>
            <button
              onClick={issueKey}
              disabled={isIssuing}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-400 transition-all hover:border-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {isIssuing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
              {isIssuing ? "Issuing…" : "Issue Session Key"}
            </button>
          </div>
        )}

        {/* Active key display */}
        {key && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {/* Key ID */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Key ID</p>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="font-mono text-[10px] text-zinc-400">{key.key_id}</span>
                  <button onClick={copyKeyId} className="text-zinc-600 hover:text-zinc-400">
                    {copiedKey ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                  </button>
                </div>
              </div>

              {/* TTL */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Time Left</p>
                <div className="mt-0.5 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-zinc-500" />
                  <span className={`font-mono text-[10px] ${isActive ? "text-emerald-400" : "text-rose-400"}`}>
                    {isExpired ? "Expired" : isRevoked ? "Revoked" : timeRemaining}
                  </span>
                </div>
              </div>

              {/* Signing key prefix */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Signing Key</p>
                <span className="font-mono text-[10px] text-zinc-500">{key.signing_key_prefix}</span>
              </div>

              {/* Permissions */}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600 mb-1">Permissions</p>
                <div className="flex flex-wrap gap-1">
                  {key.permissions.map((perm) => {
                    const meta = PERM_LABELS[perm] ?? { label: perm, color: "text-zinc-400 border-zinc-600 bg-zinc-800" };
                    return (
                      <span key={perm} className={`rounded-full border px-1.5 py-0.5 text-[8px] font-medium ${meta.color}`}>
                        {meta.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/30">
              <Shield className="h-3 w-3 text-zinc-600" />
              <span className="text-[9px] text-zinc-600 flex-1">
                Auto-signs paper actions within permissions scope
              </span>
              {isActive && (
                <button
                  onClick={revokeKey}
                  className="text-[9px] text-rose-500/60 hover:text-rose-400 transition-colors"
                >
                  Revoke
                </button>
              )}
              {!isActive && (
                <button
                  onClick={issueKey}
                  disabled={isIssuing}
                  className="text-[9px] text-amber-400/80 hover:text-amber-400 transition-colors"
                >
                  {isIssuing ? "Issuing…" : "Re-issue"}
                </button>
              )}
            </div>
          </>
        )}

        {error && (
          <p className="text-[10px] text-rose-400">{error}</p>
        )}
      </div>
    </div>
  );
}
