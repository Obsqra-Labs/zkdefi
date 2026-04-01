"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
      const commitment = sdk.txHash(key, recipientAddress, tokenAddress, amountWei);

      const chamberAddress = config.CHAMBER_ADDR_MAINNET;

      // Chamber.deposit(hash: u256, asset: Asset{amount: u256, addr: ContractAddress})
      // u256 is serialized as two felt252s: [low_128, high_128]
      const MASK_128 = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
      const commitmentBig = BigInt(commitment);
      const hashLow = (commitmentBig & MASK_128).toString();
      const hashHigh = (commitmentBig >> BigInt(128)).toString();
      const amountBig = BigInt(amountWei);
      const amountLow = (amountBig & MASK_128).toString();
      const amountHigh = (amountBig >> BigInt(128)).toString();

      const calls: Call[] = [
        // 1. Approve Chamber to spend tokens
        {
          contractAddress: tokenAddress as `0x${string}`,
          entrypoint: "approve",
          calldata: [chamberAddress, amountLow, amountHigh],
        },
        // 2. Deposit into Chamber
        {
          contractAddress: chamberAddress as `0x${string}`,
          entrypoint: "deposit",
          calldata: [
            hashLow,
            hashHigh,
            amountLow,
            amountHigh,
            tokenAddress,
          ],
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

        // Poll for tx receipt instead of hardcoded sleep
        const maxWaitMs = 60_000;
        const pollIntervalMs = 3_000;
        const startTime = Date.now();
        let confirmed = false;
        while (Date.now() - startTime < maxWaitMs) {
          try {
            // Use starknet.js provider to check tx status
            const receipt = await account.getTransactionReceipt(result.transaction_hash);
            if (receipt && (receipt as any).execution_status !== "REVERTED") {
              confirmed = true;
              break;
            }
            if (receipt && (receipt as any).execution_status === "REVERTED") {
              throw new Error(`Deposit transaction reverted: ${result.transaction_hash}`);
            }
          } catch (pollErr) {
            // getTransactionReceipt throws if tx not found yet — keep polling
            if (pollErr instanceof Error && pollErr.message.includes("reverted")) throw pollErr;
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

      // 1. Get chamber contract
      const chamber = sdk.getChamber(provider as any);

      // 2. Verify the deposit exists
      const asset = await sdk.fetchTxAssets(chamber, key, recipientAddress);
      if (!asset) throw new Error("Deposit not found in MIST Chamber. It may not be confirmed yet.");

      // 3. Get Merkle tree state
      const rawLeaves = await (chamber as any).tx_array();
      const leaves: bigint[] = (rawLeaves as unknown[]).map((l) => BigInt(l as string | number | bigint));
      const txIndex = await sdk.getTxIndexInTree(
        leaves,
        key,
        recipientAddress,
        tokenAddress,
        amountWei,
      );

      // 4. Compute Merkle root + proof path
      const [root, ...proof] = sdk.calculateMerkleRootAndProof(leaves, txIndex);

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
      const calldata = await sdk.full_prove(witness);

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
    executePrivacyWrap,
    reset,
  };
}
