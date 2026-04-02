"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CallData, RpcProvider } from "starknet";
import type { AccountInterface, Call, ProviderInterface } from "starknet";

/**
 * Custom hook wrapping @mistcash/sdk for privacy-preserving swaps.
 *
 * Flow: deposit tokens → MIST Chamber → withdraw to fresh address (ZK proof) → swap on Ekubo
 * The deposit→withdraw breaks the on-chain link between the user's wallet and the swap.
 *
 * We use @mistcash/sdk directly (not @mistcash/react) to avoid the React 19 peer dep.
 */

// ---------------------------------------------------------------------------
// Lazy-loaded SDK references (WASM modules loaded once on first use)
// ---------------------------------------------------------------------------

let sdkModule: typeof import("@mistcash/sdk") | null = null;
let configModule: typeof import("@mistcash/config") | null = null;
let coreInitialized = false;

async function ensureMistCore() {
  if (coreInitialized) return;
  if (!sdkModule) {
    sdkModule = await import("@mistcash/sdk");
  }
  if (!configModule) {
    configModule = await import("@mistcash/config");
  }
  await sdkModule.initCore();
  coreInitialized = true;
}

// ---------------------------------------------------------------------------
// Claiming key file download (browser)
// ---------------------------------------------------------------------------

/** Trigger a browser download of a JSON recovery file containing the claiming key. */
export function downloadClaimingKeyFile(opts: {
  claimingKey: string;
  tokenAddress: string;
  amountWei: string;
  recipientAddress: string;
  chamberAddress: string;
  depositTxHash?: string;
}) {
  const payload: Record<string, unknown> = {
    _warning: "KEEP THIS FILE PRIVATE. Anyone with the claiming key can withdraw your funds.",
    version: opts.depositTxHash ? 2 : 1,
    claimingKey: opts.claimingKey,
    tokenAddress: opts.tokenAddress,
    amountWei: opts.amountWei,
    recipientAddress: opts.recipientAddress,
    chamberAddress: opts.chamberAddress,
    createdAt: new Date().toISOString(),
  };
  if (opts.depositTxHash) {
    payload.depositTxHash = opts.depositTxHash;
    payload.depositConfirmed = true;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mist-recovery-${opts.depositTxHash ? "confirmed-" : ""}${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MistPrivacyStep =
  | "idle"
  | "initializing"
  | "approving"
  | "depositing"
  | "waiting_confirmation"
  | "generating_proof"
  | "withdrawing"
  | "ready_to_swap"
  | "complete"
  | "error";

export type MistPrivacyState = {
  /** Whether the SDK core (WASM) has been initialized */
  ready: boolean;
  /** Current step in the privacy pipeline */
  step: MistPrivacyStep;
  /** Human-readable status message */
  message: string;
  /** Whether a privacy operation is in progress */
  busy: boolean;
  /** Error message, if any */
  error: string | null;
  /** The claiming key for the current deposit (null if no active deposit) */
  claimingKey: string | null;
  /** Deposit tx hash */
  depositTxHash: string | null;
  /** Withdrawal tx hash */
  withdrawTxHash: string | null;
};

export type UseMistPrivacyReturn = MistPrivacyState & {
  /** Initialize the MIST WASM core. Call once on mount or on demand. */
  initialize: () => Promise<void>;
  /**
   * Build deposit + approval calls for the MIST Chamber.
   * Returns Call[] that the wallet should sign.
   * After deposit confirms, call `buildWithdrawCalls` with a fresh recipient.
   */
  buildDepositCalls: (
    tokenAddress: string,
    amountWei: string,
    recipientAddress: string,
  ) => Promise<{ calls: Call[]; claimingKey: string }>;
  /**
   * Execute the full deposit via account.execute().
   * Stores the claiming key for subsequent withdrawal.
   */
  executeDeposit: (
    account: AccountInterface,
    tokenAddress: string,
    amountWei: string,
    recipientAddress: string,
  ) => Promise<{ txHash: string; claimingKey: string }>;
  /**
   * Generate ZK proof and build withdrawal calls.
   * Uses the stored claiming key from the most recent deposit.
   * Returns Call[] that the recipient wallet should sign.
   */
  buildWithdrawCalls: (
    provider: ProviderInterface,
    recipientAddress: string,
    tokenAddress: string,
    amountWei: string,
    claimingKey?: string,
  ) => Promise<Call[]>;
  /**
   * Generate ZK proof and submit withdrawal via the backend relayer.
   * The relayer calls handle_zkp on MIST Chamber so the user's wallet
   * never appears on-chain (execution privacy).
   * Returns the relay tx hash once the relayer processes it.
   */
  submitWithdrawViaRelay: (
    provider: ProviderInterface,
    recipientAddress: string,
    tokenAddress: string,
    amountWei: string,
    claimingKey?: string,
  ) => Promise<string>;
  /**
   * Execute the full privacy flow: deposit → withdraw to self.
   * This breaks the on-chain link while keeping tokens in the same wallet.
   * Returns after withdrawal tx is submitted.
   */
  executePrivacyWrap: (
    account: AccountInterface,
    provider: ProviderInterface,
    tokenAddress: string,
    amountWei: string,
  ) => Promise<{ depositTxHash: string; withdrawTxHash: string }>;
  /** Reset state back to idle */
  reset: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMistPrivacy(): UseMistPrivacyReturn {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<MistPrivacyStep>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null);
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null);
  const busyRef = useRef(false);

  const busy = step !== "idle" && step !== "complete" && step !== "error" && step !== "ready_to_swap";

  // ---- Initialize ----
  const initialize = useCallback(async () => {
    if (ready) return;
    try {
      setStep("initializing");
      setMessage("Loading MIST privacy engine (WASM)...");
      await ensureMistCore();
      setReady(true);
      setStep("idle");
      setMessage("");
    } catch (err) {
      setStep("error");
      setError(`Failed to initialize MIST core: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [ready]);

  // ---- Build deposit calls (no execution) ----
  const buildDepositCalls = useCallback(
    async (
      tokenAddress: string,
      amountWei: string,
      recipientAddress: string,
    ): Promise<{ calls: Call[]; claimingKey: string }> => {
      await ensureMistCore();
      const sdk = sdkModule!;
      const config = configModule!;

      const key = sdk.generateClaimingKey();
      // The chamber expects the raw tx secret here and hashes it with the asset internally.
      const depositSecret = BigInt(sdk.txSecret(key, recipientAddress));

      const chamberAddress = config.CHAMBER_ADDR_MAINNET;

      // Use ABI-driven CallData.compile to correctly serialize u256 and struct types.
      // CallData auto-splits BigInt → {low, high} for u256 fields per the ABI.
      const erc20Cd = new CallData(config.ERC20_ABI);
      const approveCalldata = erc20Cd.compile("approve", [
        chamberAddress,
        BigInt(amountWei),
      ]);

      const chamberCd = new CallData(config.CHAMBER_ABI);
      const depositCalldata = chamberCd.compile("deposit", [
        depositSecret, // hash: u256 — raw tx secret, auto-split
        {
          amount: BigInt(amountWei), // u256 — auto-split
          addr: tokenAddress,        // ContractAddress
        },
      ]);

      const calls: Call[] = [
        // 1. Approve Chamber to spend tokens
        {
          contractAddress: tokenAddress as `0x${string}`,
          entrypoint: "approve",
          calldata: approveCalldata,
        },
        // 2. Deposit into Chamber
        {
          contractAddress: chamberAddress as `0x${string}`,
          entrypoint: "deposit",
          calldata: depositCalldata,
        },
      ];

      return { calls, claimingKey: key };
    },
    [],
  );

  // ---- Execute deposit ----
  const executeDeposit = useCallback(
    async (
      account: AccountInterface,
      tokenAddress: string,
      amountWei: string,
      recipientAddress: string,
    ): Promise<{ txHash: string; claimingKey: string }> => {
      if (busyRef.current) throw new Error("Privacy operation already in progress");
      busyRef.current = true;

      try {
        setStep("approving");
        setMessage("Building privacy deposit...");
        setError(null);

        const { calls, claimingKey: key } = await buildDepositCalls(tokenAddress, amountWei, recipientAddress);

        setStep("depositing");
        setMessage("Approve & deposit in wallet — sign the transaction...");

        const result = await account.execute(calls);
        setClaimingKey(key);
        setDepositTxHash(result.transaction_hash);

        setStep("waiting_confirmation");
        setMessage(`Deposit submitted (${result.transaction_hash.slice(0, 12)}...). Waiting for on-chain confirmation...`);

        // Poll for tx receipt — only accept SUCCEEDED
        const maxWaitMs = 90_000;
        const pollIntervalMs = 3_000;
        const startTime = Date.now();
        let confirmed = false;
        while (Date.now() - startTime < maxWaitMs) {
          try {
            const receipt = await account.getTransactionReceipt(result.transaction_hash);
            const execStatus = (receipt as any)?.execution_status;
            if (execStatus === "SUCCEEDED") {
              confirmed = true;
              break;
            }
            if (execStatus === "REVERTED") {
              const reason = (receipt as any)?.revert_reason || "unknown";
              throw new Error(`Deposit transaction reverted: ${result.transaction_hash} — ${reason}`);
            }
            if (execStatus === "REJECTED") {
              throw new Error(`Deposit rejected by sequencer: ${result.transaction_hash}`);
            }
          } catch (pollErr) {
            if (pollErr instanceof Error && (pollErr.message.includes("reverted") || pollErr.message.includes("rejected"))) throw pollErr;
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
        if (!confirmed) {
          throw new Error("Deposit confirmation timed out after 60s. The transaction may still be pending.");
        }

        setStep("ready_to_swap");
        setMessage("Deposit confirmed. Ready to generate withdrawal proof.");

        return { txHash: result.transaction_hash, claimingKey: key };
      } catch (err) {
        setStep("error");
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        busyRef.current = false;
      }
    },
    [buildDepositCalls],
  );

  // ---- Build withdraw calls (ZK proof generation) ----
  const buildWithdrawCalls = useCallback(
    async (
      provider: ProviderInterface,
      recipientAddress: string,
      tokenAddress: string,
      amountWei: string,
      overrideKey?: string,
    ): Promise<Call[]> => {
      await ensureMistCore();
      const sdk = sdkModule!;

      const key = overrideKey ?? claimingKey;
      if (!key) throw new Error("No claiming key available. Deposit first.");

      setStep("generating_proof");
      setMessage("Generating zero-knowledge withdrawal proof (this may take a few seconds)...");

      // 1. Get chamber contract — use our own RPC provider for read calls
      // to avoid CORS blocks from wallet providers (BlastAPI, etc.)
      const readProvider = new RpcProvider({
        nodeUrl: process.env.NEXT_PUBLIC_RPC_URL_MAINNET ||
          process.env.NEXT_PUBLIC_RPC_URL ||
          "/api/v1/zkdefi/starknet-rpc",
      });
      const chamber = sdk.getChamber(readProvider as any);
      console.log("[MIST] Chamber contract ready (via proxied RPC)");

      // 2. Verify the deposit exists on-chain
      // fetchTxAssets always returns {amount, addr} — check amount > 0 to detect missing deposits.
      const asset = await sdk.fetchTxAssets(chamber, key, recipientAddress);
      console.log("[MIST] fetchTxAssets result:", JSON.stringify(asset, (_k, v) => typeof v === "bigint" ? v.toString() : v));
      const assetAmount = typeof asset?.amount === "bigint" ? asset.amount : BigInt(String(asset?.amount ?? 0));

      // Derive human-readable info for error messages
      const knownTokens: Record<string, [string, number]> = {
        "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": ["ETH", 18],
        "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": ["STRK", 18],
        "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": ["USDC", 6],
      };
      const [tokenSymbol, tokenDecimals] = knownTokens[tokenAddress] ?? ["tokens", 18];
      const humanAmount = (Number(amountWei) / 10 ** tokenDecimals).toFixed(tokenDecimals <= 6 ? tokenDecimals : 6).replace(/\.?0+$/, "");

      if (!asset || assetAmount === BigInt(0)) {
        const legacyDepositSecret = sdk.txHash(key, recipientAddress, tokenAddress, amountWei);
        const legacyAssetRaw = await (chamber as any).assets_from_secret(legacyDepositSecret);
        const legacyAssetAmount = typeof legacyAssetRaw?.amount === "bigint"
          ? legacyAssetRaw.amount
          : BigInt(String(legacyAssetRaw?.amount ?? 0));
        if (legacyAssetAmount > BigInt(0)) {
          throw new Error(
            `Deposit of ${humanAmount} ${tokenSymbol} was found on-chain in a legacy chamber format created by an earlier client hashing bug. ` +
            "The chamber's public recovery methods also reject it, so it is not recoverable through the public MIST ABI.",
          );
        }
        throw new Error(
          `Deposit of ${humanAmount} ${tokenSymbol} not found on-chain. ` +
          "The original deposit transaction may have failed or was never confirmed. " +
          "Your tokens should still be in your wallet — try a new privacy swap.",
        );
      }

      // 3. Get Merkle tree state — retry up to 8 times (tree may not have indexed the deposit yet)
      // u256 may come back as BigInt or {low, high} — normalise robustly
      const toBigInt = (v: unknown): bigint => {
        if (typeof v === "bigint") return v;
        if (typeof v === "number" || typeof v === "string") return BigInt(v);
        // starknet.js typed u256 → {low: bigint|string, high: bigint|string}
        const obj = v as { low?: unknown; high?: unknown };
        if (obj && obj.low !== undefined) {
          return BigInt(obj.low as string | number | bigint) + (BigInt(obj.high as string | number | bigint) << BigInt(128));
        }
        return BigInt(String(v));
      };

      const MAX_TREE_RETRIES = 8;
      const TREE_RETRY_DELAY_MS = 5000;
      let leaves: bigint[] = [];
      let txIndex = -1;

      for (let attempt = 1; attempt <= MAX_TREE_RETRIES; attempt++) {
        const rawLeaves = await (chamber as any).tx_array();
        console.log(`[MIST] tx_array attempt ${attempt}/${MAX_TREE_RETRIES}: ${Array.isArray(rawLeaves) ? rawLeaves.length : 0} leaves`);
        leaves = (rawLeaves as unknown[]).map(toBigInt);
        txIndex = await sdk.getTxIndexInTree(
          leaves,
          key,
          recipientAddress,
          tokenAddress,
          amountWei,
        );
        console.log(`[MIST] txIndex (attempt ${attempt}):`, txIndex);
        if (txIndex >= 0) break;

        if (attempt < MAX_TREE_RETRIES) {
          setMessage(`Waiting for deposit to appear in Merkle tree (attempt ${attempt}/${MAX_TREE_RETRIES})...`);
          await new Promise((resolve) => setTimeout(resolve, TREE_RETRY_DELAY_MS));
        }
      }
      if (txIndex < 0) throw new Error(
        `Deposit of ${humanAmount} ${tokenSymbol} exists on-chain but is not in the Merkle tree yet (${leaves.length} leaves checked). ` +
        "The tree may still be updating — try the recovery option again in 30 seconds.",
      );

      // 4. Compute Merkle root + proof path
      const proofWithRoot = sdk.calculateMerkleRootAndProof(leaves, txIndex);
      const root = proofWithRoot[proofWithRoot.length - 1];
      const proof = proofWithRoot.slice(0, -1);
      console.log("[MIST] Merkle root computed, proof length:", proof.length);

      // 5. Build witness for ZK circuit
      const witness = {
        ClaimingKey: key,
        Owner: recipientAddress,
        TxAsset: { Amount: amountWei, Addr: tokenAddress },
        Withdraw: { Amount: amountWei, Addr: tokenAddress },
        MerkleRoot: root.toString(),
        MerkleProof: proof.map(String),
        Tx1Secret: sdk.txSecret(key, recipientAddress),
      };

      // 6. Generate Groth16 proof → Starknet calldata via Garaga
      console.log("[MIST] Starting Groth16 proof generation (WASM)...");
      const calldata = await sdk.full_prove(witness);
      console.log("[MIST] Proof generated, calldata length:", calldata.length);

      setMessage("Proof generated. Building withdrawal transaction...");

      const config = configModule!;
      return [
        {
          contractAddress: config.CHAMBER_ADDR_MAINNET as `0x${string}`,
          entrypoint: "handle_zkp",
          calldata: calldata.map(String),
        },
      ];
    },
    [claimingKey],
  );

  // ---- Submit withdraw via backend relayer (execution privacy) ----
  const submitWithdrawViaRelay = useCallback(
    async (
      provider: ProviderInterface,
      recipientAddress: string,
      tokenAddress: string,
      amountWei: string,
      overrideKey?: string,
    ): Promise<string> => {
      // 1. Generate the proof (same as buildWithdrawCalls)
      const calls = await buildWithdrawCalls(provider, recipientAddress, tokenAddress, amountWei, overrideKey);
      const proofCalldata = calls[0]?.calldata as string[];
      if (!proofCalldata || proofCalldata.length === 0) {
        throw new Error("Failed to generate proof calldata for relay.");
      }

      // 2. POST to relay API
      setStep("withdrawing");
      setMessage("Submitting withdrawal via privacy relayer...");

      const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${apiBase}/api/v1/zkdefi/relayer/mist/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester: recipientAddress,
          proof_calldata: proofCalldata,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Relay request failed (${res.status}): ${detail}`);
      }
      const entry = await res.json();
      const requestId = entry.request_id;
      console.log("[MIST] Relay request queued, request_id:", requestId);

      // 3. Poll for execution (relayer runner picks it up)
      setMessage("Waiting for relayer to submit on-chain (this may take a few seconds)...");
      const pollUrl = `${apiBase}/api/v1/zkdefi/relayer/mist/status/${requestId}`;
      const maxWaitMs = 120_000;
      const pollIntervalMs = 2_000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        try {
          const statusRes = await fetch(pollUrl);
          if (!statusRes.ok) continue;
          const statusData = await statusRes.json();
          if (statusData.status === "executed") {
            const txHash = statusData.tx_hash || "";
            setWithdrawTxHash(txHash);
            console.log("[MIST] Relay executed, tx_hash:", txHash);
            return txHash;
          }
          if (statusData.status === "cancelled") {
            throw new Error(`Relay request was cancelled: ${statusData.cancel_reason || "unknown reason"}`);
          }
        } catch (pollErr) {
          if (pollErr instanceof Error && pollErr.message.includes("cancelled")) throw pollErr;
          // transient error — keep polling
        }
      }
      throw new Error("Relay withdrawal timed out after 120s. The relayer may still process it.");
    },
    [buildWithdrawCalls],
  );

  // ---- Full privacy wrap: deposit → withdraw to same address ----
  const executePrivacyWrap = useCallback(
    async (
      account: AccountInterface,
      provider: ProviderInterface,
      tokenAddress: string,
      amountWei: string,
    ): Promise<{ depositTxHash: string; withdrawTxHash: string }> => {
      if (busyRef.current) throw new Error("Privacy operation already in progress");
      busyRef.current = true;

      try {
        const ownerAddress = account.address;

        // Step 1: Deposit
        setStep("approving");
        setMessage("Building privacy deposit...");
        setError(null);

        const { calls: depositCalls, claimingKey: key } = await buildDepositCalls(
          tokenAddress,
          amountWei,
          ownerAddress,
        );

        setStep("depositing");
        setMessage("Sign the deposit transaction in your wallet...");

        const depositResult = await account.execute(depositCalls);
        setClaimingKey(key);
        setDepositTxHash(depositResult.transaction_hash);

        setStep("waiting_confirmation");
        setMessage(
          `Deposit tx ${depositResult.transaction_hash.slice(0, 12)}... submitted. Waiting for on-chain confirmation...`,
        );

        // Poll for tx receipt instead of hardcoded sleep
        const maxWaitMs = 60_000;
        const pollIntervalMs = 3_000;
        const startTime = Date.now();
        let confirmed = false;
        while (Date.now() - startTime < maxWaitMs) {
          try {
            const receipt = await account.getTransactionReceipt(depositResult.transaction_hash);
            if (receipt && (receipt as any).execution_status !== "REVERTED") {
              confirmed = true;
              break;
            }
            if (receipt && (receipt as any).execution_status === "REVERTED") {
              throw new Error(`Deposit transaction reverted: ${depositResult.transaction_hash}`);
            }
          } catch (pollErr) {
            if (pollErr instanceof Error && pollErr.message.includes("reverted")) throw pollErr;
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
        if (!confirmed) {
          throw new Error("Deposit confirmation timed out after 60s. The transaction may still be pending.");
        }

        // Step 2: Withdraw with ZK proof
        const withdrawCalls = await buildWithdrawCalls(
          provider,
          ownerAddress,
          tokenAddress,
          amountWei,
          key,
        );

        setStep("withdrawing");
        setMessage("Sign the private withdrawal in your wallet...");

        const withdrawResult = await account.execute(withdrawCalls);
        setWithdrawTxHash(withdrawResult.transaction_hash);

        setStep("complete");
        setMessage(
          `Privacy wrap complete. Withdraw tx ${withdrawResult.transaction_hash.slice(0, 12)}...`,
        );

        return {
          depositTxHash: depositResult.transaction_hash,
          withdrawTxHash: withdrawResult.transaction_hash,
        };
      } catch (err) {
        setStep("error");
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        busyRef.current = false;
      }
    },
    [buildDepositCalls, buildWithdrawCalls],
  );

  // ---- Reset ----
  const reset = useCallback(() => {
    setStep("idle");
    setMessage("");
    setError(null);
    setClaimingKey(null);
    setDepositTxHash(null);
    setWithdrawTxHash(null);
    busyRef.current = false;
  }, []);

  return {
    ready,
    step,
    message,
    busy,
    error,
    claimingKey,
    depositTxHash,
    withdrawTxHash,
    initialize,
    buildDepositCalls,
    executeDeposit,
    buildWithdrawCalls,
    submitWithdrawViaRelay,
    executePrivacyWrap,
    reset,
  };
}
