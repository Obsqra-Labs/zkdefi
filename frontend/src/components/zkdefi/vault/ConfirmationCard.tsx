"use client";

/**
 * ConfirmationCard — Rich post-transaction confirmation that replaces the
 * form content after a successful deposit or withdrawal. Shows allocation
 * breakdown, tx details, privacy info, and Merkle registration status.
 */

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Fingerprint,
  GitBranch,
  Layers,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  TreePine,
  Wallet,
} from "lucide-react";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { getTxStatus, type TxSettlementStatus } from "@/lib/pendingTx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AllocationEntry {
  protocol: string;
  pair: string;
  allocation_percent: number;
  expected_apy: number;
}

export interface ConfirmationData {
  type: "deposit" | "withdraw" | "fund";
  amount: string;
  asset: string;
  txHash?: string;
  commitmentHash?: string;
  privacyMethod?: string;
  merkleRegistered?: boolean;
  leafIndex?: number;
  merkleRoot?: string;
  /** AI strategy allocations (Fund flow) */
  allocations?: AllocationEntry[];
  expectedApy?: number;
  /** Relayer info (withdraw) */
  relayerRequestId?: string;
  recipient?: string;
}

interface ConfirmationCardProps {
  data: ConfirmationData;
  onDismiss: () => void;
  accent?: "emerald" | "violet" | "rose";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCENT_MAP = {
  emerald: {
    ring: "ring-emerald-500/30",
    bg: "from-emerald-900/30 via-zinc-900/80 to-zinc-900/80",
    icon: "bg-emerald-500",
    text: "text-emerald-400",
    button: "bg-emerald-600 hover:bg-emerald-500",
    badge: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  },
  violet: {
    ring: "ring-violet-500/30",
    bg: "from-violet-900/30 via-zinc-900/80 to-zinc-900/80",
    icon: "bg-violet-500",
    text: "text-violet-400",
    button: "bg-violet-600 hover:bg-violet-500",
    badge: "bg-violet-500/10 border-violet-500/20 text-violet-400",
  },
  rose: {
    ring: "ring-rose-500/30",
    bg: "from-rose-900/30 via-zinc-900/80 to-zinc-900/80",
    icon: "bg-rose-500",
    text: "text-rose-400",
    button: "bg-rose-600 hover:bg-rose-500",
    badge: "bg-rose-500/10 border-rose-500/20 text-rose-400",
  },
};

const PROTOCOL_COLORS: Record<string, string> = {
  Ekubo: "bg-emerald-400",
  Lending: "bg-blue-400",
  Staking: "bg-violet-400",
  Idle: "bg-zinc-500",
};

function truncate(s: string, len = 12): string {
  if (s.length <= len) return s;
  return `${s.slice(0, len)}…${s.slice(-4)}`;
}

function formatWei(wei: string): string {
  try {
    const n = Number(BigInt(wei)) / 1e18;
    return n.toFixed(4);
  } catch {
    return wei;
  }
}

const TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit Confirmed",
  withdraw: "Withdrawal Confirmed",
  fund: "Vault Funded",
};

const TX_STATUS_LABELS: Record<TxSettlementStatus, string> = {
  pending: "Submitting…",
  received: "Processing…",
  accepted: "Confirmed on L2",
  confirmed: "Confirmed on L1",
  rejected: "Rejected",
  unknown: "Checking…",
};

const TX_STATUS_COLORS: Record<TxSettlementStatus, string> = {
  pending: "text-amber-400",
  received: "text-amber-400",
  accepted: "text-emerald-400",
  confirmed: "text-emerald-400",
  rejected: "text-red-400",
  unknown: "text-zinc-400",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmationCard({
  data,
  onDismiss,
  accent = "emerald",
}: ConfirmationCardProps) {
  const c = ACCENT_MAP[accent];
  const [copied, setCopied] = React.useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Tx settlement polling — prevent the user from dismissing before the tx
  // settles, which would cause a nonce collision on the next deposit.
  // ---------------------------------------------------------------------------
  const [txStatus, setTxStatus] = React.useState<TxSettlementStatus>(
    data.txHash ? "pending" : "accepted",
  );

  React.useEffect(() => {
    if (!data.txHash) return;
    let dead = false;

    // Poll every 4 s until settled (ACCEPTED_ON_L2 / ACCEPTED_ON_L1)
    const poll = async () => {
      const s = await getTxStatus(data.txHash!);
      if (dead) return;
      setTxStatus(s);
    };

    poll(); // immediate first check
    const id = setInterval(poll, 4_000);

    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [data.txHash]);

  // Tx has settled when status >= accepted (accepted, confirmed) or rejected
  const txSettled =
    !data.txHash ||
    txStatus === "accepted" ||
    txStatus === "confirmed" ||
    txStatus === "rejected";

  // Safety-valve: enable "Done" after 120 s regardless
  const [forceEnable, setForceEnable] = React.useState(false);
  React.useEffect(() => {
    if (txSettled) return;
    const t = setTimeout(() => setForceEnable(true), 120_000);
    return () => clearTimeout(t);
  }, [txSettled]);

  const doneEnabled = txSettled || forceEnable;

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  const displayAmount =
    data.amount.length > 10 ? formatWei(data.amount) : data.amount;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-2xl border border-white/10 ring-1 ${c.ring} bg-gradient-to-b ${c.bg} p-5 flex flex-col gap-5`}
    >
      {/* ── Success header ── */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }}
          className={`w-14 h-14 rounded-full ${c.icon} flex items-center justify-center shadow-lg`}
        >
          <Check className="w-7 h-7 text-white" strokeWidth={3} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-center"
        >
          <h3 className="text-lg font-bold text-white">{TYPE_LABELS[data.type]}</h3>
          <p className="text-2xl font-semibold text-white mt-1">
            {displayAmount}{" "}
            <span className="text-base font-normal text-zinc-400">{data.asset}</span>
          </p>
        </motion.div>
      </div>

      {/* ── Allocation breakdown (Fund flow) ── */}
      {data.allocations && data.allocations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-2.5"
        >
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Layers className="w-3.5 h-3.5" />
            <span className="font-medium">AI Strategy Allocation</span>
            {data.expectedApy !== undefined && (
              <span className={`ml-auto text-xs font-semibold ${c.text}`}>
                {(data.expectedApy * 100).toFixed(1)}% APY
              </span>
            )}
          </div>

          {/* Allocation bar */}
          <div className="h-2 flex rounded-full overflow-hidden bg-zinc-800">
            {data.allocations.map((a) => (
              <div
                key={a.protocol}
                className={`${PROTOCOL_COLORS[a.protocol] ?? "bg-zinc-500"} transition-all`}
                style={{ width: `${a.allocation_percent}%` }}
              />
            ))}
          </div>

          {/* Pool rows */}
          <div className="space-y-1">
            {data.allocations.map((a) => (
              <div
                key={a.protocol}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${PROTOCOL_COLORS[a.protocol] ?? "bg-zinc-500"}`}
                  />
                  <span className="text-zinc-300">{a.pair}</span>
                  <span className="text-[10px] text-zinc-500">{a.protocol}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-400 font-mono">
                    {a.allocation_percent.toFixed(0)}%
                  </span>
                  <span className={`${c.text} font-mono`}>
                    {(a.expected_apy * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Transaction details ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-2"
      >
        {/* Tx hash + live settlement status */}
        {data.txHash && (
          <>
            <DetailRow
              icon={<ArrowUpRight className="w-3.5 h-3.5" />}
              label="Transaction"
              value={truncate(data.txHash, 14)}
              mono
              actions={
                <>
                  <button
                    onClick={() => copyToClipboard(data.txHash!, "tx")}
                    className="text-zinc-500 hover:text-zinc-300"
                    title="Copy tx hash"
                  >
                    {copied === "tx" ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  <a
                    href={sepoliaVoyagerTxUrl(data.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-zinc-300"
                    title="View on Voyager"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              }
            />
            {/* Live settlement status */}
            <AnimatePresence mode="wait">
              <motion.div
                key={txStatus}
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                className="flex items-center justify-between text-xs pl-5"
              >
                <span className="text-zinc-500">Status</span>
                <span className={`flex items-center gap-1.5 ${TX_STATUS_COLORS[txStatus]}`}>
                  {!txSettled && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {txSettled && txStatus !== "rejected" && (
                    <Check className="w-3 h-3" />
                  )}
                  {TX_STATUS_LABELS[txStatus]}
                </span>
              </motion.div>
            </AnimatePresence>
          </>
        )}

        {/* Relayer request ID */}
        {data.relayerRequestId && (
          <DetailRow
            icon={<Wallet className="w-3.5 h-3.5" />}
            label="Relayer Request"
            value={`#${data.relayerRequestId}`}
            mono
          />
        )}

        {/* Commitment hash */}
        {data.commitmentHash && (
          <DetailRow
            icon={<Fingerprint className="w-3.5 h-3.5" />}
            label="Commitment"
            value={truncate(data.commitmentHash, 14)}
            mono
            actions={
              <button
                onClick={() =>
                  copyToClipboard(data.commitmentHash!, "commit")
                }
                className="text-zinc-500 hover:text-zinc-300"
                title="Copy commitment"
              >
                {copied === "commit" ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            }
          />
        )}

        {/* Privacy method */}
        {data.privacyMethod && (
          <DetailRow
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            label="Privacy"
            value={data.privacyMethod}
          />
        )}

        {/* Merkle tree */}
        {data.merkleRegistered !== undefined && (
          <DetailRow
            icon={<TreePine className="w-3.5 h-3.5" />}
            label="Merkle Tree"
            value={
              data.merkleRegistered
                ? `Registered (leaf #${data.leafIndex ?? "?"})`
                : "Pending — will register on next block"
            }
            valueColor={data.merkleRegistered ? "text-emerald-400" : "text-amber-400"}
          />
        )}

        {/* Merkle root */}
        {data.merkleRoot && (
          <DetailRow
            icon={<GitBranch className="w-3.5 h-3.5" />}
            label="Root"
            value={truncate(data.merkleRoot, 14)}
            mono
          />
        )}

        {/* Recipient (withdraw) */}
        {data.recipient && (
          <DetailRow
            icon={<Wallet className="w-3.5 h-3.5" />}
            label="Recipient"
            value={truncate(data.recipient, 14)}
            mono
          />
        )}
      </motion.div>

      {/* ── Privacy assurance ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
        className="flex items-center gap-2 text-[11px] text-zinc-500"
      >
        <Lock className="w-3 h-3" />
        <span>
          {data.type === "withdraw"
            ? "Source commitment stays hidden — zero-knowledge verified"
            : "Your deposit is shielded — only you can withdraw with your secret"}
        </span>
      </motion.div>

      {/* ── Done button — gated by tx settlement ── */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        onClick={onDismiss}
        disabled={!doneEnabled}
        className={`w-full rounded-lg py-3 text-sm font-medium text-white transition-colors flex items-center justify-center gap-2 ${
          doneEnabled
            ? `${c.button}`
            : "bg-zinc-700 cursor-not-allowed opacity-60"
        }`}
      >
        {doneEnabled ? (
          <>
            <Sparkles className="w-4 h-4" />
            Done
          </>
        ) : (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Confirming transaction…
          </>
        )}
      </motion.button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// DetailRow sub-component
// ---------------------------------------------------------------------------

function DetailRow({
  icon,
  label,
  value,
  mono,
  valueColor,
  actions,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`${valueColor ?? "text-zinc-300"} ${mono ? "font-mono" : ""}`}
        >
          {value}
        </span>
        {actions}
      </div>
    </div>
  );
}
