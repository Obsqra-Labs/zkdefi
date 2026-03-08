"use client";

import React, { useEffect, useState } from "react";
import { useAccount } from "@starknet-react/core";
import { motion } from "framer-motion";
import { ArrowUpFromLine, Clock, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import type {
  PrivacyMethod,
  VaultCommitment,
  ProofStep,
} from "@/hooks/usePrivacyVault";
import { ProofStepper } from "@/components/zkdefi/vault/ProofStepper";
import { API_BASE } from "@/lib/api/client";
import { toastSuccess, toastError } from "@/lib/toast";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { useApp } from "@/lib/AppContext";
import { addActivityEvent } from "@/components/zkdefi/ActivityLog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHIELDED_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ||
  process.env.NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS ||
  "";

const FULL_PRIVACY_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS ||
  process.env.NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS ||
  "";

const METHOD_LABELS: Record<PrivacyMethod, string> = {
  commitment_shield: "Commitment Shield",
  nullifier_set: "Nullifier Set",
  hashed_proof: "Hashed Proof",
  dark_ledger: "Dark Ledger",
};

const METHOD_PILL_COLORS: Record<PrivacyMethod, string> = {
  commitment_shield:
    "bg-violet-500/15 text-violet-300 border-violet-500/25",
  nullifier_set:
    "bg-orange-500/15 text-orange-300 border-orange-500/25",
  hashed_proof:
    "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25",
  dark_ledger:
    "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 7) return `${Math.floor(days / 7)}w ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h ago`;
  return "just now";
}

function formatAmount(weiStr: string): string {
  const big = BigInt(weiStr || "0");
  const whole = big / BigInt(1e18.toString());
  const frac = big % BigInt(1e18.toString());
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fracStr}`;
}

function splitU256(wei: string): { low: string; high: string } {
  const big = BigInt(wei);
  const TWO_128 = BigInt(2) ** BigInt(128);
  return {
    low: (big % TWO_128).toString(),
    high: (big / TWO_128).toString(),
  };
}

function updateStep(
  steps: ProofStep[],
  index: number,
  status: ProofStep["status"],
  detail?: string,
): ProofStep[] {
  return steps.map((s, i) => {
    if (i < index) return { ...s, status: "done" };
    if (i === index) return { ...s, status, detail };
    return s;
  });
}

function markError(steps: ProofStep[], failedIndex: number): ProofStep[] {
  return steps.map((s, i) => {
    if (i < failedIndex) return { ...s, status: "done" };
    if (i === failedIndex) return { ...s, status: "error" };
    return s;
  });
}

function extractApiErrorMessage(data: unknown, fallback: string): string {
  if (
    data &&
    typeof data === "object" &&
    "detail" in data &&
    Array.isArray((data as { detail?: unknown }).detail)
  ) {
    const details = (data as { detail: Array<{ msg?: string }> }).detail
      .map((d) => d?.msg)
      .filter((msg): msg is string => typeof msg === "string" && msg.length > 0);
    if (details.length > 0) return details.join(", ");
  }
  if (
    data &&
    typeof data === "object" &&
    "detail" in data &&
    typeof (data as { detail?: unknown }).detail === "string"
  ) {
    return (data as { detail: string }).detail;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WithdrawPanelProps {
  method: PrivacyMethod;
  setMethod: (m: PrivacyMethod) => void;
  commitments: VaultCommitment[];
  removeCommitment: (id: string) => void;
  withdrawSteps: ProofStep[];
  setWithdrawSteps: (value: React.SetStateAction<ProofStep[]>) => void;
  address?: string;
  selectedCommitmentId?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WithdrawPanel({
  method,
  setMethod,
  commitments,
  removeCommitment,
  withdrawSteps,
  setWithdrawSteps,
  address,
  selectedCommitmentId,
}: WithdrawPanelProps) {
  const { account } = useAccount();
  const { setActivityFeed } = useApp();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [useRelayer, setUseRelayer] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [userTier, setUserTier] = useState<number>(-1);
  const [busy, setBusy] = useState(false);

  // Auto-select commitment from prop
  useEffect(() => {
    if (selectedCommitmentId) {
      setSelectedId(selectedCommitmentId);
      const c = commitments.find((cm) => cm.id === selectedCommitmentId);
      if (c) {
        setMethod(c.method);
        if (c.method === "commitment_shield") {
          setAmount(formatAmount(c.amount_wei));
        }
      }
    }
  }, [selectedCommitmentId, commitments, setMethod]);

  // Fetch reputation tier
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/zkdefi/reputation/user/${address}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUserTier(data.tier ?? 0);
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const selectedCommitment = commitments.find((c) => c.id === selectedId);

  function needsProofMetadata(c: VaultCommitment): boolean {
    if (c.method === "commitment_shield" || c.method === "dark_ledger") return false;
    const s = c.user_secret ?? c.secret;
    const n = c.nonce ?? c.nullifier;
    return !s || !n || !c.blinding;
  }

  const selectedIsStale = selectedCommitment ? needsProofMetadata(selectedCommitment) : false;

  function handleSelectCommitment(c: VaultCommitment) {
    setSelectedId(c.id);
    setMethod(c.method);
    if (c.method === "commitment_shield") {
      setAmount(formatAmount(c.amount_wei));
    } else {
      setAmount("");
    }
    setUseRelayer(false);
    setRecipientAddress("");
  }

  function handleFull() {
    if (!selectedCommitment) return;
    setAmount(formatAmount(selectedCommitment.amount_wei));
  }

  // -----------------------------------------------------------------------
  // Withdraw handlers
  // -----------------------------------------------------------------------

  async function withdrawCommitmentShield(
    commitment: VaultCommitment,
    amountWei: string,
  ) {
    const { low: amountLow, high: amountHigh } = splitU256(amountWei);

    setWithdrawSteps((prev) => updateStep(prev, 0, "active", "Verifying..."));
    const res = await fetch(`${API_BASE}/api/v1/zkdefi/shielded_withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_address: address,
        commitment: commitment.commitment_hash,
        amount: amountWei,
        use_relayer: useRelayer,
        recipient: useRelayer && recipientAddress ? recipientAddress : address,
      }),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.detail || "Shielded withdraw proof failed");

    const proofCalldata: string[] = data.proof_calldata ?? [];
    const proofFelts = proofCalldata.map((p: string) => BigInt(p).toString());

    const parseFelt = (v: string) => BigInt(v.startsWith("0x") ? v : "0x" + v);

    const nullifierFelt = parseFelt(data.nullifier).toString();

    const commitFeltRaw = data.commitment_felt || data.commitment || commitment.commitment_hash;
    const commitmentFelt = parseFelt(commitFeltRaw).toString();

    const recipient = data.recipient || address;

    setWithdrawSteps((prev) =>
      updateStep(prev, 1, "active", "Sign in wallet..."),
    );
    if (!account) throw new Error("Wallet not connected");

    const entrypoint = useRelayer
      ? "request_relayed_withdraw"
      : "private_withdraw";

    const result = await account.execute([
      {
        contractAddress: SHIELDED_POOL_ADDRESS as `0x${string}`,
        entrypoint,
        calldata: [
          nullifierFelt,
          commitmentFelt,
          amountLow,
          amountHigh,
          proofFelts.length.toString(),
          ...proofFelts,
          recipient!,
        ],
      },
    ]);
    const txHash = result.transaction_hash;

    setWithdrawSteps((prev) => updateStep(prev, 2, "done", "Confirmed"));
    return txHash;
  }

  async function withdrawNullifierSet(
    commitment: VaultCommitment,
    amountWei: string,
    isPartial: boolean,
  ) {
    const poolAddr = FULL_PRIVACY_POOL_ADDRESS;
    if (!poolAddr)
      throw new Error("Full Privacy Pool address not configured");

    setWithdrawSteps((prev) =>
      updateStep(prev, 0, "active", "Verifying commitment..."),
    );

    const endpoint = isPartial
      ? `${API_BASE}/api/v1/zkdefi/full_privacy/withdraw/generate_proof_with_change`
      : `${API_BASE}/api/v1/zkdefi/full_privacy/withdraw/generate_proof`;

    setWithdrawSteps((prev) =>
      updateStep(prev, 1, "active", "Generating nullifier..."),
    );

    const userSecret = commitment.user_secret ?? commitment.secret;
    const nonce = commitment.nonce ?? commitment.nullifier;
    const blinding = commitment.blinding;
    const poolType =
      typeof commitment.pool_type === "number"
        ? commitment.pool_type
        : method === "hashed_proof"
          ? 2
          : 0;

    if (!userSecret || !nonce || !blinding) {
      throw new Error(
        "Missing commitment proof metadata (secret/nonce/blinding). Deposit again to create a withdrawable commitment.",
      );
    }

    if (!address) {
      throw new Error("Wallet not connected. Please connect your wallet to withdraw.");
    }

    if (!commitment.amount_wei) {
      throw new Error("Commitment amount missing. Select a valid deposit commitment.");
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_secret: userSecret,
        amount: commitment.amount_wei,
        pool_type: poolType,
        nonce,
        blinding,
        withdraw_amount: amountWei,
        recipient: useRelayer && recipientAddress ? recipientAddress : address,
        leaf_index:
          typeof commitment.merkle_index === "number"
            ? commitment.merkle_index
            : -1,
        merkle_root: commitment.merkle_root,
        path_elements: commitment.path_elements,
        path_indices: commitment.path_indices,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(extractApiErrorMessage(data, "Proof generation failed"));
    }

    const proofCalldata: string[] = data.proof_calldata ?? [];
    const proofFelts = proofCalldata.map((p: string) => BigInt(p).toString());

    const parseFelt = (v: string) => BigInt(v.startsWith("0x") ? v : "0x" + v);

    let nullLow: string, nullHigh: string;
    if (data.nullifier_low && data.nullifier_high) {
      nullLow = BigInt(data.nullifier_low).toString();
      nullHigh = BigInt(data.nullifier_high).toString();
    } else {
      const n = parseFelt(data.nullifier);
      ({ low: nullLow, high: nullHigh } = splitU256(n.toString()));
    }

    let rootLow: string, rootHigh: string;
    if (data.root_low && data.root_high) {
      rootLow = BigInt(data.root_low).toString();
      rootHigh = BigInt(data.root_high).toString();
    } else {
      const r = parseFelt(data.root);
      ({ low: rootLow, high: rootHigh } = splitU256(r.toString()));
    }

    const { low: wAmtLow, high: wAmtHigh } = splitU256(amountWei);

    if (useRelayer) {
      setWithdrawSteps((prev) =>
        updateStep(prev, 2, "active", "Queuing via relayer..."),
      );

      const relayData = await queueRelayerWithdraw(
        nullLow,
        nullHigh,
        rootLow,
        rootHigh,
        poolType,
        proofFelts,
      );

      setWithdrawSteps((prev) =>
        updateStep(prev, 3, "done", `Queued (relay #${relayData.request_id})`),
      );
      return relayData.request_id?.toString() || "";
    } else {
      setWithdrawSteps((prev) =>
        updateStep(prev, 2, "active", "Sign in wallet..."),
      );
      if (!account) throw new Error("Wallet not connected");

      let calldata: string[];
      let entrypoint: string;

      if (isPartial && data.change_commitment_low && data.change_commitment_high) {
        const changeLow = BigInt(data.change_commitment_low).toString();
        const changeHigh = BigInt(data.change_commitment_high).toString();
        const changeAmt = BigInt(data.change_amount ?? 0);
        const { low: caLow, high: caHigh } = splitU256(changeAmt.toString());

        entrypoint = "withdraw_with_change_u256";
        calldata = [
          nullLow, nullHigh,
          rootLow, rootHigh,
          address!,
          wAmtLow, wAmtHigh,
          poolType.toString(),
          changeLow, changeHigh,
          caLow, caHigh,
          proofFelts.length.toString(),
          ...proofFelts,
        ];
      } else {
        entrypoint = "withdraw_u256";
        calldata = [
          nullLow, nullHigh,
          rootLow, rootHigh,
          address!,
          wAmtLow, wAmtHigh,
          poolType.toString(),
          proofFelts.length.toString(),
          ...proofFelts,
        ];
      }

      const result = await account.execute([
        {
          contractAddress: poolAddr as `0x${string}`,
          entrypoint,
          calldata,
        },
      ]);
      const txHash = result.transaction_hash;

      setWithdrawSteps((prev) => updateStep(prev, 3, "done", "Confirmed"));
      return txHash;
    }
  }

  async function queueRelayerWithdraw(
    nullLow: string,
    nullHigh: string,
    rootLow: string,
    rootHigh: string,
    poolType: number,
    proofFelts: string[],
  ) {
    const res = await fetch(`${API_BASE}/api/v1/zkdefi/relayer/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: address,
        nullifier_low: nullLow,
        nullifier_high: nullHigh,
        root_low: rootLow,
        root_high: rootHigh,
        pool_type: poolType,
        proof_calldata: proofFelts,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Relayer queue failed");
    }
    return data;
  }

  async function withdrawDarkLedger(amountWei: string, asset: string) {
    if (!address) throw new Error("Wallet not connected");

    setWithdrawSteps((prev) =>
      updateStep(prev, 0, "active", "Queuing withdrawal..."),
    );

    const res = await fetch(`${API_BASE}/api/v1/zkdefi/ledger/transfer_out/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_address: address,
        amount_wei: amountWei,
        asset,
        capital_source: "private_capital",
        destination_mode: "wallet",
      }),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.detail || "Ledger transfer-out failed");

    setWithdrawSteps((prev) => updateStep(prev, 1, "done", `Queued (request #${data.request_id ?? ""})`));
    return data.receipt_id || "";
  }

  // -----------------------------------------------------------------------
  // Main handler
  // -----------------------------------------------------------------------

  async function handleWithdraw() {
    if (!selectedCommitment || !amount || parseFloat(amount) <= 0) return;
    setBusy(true);

    try {
      const amountWei = (
        BigInt(Math.floor(parseFloat(amount))) * BigInt(1e18.toString())
      ).toString();

      let txHash: string;

      const isFullAmount =
        formatAmount(selectedCommitment.amount_wei) === amount;

      switch (method) {
        case "commitment_shield":
          txHash = await withdrawCommitmentShield(
            selectedCommitment,
            selectedCommitment.amount_wei,
          );
          break;
        case "nullifier_set":
          txHash = await withdrawNullifierSet(
            selectedCommitment,
            amountWei,
            !isFullAmount,
          );
          break;
        case "hashed_proof":
          txHash = await withdrawNullifierSet(
            selectedCommitment,
            amountWei,
            !isFullAmount,
          );
          break;
        case "dark_ledger":
          txHash = await withdrawDarkLedger(
            amountWei,
            selectedCommitment.asset,
          );
          break;
      }

      removeCommitment(selectedCommitment.id);

      const isRelayed = useRelayer && (method === "nullifier_set" || method === "hashed_proof");

      addActivityEvent(setActivityFeed, {
        type: "withdraw",
        pool:
          method === "dark_ledger" ? "dark_ledger" : method === "commitment_shield" ? "shielded" : "full_privacy",
        text: isRelayed
          ? `Queued relayed withdrawal of ${amount} ${selectedCommitment!.asset} via ${METHOD_LABELS[method]}`
          : `Withdrew ${amount} ${selectedCommitment!.asset} via ${METHOD_LABELS[method]}`,
        txHash: isRelayed ? undefined : txHash,
      });

      if (isRelayed) {
        toastSuccess(
          `Withdrawal queued via relayer (request #${txHash})`,
          {
            action: {
              label: "Check status",
              onClick: () =>
                window.open(
                  `${API_BASE}/api/v1/zkdefi/relayer/request/${txHash}`,
                  "_blank",
                ),
            },
          },
        );
      } else if (txHash) {
        toastSuccess(
          `Withdrawal of ${amount} ${selectedCommitment!.asset} submitted`,
          {
            action: {
              label: "View tx",
              onClick: () =>
                window.open(sepoliaVoyagerTxUrl(txHash), "_blank"),
            },
          },
        );
      }

      setSelectedId(null);
      setAmount("");
      setUseRelayer(false);
      setRecipientAddress("");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : String(err);
      toastError(`Withdraw failed: ${msg}`);

      setWithdrawSteps((prev) => {
        const failedIdx = prev.findIndex((s) => s.status === "active");
        return failedIdx >= 0 ? markError(prev, failedIdx) : prev;
      });
    } finally {
      setBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const isFullOnly = method === "commitment_shield";
  const canSubmit =
    !busy &&
    !!selectedCommitment &&
    !selectedIsStale &&
    !!amount &&
    parseFloat(amount) > 0 &&
    (!useRelayer || /^0x[0-9a-fA-F]{50,64}$/.test(recipientAddress));

  return (
    <motion.div
      id="withdraw-panel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="min-h-[400px] rounded-2xl border border-white/10 bg-gradient-to-b from-rose-900/20 via-slate-900/50 to-slate-900/50 p-5 flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowUpFromLine className="w-5 h-5 text-rose-400" />
          <h3 className="text-lg font-semibold text-white">Withdraw</h3>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-300">
          {METHOD_LABELS[method]}
        </span>
      </div>

      {/* Commitment picker */}
      <div className="space-y-1.5">
        <label className="text-xs text-white/50 font-medium">
          Select Position
        </label>

        {commitments.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-white/30">
              No positions yet. Deposit to get started.
            </p>
          </div>
        ) : (
          <div className="max-h-[200px] overflow-y-auto space-y-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-2">
            {commitments.map((c) => {
              const isSelected = selectedId === c.id;
              const stale = needsProofMetadata(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelectCommitment(c)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors flex items-center gap-3 ${
                    isSelected
                      ? "bg-rose-500/10 border border-rose-500/30"
                      : stale
                        ? "bg-amber-500/5 border border-amber-500/15 opacity-60"
                        : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04] hover:border-white/10"
                  }`}
                >
                  {/* Radio indicator */}
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      isSelected
                        ? "border-rose-400"
                        : stale
                          ? "border-amber-500/40"
                          : "border-white/20"
                    }`}
                  >
                    {isSelected && !stale && (
                      <div className="w-2 h-2 rounded-full bg-rose-400" />
                    )}
                    {stale && (
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${stale ? "text-white/50" : "text-white"}`}>
                        {formatAmount(c.amount_wei)} {c.asset}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${METHOD_PILL_COLORS[c.method]}`}
                      >
                        {METHOD_LABELS[c.method]}
                      </span>
                      {stale && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
                          No proof data
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-white/30 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeAgo(c.deposited_at)}
                      </span>
                      {c.yield_accrued && (
                        <span className="text-[11px] text-emerald-400">
                          +{c.yield_accrued} yield
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Stale commitment warning */}
      {selectedIsStale && selectedCommitment && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200/80">
              This position was deposited before proof metadata was tracked.
              The ZK preimage (secret, nonce, blinding) is required to generate
              a withdrawal proof. You need to deposit again to create a
              withdrawable commitment.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              removeCommitment(selectedCommitment.id);
              setSelectedId(null);
              toastSuccess("Stale position removed from list");
            }}
            className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Remove from list
          </button>
        </div>
      )}

      {/* Amount input */}
      <div>
        <label className="text-xs text-white/50 font-medium mb-1 block">
          Amount
        </label>
        {isFullOnly && selectedCommitment ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-white text-lg">
            <span>{formatAmount(selectedCommitment.amount_wei)}</span>
            <span className="ml-2 text-sm text-white/30">
              {selectedCommitment.asset}
            </span>
            <p className="text-xs text-white/30 mt-1">
              Full withdrawal only
            </p>
          </div>
        ) : (
          <div className="relative">
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!selectedCommitment}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 pr-16 text-white text-lg placeholder:text-white/20 focus:outline-none focus:border-rose-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleFull}
              disabled={!selectedCommitment}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded border border-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              FULL
            </button>
          </div>
        )}
      </div>

      {/* Relayer toggle */}
      {userTier >= 1 && (method === "nullifier_set" || method === "hashed_proof") && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useRelayer}
              onChange={(e) => setUseRelayer(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/[0.05] text-rose-500 focus:ring-rose-500/30 accent-rose-500"
            />
            <span className="text-sm text-white/70">
              Use relayer (hides your address from withdraw tx)
            </span>
          </label>

          {useRelayer && (
            <div>
              <label className="text-xs text-white/40 mb-1 block">
                Destination address
              </label>
              <input
                type="text"
                placeholder="0x..."
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-rose-500/40"
              />
              <p className="text-[11px] text-emerald-400/80 leading-relaxed mt-1.5">
                A separate relayer wallet submits the withdrawal transaction.
                Your depositing address will not appear on the withdraw tx.
                The recipient is cryptographically bound in the ZK proof.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Proof stepper */}
      <ProofStepper steps={withdrawSteps} />

      {/* Proof generation info */}
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400 space-y-1">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-zinc-500" />
            Proof generation
          </span>
          <span className="text-zinc-300">~10-15s (Groth16)</span>
        </div>
        <div className="flex items-center justify-between">
          <span>What happens</span>
          <span className="text-zinc-300">Nullifier reveal + Merkle proof + balance verify</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Privacy</span>
          <span className="text-emerald-400">Source commitment stays hidden</span>
        </div>
      </div>

      {/* Submit */}
      <button
        disabled={!canSubmit}
        onClick={handleWithdraw}
        className={`mt-auto w-full rounded-lg py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
          canSubmit
            ? "bg-gradient-to-r from-rose-600 to-rose-700 text-white hover:from-rose-500 hover:to-rose-600 shadow-lg shadow-rose-900/30"
            : "bg-white/[0.06] text-white/30 cursor-not-allowed"
        }`}
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          "Withdraw Privately"
        )}
      </button>
    </motion.div>
  );
}
