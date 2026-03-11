/**
 * pendingTx — Shared pending-transaction tracker.
 *
 * Prevents nonce collisions when the user makes rapid sequential deposits
 * on Starknet Sepolia where block times are ~30-60 seconds. After a
 * successful `account.execute()`, call `setPendingTx(hash)`. Before the
 * next `account.execute()`, call `waitForPendingTx()`.
 *
 * The ConfirmationCard also uses `getTxStatus()` to poll live settlement
 * status so the user sees the tx progress.
 */

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _pendingTxHash: string | null = null;

export function setPendingTx(hash: string | null) {
  _pendingTxHash = hash;
}

export function getPendingTx(): string | null {
  return _pendingTxHash;
}

// ---------------------------------------------------------------------------
// Tx status polling (for ConfirmationCard)
// ---------------------------------------------------------------------------

export type TxSettlementStatus =
  | "pending"     // tx submitted but not yet seen by sequencer
  | "received"    // sequencer received / processing
  | "accepted"    // accepted on L2
  | "confirmed"   // accepted on L1
  | "rejected"    // tx rejected
  | "unknown";    // couldn't determine

/**
 * One-shot status check for a tx hash. Light-weight; call in a setInterval.
 */
export async function getTxStatus(txHash: string): Promise<TxSettlementStatus> {
  try {
    const { RpcProvider } = await import("starknet");
    const provider = new RpcProvider({ nodeUrl: RPC_URL });
    const status = await provider.getTransactionStatus(txHash);

    const finality = (status.finality_status ?? "") as string;
    const execution = (status.execution_status ?? "") as string;

    if (finality === "REJECTED" || execution === "REJECTED" || execution === "REVERTED") {
      return "rejected";
    }
    if (finality === "ACCEPTED_ON_L1") return "confirmed";
    if (finality === "ACCEPTED_ON_L2") return "accepted";
    if (finality === "RECEIVED") return "received";
    return "pending";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Wait-for-pending (safety guard before executing a new tx)
// ---------------------------------------------------------------------------

/**
 * If there's a pending tx, wait for it to reach at least ACCEPTED_ON_L2.
 * Falls through silently after `timeoutMs` so the user is never stuck.
 *
 * @param progressCb  Optional callback with status text for the stepper.
 */
export async function waitForPendingTx(
  timeoutMs = 120_000,
  progressCb?: (msg: string) => void,
): Promise<void> {
  const hash = _pendingTxHash;
  if (!hash) return;

  progressCb?.("Waiting for previous tx to settle…");

  try {
    const { RpcProvider } = await import("starknet");
    const provider = new RpcProvider({ nodeUrl: RPC_URL });

    await Promise.race([
      provider.waitForTransaction(hash, { retryInterval: 4_000 }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), timeoutMs),
      ),
    ]);
  } catch {
    // Timeout or RPC error — proceed anyway; wallet extension may handle nonce
  } finally {
    // Clear the tracked hash if it hasn't been replaced by a newer one
    if (_pendingTxHash === hash) {
      _pendingTxHash = null;
    }
  }
}
