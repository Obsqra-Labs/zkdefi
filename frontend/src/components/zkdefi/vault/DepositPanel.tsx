"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import { motion } from "framer-motion";
import { ArrowDownToLine, ChevronDown, Clock, Coins, Loader2, Shield, TreePine, Hash, BookLock } from "lucide-react";
import type { PrivacyMethod, VaultCommitment, ProofStep } from "@/hooks/usePrivacyVault";
import { getDepositStepsForMethod } from "@/hooks/usePrivacyVault";
import { ProofStepper } from "@/components/zkdefi/vault/ProofStepper";
import { AllocationEditor } from "@/components/zkdefi/vault/AllocationEditor";
import { API_BASE } from "@/lib/api/client";
import { getOperatorAddress } from "@/lib/api/vault";
import { toastSuccess, toastError } from "@/lib/toast";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { useApp } from "@/lib/AppContext";
import { addActivityEvent } from "@/components/zkdefi/ActivityLog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRK_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const ETH_TOKEN =
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const STRKBTC_TOKEN =
  process.env.NEXT_PUBLIC_STRKBTC_ADDRESS ||
  "0x0714c3f541490e1847b77d799499ef01af7937ed0182f3b27a5b6226d993ab55";

const SHIELDED_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ||
  process.env.NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS ||
  "";

const FULL_PRIVACY_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS ||
  process.env.NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS ||
  "";

const FULL_PRIVACY_TOKEN =
  process.env.NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS || STRK_TOKEN;

const METHOD_LABELS: Record<PrivacyMethod, string> = {
  commitment_shield: "Commitment Shield",
  nullifier_set: "Nullifier Set",
  hashed_proof: "Hashed Proof",
  dark_ledger: "Dark Ledger",
};

const DEFAULT_ALLOCATION_ROWS = [
  { label: "Ekubo LP", pct: 45, color: "bg-emerald-400" },
  { label: "Lending", pct: 30, color: "bg-blue-400" },
  { label: "Staking", pct: 20, color: "bg-violet-400" },
  { label: "Idle", pct: 5, color: "bg-zinc-500" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Asset = "STRK" | "ETH" | "strkBTC";
type DepositResult = {
  commitmentHash: string;
  txHash: string;
  userSecret?: string;
  nonce?: string;
  blinding?: string;
  poolType?: number;
  leafIndex?: number;
  merkleRoot?: string;
  pathElements?: string[];
  pathIndices?: number[];
};

type SettlementReport = {
  status: string;
  methodLabel: string;
  amountLabel: string;
  txHash?: string;
  txUrl?: string;
  receiptId?: string;
  receiptUrl?: string;
  noteId?: string;
  commitmentHash?: string;
  settlementDay?: string;
  settlementEta?: string;
  ledgerSynced: boolean;
  vaultSynced: boolean;
  warnings: string[];
};

function toWei(amount: string): string {
  // Handle decimal amounts: "1.5" → "1500000000000000000"
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(18, "0").slice(0, 18);
  const raw = whole + frac;
  // Strip leading zeros but keep at least "0"
  const trimmed = raw.replace(/^0+/, "") || "0";
  return BigInt(trimmed).toString();
}

const PRIVACY_OPTIONS: { method: PrivacyMethod; label: string; icon: React.ComponentType<{ className?: string }>; short: string }[] = [
  { method: "commitment_shield", label: "Commitment Shield", icon: Shield, short: "Amount hidden via Pedersen" },
  { method: "nullifier_set", label: "Full Privacy", icon: TreePine, short: "Unlinkable withdrawals" },
  { method: "hashed_proof", label: "Hashed Proof", icon: Hash, short: "Prove claims, hide values" },
  { method: "dark_ledger", label: "Dark Ledger", icon: BookLock, short: "Off-chain, no footprint" },
];

function splitU256(wei: string): { low: string; high: string } {
  const big = BigInt(wei);
  const TWO_128 = BigInt(2) ** BigInt(128);
  return {
    low: (big % TWO_128).toString(),
    high: (big / TWO_128).toString(),
  };
}

function resolveTokenAddress(asset: Asset): string {
  if (asset === "ETH") return ETH_TOKEN;
  if (asset === "strkBTC") return STRKBTC_TOKEN;
  return STRK_TOKEN;
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DepositPanelProps {
  method: PrivacyMethod;
  setMethod: (m: PrivacyMethod) => void;
  depositSteps: ProofStep[];
  setDepositSteps: (value: React.SetStateAction<ProofStep[]>) => void;
  addCommitment: (c: VaultCommitment) => void;
  address?: string;
  isDemo?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DepositPanel({
  method,
  setMethod,
  depositSteps,
  setDepositSteps,
  addCommitment,
  address,
  isDemo,
}: DepositPanelProps) {
  const { account } = useAccount();
  const { setActivityFeed } = useApp();

  const [selectedAsset, setSelectedAsset] = useState<Asset>("STRK");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceEpoch, setBalanceEpoch] = useState(0);
  const [allocationRows, setAllocationRows] = useState(DEFAULT_ALLOCATION_ROWS);
  const [blendedApy, setBlendedApy] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [report, setReport] = useState<SettlementReport | null>(null);

  const handleMethodChange = useCallback((m: PrivacyMethod) => {
    setMethod(m);
    setDepositSteps(getDepositStepsForMethod(m));
    setPrivacyOpen(false);
  }, [setMethod, setDepositSteps]);

  useEffect(() => {
    let dead = false;
    Promise.allSettled([
      fetch(`${API_BASE}/v1/zkdefi/private-yield/vault/stats`, { signal: AbortSignal.timeout(6000) }),
      fetch(`${API_BASE}/v1/zkdefi/private-yield/yield/blended`, { signal: AbortSignal.timeout(6000) }),
    ]).then(async ([statsRes, blendedRes]) => {
      if (dead) return;
      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        const d = await statsRes.value.json();
        const ekuboPct = Number(d.ekubo_pct ?? 0);
        const lendingPct = Number(d.lending_pct ?? 0);
        const idlePct = Number(d.idle_pct ?? 0);
        const stakingPct = Math.max(0, 100 - ekuboPct - lendingPct - idlePct);
        if (ekuboPct > 0 || lendingPct > 0 || idlePct > 0) {
          const built: typeof DEFAULT_ALLOCATION_ROWS = [];
          if (ekuboPct > 0) built.push({ label: "Ekubo LP", pct: ekuboPct, color: "bg-emerald-400" });
          if (lendingPct > 0) built.push({ label: "Lending", pct: lendingPct, color: "bg-blue-400" });
          if (stakingPct > 0) built.push({ label: "Staking", pct: stakingPct, color: "bg-violet-400" });
          if (idlePct > 0) built.push({ label: "Idle", pct: idlePct, color: "bg-zinc-500" });
          if (!dead) setAllocationRows(built);
        }
      }
      if (blendedRes.status === "fulfilled" && blendedRes.value.ok) {
        const d = await blendedRes.value.json();
        const pct = d.blended_apy_pct ?? d.blended_apy ?? null;
        if (pct != null && !dead) {
          const ekuboApyBps = Number(d.ekubo_contribution?.apy_bps ?? 0);
          const lendingApyBps = Number(d.lending_contribution?.apy_bps ?? 0);
          const displayApy = Number(pct) > 0 ? Number(pct) : (ekuboApyBps + lendingApyBps) / 200;
          setBlendedApy(`${displayApy.toFixed(1)}%`);
        }
      }
    });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    if (!address || typeof window === "undefined") {
      setBalance(null);
      return;
    }
    let dead = false;
    const tokenAddr = selectedAsset === "ETH"
      ? ETH_TOKEN
      : selectedAsset === "strkBTC"
        ? STRKBTC_TOKEN
        : STRK_TOKEN;

    (async () => {
      try {
        const { RpcProvider } = await import("starknet");
        const provider = new RpcProvider({
          nodeUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7",
        });
        for (const ep of ["balanceOf", "balance_of"]) {
          try {
            const result = await provider.callContract({
              contractAddress: tokenAddr,
              entrypoint: ep,
              calldata: [address],
            });
            if (dead) return;
            const low = BigInt(result[0] ?? "0");
            const high = BigInt(result[1] ?? "0");
            const total = low + high * (BigInt(2) ** BigInt(128));
            const formatted = (Number(total) / 1e18).toFixed(4);
            setBalance(formatted);
            return;
          } catch { /* try next */ }
        }
        if (!dead) setBalance(null);
      } catch {
        if (!dead) setBalance(null);
      }
    })();

    return () => { dead = true; };
  }, [address, selectedAsset, balanceEpoch]);

  // -----------------------------------------------------------------------
  // Deposit handlers per method
  // -----------------------------------------------------------------------

  async function depositCommitmentShield(amountWei: string): Promise<DepositResult> {
    const { low: amountLow, high: amountHigh } = splitU256(amountWei);

    setDepositSteps((prev) => updateStep(prev, 0, "active", "Generating..."));
    const res = await fetch(`${API_BASE}/v1/zkdefi/shielded_deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_address: address,
        pool_type: "neutral",
        amount: amountWei,
      }),
    });
    const data = await res.json();
    if (!data.commitment) throw new Error(data.detail || "Commitment generation failed");

    const commitmentHash: string = data.commitment;
    const proofCalldata: string[] = data.proof_calldata ?? [];

    // Use commitment_felt (reduced mod Stark prime) to avoid felt252 overflow.
    // The raw BN254 commitment can exceed the Stark field prime.
    const STARK_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");
    const commitmentForChain = (BigInt(data.commitment_felt || commitmentHash) % STARK_PRIME).toString();

    const proofFelts = proofCalldata.map((p: string) => {
      const v = BigInt(p);
      return (v >= STARK_PRIME ? v % STARK_PRIME : v).toString();
    });

    setDepositSteps((prev) => updateStep(prev, 1, "active", "Sign in wallet..."));
    if (!account) throw new Error("Wallet not connected");

    // Contract sig (ConfidentialTransfer): private_deposit(commitment: felt252, amount_public: u256, proof_calldata: Span<felt252>)
    const result = await account.execute([
      {
        contractAddress: resolveTokenAddress(selectedAsset) as `0x${string}`,
        entrypoint: "approve",
        calldata: [SHIELDED_POOL_ADDRESS, amountLow, amountHigh],
      },
      {
        contractAddress: SHIELDED_POOL_ADDRESS as `0x${string}`,
        entrypoint: "private_deposit",
        calldata: [
          commitmentForChain,
          amountLow,
          amountHigh,
          proofFelts.length.toString(),
          ...proofFelts,
        ],
      },
    ]);
    const txHash = result.transaction_hash;

    setDepositSteps((prev) => updateStep(prev, 2, "done", "Confirmed"));
    return { commitmentHash, txHash };
  }

  async function depositNullifierSet(
    amountWei: string,
    poolType: number,
  ): Promise<DepositResult> {
    const { low: amountLow, high: amountHigh } = splitU256(amountWei);
    const tokenAddr = resolveTokenAddress(selectedAsset);
    const poolAddr = FULL_PRIVACY_POOL_ADDRESS;
    if (!poolAddr) throw new Error("Full Privacy Pool address not configured");

    // Step 1 – generate commitment
    setDepositSteps((prev) => updateStep(prev, 0, "active", "Generating..."));
    const res = await fetch(
      `${API_BASE}/v1/zkdefi/full_privacy/deposit/generate_commitment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          amount: amountWei,
          pool_type: poolType,
        }),
      },
    );
    const data = (await res.json()) as {
      commitment?: string;
      detail?: string;
      user_secret?: string;
      nonce?: string;
      blinding?: string;
      pool_type?: number;
    };
    if (!data.commitment) throw new Error(data.detail || "Commitment generation failed");

    const commitmentHash: string = data.commitment;
    const commitmentBig = commitmentHash.startsWith("0x")
      ? BigInt(commitmentHash)
      : BigInt("0x" + commitmentHash);
    const { low: cLow, high: cHigh } = splitU256(commitmentBig.toString());

    setDepositSteps((prev) => updateStep(prev, 1, "active", "Sign in wallet..."));
    if (!account) throw new Error("Wallet not connected");

    const calls = [
      {
        contractAddress: tokenAddr as `0x${string}`,
        entrypoint: "approve",
        calldata: [poolAddr, amountLow, amountHigh],
      },
      {
        contractAddress: poolAddr as `0x${string}`,
        entrypoint: "deposit_u256",
        calldata: [cLow, cHigh, amountLow, amountHigh],
      },
    ];

    let result: { transaction_hash: string };
    try {
      result = await account.execute(calls);
    } catch (execErr: unknown) {
      const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
      if (errMsg.includes("NonceTooOld") || errMsg.includes("nonce")) {
        await new Promise((r) => setTimeout(r, 2000));
        result = await account.execute(calls);
      } else {
        throw execErr;
      }
    }
    const txHash = result.transaction_hash;

    // Register commitment with retries
    setDepositSteps((prev) => updateStep(prev, 2, "active", "Registering in Merkle tree..."));
    const MAX_RETRIES = 3;
    let registered = false;
    let registrationPayload:
      | {
          leaf_index?: number;
          merkle_root?: string;
          path_elements?: string[];
          path_indices?: number[];
        }
      | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
        const regRes = await fetch(
          `${API_BASE}/v1/zkdefi/full_privacy/deposit/register_commitment`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commitment: commitmentHash }),
          },
        );
        if (regRes.status === 503 && attempt < MAX_RETRIES - 1) continue;
        const regData = (await regRes.json()) as {
          leaf_index?: number;
          merkle_root?: string;
          path_elements?: string[];
          path_indices?: number[];
        };
        if (regData.leaf_index !== undefined) {
          registered = true;
          registrationPayload = regData;
          break;
        }
      } catch {
        if (attempt === MAX_RETRIES - 1) break;
      }
    }

    const proofStatus: ProofStep["status"] = registered ? "done" : "error";
    const proofDetail = registered ? "Proof verified" : "Registration pending - retry later";
    setDepositSteps((prev) =>
      updateStep(prev, prev.length - 1, proofStatus, proofDetail),
    );

    return {
      commitmentHash,
      txHash,
      userSecret: data.user_secret,
      nonce: data.nonce,
      blinding: data.blinding,
      poolType: data.pool_type ?? poolType,
      leafIndex: registrationPayload?.leaf_index,
      merkleRoot: registrationPayload?.merkle_root,
      pathElements: registrationPayload?.path_elements,
      pathIndices: registrationPayload?.path_indices,
    };
  }

  async function depositDarkLedger(amountWei: string): Promise<DepositResult> {
    if (!account) throw new Error("Wallet not connected");

    const { low: amountLow, high: amountHigh } = splitU256(amountWei);

    // Step 1 — transfer tokens to operator vault wallet
    setDepositSteps((prev) => updateStep(prev, 0, "active", "Fetching vault address..."));
    const { operator_address } = await getOperatorAddress();
    if (!operator_address) throw new Error("Operator vault address not configured");

    setDepositSteps((prev) => updateStep(prev, 0, "active", "Sign transfer in wallet..."));
    const result = await account.execute([
      {
        contractAddress: resolveTokenAddress(selectedAsset) as `0x${string}`,
        entrypoint: "transfer",
        calldata: [operator_address, amountLow, amountHigh],
      },
    ]);
    const txHash = result.transaction_hash;
    setDepositSteps((prev) => updateStep(prev, 0, "done", txHash.slice(0, 12) + "..."));

    toastSuccess("Transfer sent to vault", {
      action: {
        label: "View tx",
        onClick: () => window.open(sepoliaVoyagerTxUrl(txHash), "_blank"),
      },
    });

    return { commitmentHash: txHash, txHash };
  }

  async function syncDepositRecord(
    amountWei: string,
    result: DepositResult,
  ): Promise<{
    commitmentHash: string;
    ledger: Record<string, unknown> | null;
    ledgerError: string | null;
    vaultSynced: boolean;
    vaultError: string | null;
  }> {
    let ledger: Record<string, unknown> | null = null;
    let ledgerError: string | null = null;
    let vaultSynced = false;
    let vaultError: string | null = null;

    try {
      if (method === "dark_ledger") {
        setDepositSteps((prev) => updateStep(prev, 1, "active", "Syncing ledger..."));
      }
      const res = await fetch(`${API_BASE}/v1/zkdefi/ledger/transfer_in/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          tx_hash: result.txHash,
          amount_wei: amountWei,
          asset: selectedAsset,
          capital_source: method === "dark_ledger" ? "wallet_mode" : "private_capital",
          method,
          commitment_hash: result.commitmentHash,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || "Failed to record deposit in ledger");
      }
      ledger = data;
      if (method === "dark_ledger") {
        setDepositSteps((prev) => updateStep(prev, 1, "done", "Verified"));
        const credited = Number(data?.amount_wei || 0) / 1e18;
        setDepositSteps((prev) =>
          updateStep(prev, 2, "done", `Credited ${credited.toFixed(4)} ${selectedAsset}`),
        );
      } else {
        setDepositSteps((prev) =>
          updateStep(prev, prev.length - 1, "done", "Confirmed + backend synced"),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ledgerError = msg;
      if (method === "dark_ledger") {
        setDepositSteps((prev) => markError(prev, 1));
      }
    }

    try {
      const res = await fetch(`${API_BASE}/v1/zkdefi/private-yield/deposit/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitment: (ledger?.commitment_hash as string) || result.commitmentHash,
          amount_wei: amountWei,
          user_address: address,
        }),
      });
      if (res.ok) {
        vaultSynced = true;
      } else {
        const data = await res.json().catch(() => ({}));
        vaultError = String(data?.detail || "Vault position sync failed");
      }
    } catch (err: unknown) {
      vaultError = err instanceof Error ? err.message : String(err);
    }

    const commitmentHash = String(
      (ledger?.commitment_hash as string) || result.commitmentHash,
    );
    return { commitmentHash, ledger, ledgerError, vaultSynced, vaultError };
  }

  // -----------------------------------------------------------------------
  // Main handler
  // -----------------------------------------------------------------------

  async function handleDeposit() {
    if (!amount || parseFloat(amount) <= 0) return;
    setBusy(true);
    setReport(null);

    try {
      const amountWei = toWei(amount);
      let result: DepositResult = { commitmentHash: "", txHash: "" };

      switch (method) {
        case "commitment_shield":
          result = await depositCommitmentShield(amountWei);
          break;
        case "nullifier_set":
          result = await depositNullifierSet(amountWei, 0);
          break;
        case "hashed_proof":
          result = await depositNullifierSet(amountWei, 2);
          break;
        case "dark_ledger":
          result = await depositDarkLedger(amountWei);
          break;
      }

      const sync = await syncDepositRecord(amountWei, result);
      const commitmentHash = sync.commitmentHash || result.commitmentHash;

      addCommitment({
        id: crypto.randomUUID(),
        method,
        asset: selectedAsset,
        amount_wei: toWei(amount),
        commitment_hash: commitmentHash,
        // Legacy compatibility fields:
        secret: result.userSecret,
        nullifier: result.nonce,
        // Canonical withdraw-proof fields:
        user_secret: result.userSecret,
        nonce: result.nonce,
        blinding: result.blinding,
        pool_type: result.poolType,
        merkle_index: result.leafIndex,
        merkle_root: result.merkleRoot,
        path_elements: result.pathElements,
        path_indices: result.pathIndices,
        deposited_at: new Date().toISOString(),
      });

      const receiptId = String(sync.ledger?.receipt_id || "");
      const receiptPath = String(sync.ledger?.receipt_url || "");
      setReport({
        status: sync.ledger ? "Recorded" : "Pending backend sync",
        methodLabel: METHOD_LABELS[method],
        amountLabel: `${amount} ${selectedAsset}`,
        txHash: result.txHash,
        txUrl: result.txHash ? sepoliaVoyagerTxUrl(result.txHash) : undefined,
        receiptId: receiptId || undefined,
        receiptUrl: receiptPath ? `${API_BASE}${receiptPath}` : undefined,
        noteId: String(sync.ledger?.note_id || "") || undefined,
        commitmentHash,
        settlementDay: String(sync.ledger?.settlement_day_utc || "") || undefined,
        settlementEta: String(sync.ledger?.settlement_eta || "") || undefined,
        ledgerSynced: Boolean(sync.ledger),
        vaultSynced: sync.vaultSynced,
        warnings: [sync.ledgerError, sync.vaultError].filter(
          (w): w is string => Boolean(w),
        ),
      });

      if (sync.ledgerError || sync.vaultError) {
        toastError(
          `Deposit submitted but backend sync is partial: ${[sync.ledgerError, sync.vaultError]
            .filter(Boolean)
            .join(" | ")}`,
        );
      }

      addActivityEvent(setActivityFeed, {
        type: "deposit",
        pool: method === "dark_ledger" ? "dark_ledger" : method === "commitment_shield" ? "shielded" : "full_privacy",
        text: `Deposited ${amount} ${selectedAsset} via ${METHOD_LABELS[method]}`,
        txHash: result.txHash,
      });

      toastSuccess(`Deposit of ${amount} ${selectedAsset} submitted`, {
        action: {
          label: "View tx",
          onClick: () =>
            window.open(sepoliaVoyagerTxUrl(result.txHash), "_blank"),
        },
      });

      setAmount("");
      setTimeout(() => setBalanceEpoch((e) => e + 1), 5000);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : String(err);
      toastError(`Deposit failed: ${msg}`);

      setDepositSteps((prev) => {
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

  const canSubmit = !busy && !!amount && parseFloat(amount) > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="min-h-[400px] rounded-2xl border border-white/10 bg-gradient-to-b from-emerald-900/20 via-slate-900/50 to-slate-900/50 p-5 flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowDownToLine className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">Deposit</h3>
        </div>
      </div>

      {/* Privacy method toggle */}
      <div className="relative">
        <button
          onClick={() => setPrivacyOpen((o) => !o)}
          className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white hover:border-emerald-500/30 transition-colors"
        >
          <span className="flex items-center gap-2">
            {(() => { const opt = PRIVACY_OPTIONS.find((o) => o.method === method); if (!opt) return null; const Icon = opt.icon; return <><Icon className="w-4 h-4 text-emerald-400" /><span>{opt.label}</span><span className="text-white/40 text-xs ml-1">— {opt.short}</span></>; })()}
          </span>
          <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${privacyOpen ? "rotate-180" : ""}`} />
        </button>
        {privacyOpen && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-white/10 bg-slate-900 shadow-xl overflow-hidden">
            {PRIVACY_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = opt.method === method;
              return (
                <button
                  key={opt.method}
                  onClick={() => handleMethodChange(opt.method)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${active ? "bg-emerald-600/20 text-emerald-300" : "text-white/70 hover:bg-white/[0.06] hover:text-white"}`}
                >
                  <Icon className={`w-4 h-4 ${active ? "text-emerald-400" : "text-white/40"}`} />
                  <span>{opt.label}</span>
                  <span className="text-white/30 text-xs ml-auto">{opt.short}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Asset selector */}
      <div className="flex items-center gap-2">
        <Coins className="w-4 h-4 text-white/40" />
        <div className="flex rounded-lg border border-white/10 overflow-hidden text-sm">
          {(["STRK", "ETH", "strkBTC"] as Asset[]).map((a) => (
            <button
              key={a}
              onClick={() => setSelectedAsset(a)}
              className={`px-3 py-1 transition-colors ${
                selectedAsset === a
                  ? "bg-emerald-600/30 text-emerald-300"
                  : "bg-white/[0.03] text-white/50 hover:text-white/70"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Amount input */}
      <div>
        <div className="relative">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 pr-16 text-white text-lg placeholder:text-white/20 focus:outline-none focus:border-emerald-500/40"
          />
          <button
            onClick={() => { if (balance) setAmount(balance); }}
            disabled={!balance}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded border border-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            MAX
          </button>
        </div>
        <p className="mt-1 text-xs text-white/30">
          Balance: {balance !== null ? `${balance} ${selectedAsset}` : `-- ${selectedAsset}`}
        </p>
      </div>

      {/* Dark ledger info callout */}
      {method === "dark_ledger" && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-300/80">
          Tokens transfer directly to the operator vault. The system verifies the
          on-chain receipt and credits your off-chain Dark Ledger balance automatically.
        </div>
      )}

      {/* Allocation preview */}
      <AllocationEditor amount={amount} asset={selectedAsset} isDemo={isDemo} address={address} />

      {/* Proof stepper */}
      <ProofStepper steps={depositSteps} />

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
          <span className="text-zinc-300">Commitment + Pedersen hash + Merkle insert</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Privacy</span>
          <span className="text-emerald-400">Amount and wallet concealed on-chain</span>
        </div>
      </div>

      {report && (
        <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/10 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-emerald-300">Confirmation Report</span>
            <span className="text-emerald-200">{report.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-300">
            <span className="text-zinc-500">Method</span>
            <span>{report.methodLabel}</span>
            <span className="text-zinc-500">Amount</span>
            <span>{report.amountLabel}</span>
            <span className="text-zinc-500">Settlement Day (UTC)</span>
            <span>{report.settlementDay || "--"}</span>
            <span className="text-zinc-500">Ledger Sync</span>
            <span>{report.ledgerSynced ? "yes" : "pending"}</span>
            <span className="text-zinc-500">Vault Sync</span>
            <span>{report.vaultSynced ? "yes" : "pending"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {report.txUrl && (
              <a
                href={report.txUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-emerald-500/30 px-2 py-1 text-emerald-300 hover:bg-emerald-500/10"
              >
                Tx
              </a>
            )}
            {report.receiptUrl && (
              <a
                href={report.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-cyan-500/30 px-2 py-1 text-cyan-300 hover:bg-cyan-500/10"
              >
                Receipt
              </a>
            )}
          </div>
          {report.commitmentHash && (
            <p className="font-mono text-[11px] text-zinc-400 break-all">
              commitment: {report.commitmentHash}
            </p>
          )}
          {report.warnings.length > 0 && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
              {report.warnings.join(" | ")}
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      <button
        disabled={!canSubmit}
        onClick={handleDeposit}
        className={`mt-auto w-full rounded-lg py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
          canSubmit
            ? "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-500 hover:to-emerald-600 shadow-lg shadow-emerald-900/30"
            : "bg-white/[0.06] text-white/30 cursor-not-allowed"
        }`}
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          "Deposit with Privacy"
        )}
      </button>
    </motion.div>
  );
}
