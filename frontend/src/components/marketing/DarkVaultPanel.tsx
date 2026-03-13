"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Lock,
  ShieldCheck,
  Eye,
  EyeOff,
  Download,
  Upload,
  Hash,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

interface VaultEntry {
  vault_id: string;
  amount_usd: number;
  privacy_level: string;
  commitment_hash: string;
  nullifier_hash: string;
  status: string;
  deposited_at: string;
  note: string;
}

interface DarkVaultPanelProps {
  walletAddress: string;
  sessionId: string;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}

/* ─── component ────────────────────────────────────────────────────── */

export function DarkVaultPanel({
  walletAddress,
  sessionId,
  onDeposit,
  onWithdraw,
}: DarkVaultPanelProps) {
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [totalShielded, setTotalShielded] = useState(0);
  const [amount, setAmount] = useState("1000");
  const [privacy, setPrivacy] = useState<"shielded" | "confidential">("shielded");
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState<string | null>(null);
  const [revealHash, setRevealHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── fetch vaults ──────────────────────────────────────────────── */

  const fetchVaults = useCallback(async () => {
    try {
      const res = await apiFetch<{
        wallet_address: string;
        vaults: VaultEntry[];
        total_shielded_usd: number;
      }>(`/api/v1/paper-trade/vault/${walletAddress}`, { timeoutMs: 10_000 });
      setVaults(res.vaults ?? []);
      setTotalShielded(res.total_shielded_usd ?? 0);
    } catch {
      /* silent */
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchVaults();
  }, [fetchVaults]);

  /* ── deposit ───────────────────────────────────────────────────── */

  const deposit = async () => {
    setError(null);
    setIsDepositing(true);
    try {
      await apiFetch("/api/v1/paper-trade/vault/deposit", {
        method: "POST",
        body: JSON.stringify({
          wallet_address: walletAddress,
          session_id: sessionId,
          amount_usd: parseFloat(amount),
          privacy_level: privacy,
          note: "",
        }),
        timeoutMs: 15_000,
      });
      onDeposit?.();
      await fetchVaults();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setIsDepositing(false);
    }
  };

  /* ── withdraw ──────────────────────────────────────────────────── */

  const withdraw = async (vaultId: string) => {
    setIsWithdrawing(vaultId);
    try {
      await apiFetch(`/api/v1/paper-trade/vault/${vaultId}/withdraw`, {
        method: "POST",
        timeoutMs: 10_000,
      });
      onWithdraw?.();
      await fetchVaults();
    } catch {
      /* silent */
    } finally {
      setIsWithdrawing(null);
    }
  };

  const activeVaults = vaults.filter((v) => v.status === "active");

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/50">
        <Lock className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-violet-400">
          Dark Vault
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-500">
          ${totalShielded.toLocaleString()} shielded
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Deposit controls */}
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
              Amount (USD)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={100}
              step={100}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-violet-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
              Privacy
            </label>
            <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
              {(["shielded", "confidential"] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setPrivacy(lvl)}
                  className={`px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                    privacy === lvl
                      ? "bg-violet-500/20 text-violet-400"
                      : "bg-zinc-900 text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  {lvl === "shielded" ? <EyeOff className="inline h-3 w-3" /> : <Lock className="inline h-3 w-3" />}
                  <span className="ml-1 capitalize">{lvl}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={deposit}
            disabled={isDepositing || !amount || parseFloat(amount) < 100}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-400 transition-all hover:border-violet-400 hover:bg-violet-500/20 disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            {isDepositing ? "…" : "Deposit"}
          </button>
        </div>

        {error && <p className="text-[10px] text-rose-400">{error}</p>}

        {/* Vault list */}
        {activeVaults.length > 0 && (
          <div className="space-y-2 pt-1">
            {activeVaults.map((v) => (
              <div
                key={v.vault_id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/40 px-3 py-2"
              >
                <ShieldCheck className="h-4 w-4 text-violet-500/60 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-300 font-semibold">
                      ${v.amount_usd.toLocaleString()}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0 text-[8px] font-medium border ${
                        v.privacy_level === "shielded"
                          ? "text-violet-400 border-violet-500/30 bg-violet-500/10"
                          : "text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-500/10"
                      }`}
                    >
                      {v.privacy_level}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    <Hash className="h-2.5 w-2.5 text-zinc-700" />
                    <button
                      onClick={() => setRevealHash(revealHash === v.vault_id ? null : v.vault_id)}
                      className="font-mono text-[8px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      {revealHash === v.vault_id ? (v.commitment_hash ?? "—") : (v.commitment_hash?.slice(0, 14) ?? "—") + "…"}
                    </button>
                    {revealHash === v.vault_id && (
                      <Eye className="h-2 w-2 text-zinc-600" />
                    )}
                  </div>
                </div>
                <button
                  onClick={() => withdraw(v.vault_id)}
                  disabled={isWithdrawing === v.vault_id}
                  className="text-[9px] text-cyan-500/60 hover:text-cyan-400 transition-colors flex items-center gap-1"
                >
                  <Upload className="h-2.5 w-2.5" />
                  {isWithdrawing === v.vault_id ? "…" : "Unshield"}
                </button>
              </div>
            ))}
          </div>
        )}

        {activeVaults.length === 0 && (
          <p className="text-center text-[10px] text-zinc-600 py-1">
            No active vaults — deposit capital to shield your positions.
          </p>
        )}
      </div>
    </div>
  );
}
