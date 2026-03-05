/**
 * Calldata builders for pool contracts.
 * Layouts must match contracts/src/fully_shielded_pool.cairo (IFullyShieldedPoolU256).
 */

const U128 = BigInt(2) ** BigInt(128);

/**
 * Build calldata for FullyShieldedPool.withdraw_u256.
 * Contract signature (fully_shielded_pool.cairo):
 *   fn withdraw_u256(
 *     nullifier_low: u128, nullifier_high: u128,
 *     root_low: u128, root_high: u128,
 *     recipient: ContractAddress,
 *     amount: u256,        // 2 felts: amount_low, amount_high
 *     pool_type: u8,
 *     zk_proof: Span<felt252>  // len + elements
 *   )
 * If you get "Failed to deserialize param #7", the deployed contract may use
 * (recipient, pool_type, amount_low, amount_high). Use tryPoolTypeBeforeAmount.
 */
export function buildFullyShieldedWithdrawU256Calldata(params: {
  nullifierLow: string;
  nullifierHigh: string;
  rootLow: string;
  rootHigh: string;
  recipient: string;
  amountLow: string;
  amountHigh: string;
  poolType: number; // u8: 0-255
  proofElements: string[];
}): string[] {
  const poolTypeU8 = Math.max(0, Math.min(255, params.poolType));
  return [
    params.nullifierLow,
    params.nullifierHigh,
    params.rootLow,
    params.rootHigh,
    params.recipient,
    params.amountLow,
    params.amountHigh,
    String(poolTypeU8),
    String(params.proofElements.length),
    ...params.proofElements,
  ];
}

/**
 * Alternative order: recipient, pool_type, amount_low, amount_high.
 * Use if deployed pool was built with pool_type before amount (param #7 then = amount_low; large amount fails u8).
 */
export function buildFullyShieldedWithdrawU256CalldataPoolTypeBeforeAmount(params: {
  nullifierLow: string;
  nullifierHigh: string;
  rootLow: string;
  rootHigh: string;
  recipient: string;
  amountLow: string;
  amountHigh: string;
  poolType: number;
  proofElements: string[];
}): string[] {
  const poolTypeU8 = Math.max(0, Math.min(255, params.poolType));
  return [
    params.nullifierLow,
    params.nullifierHigh,
    params.rootLow,
    params.rootHigh,
    params.recipient,
    String(poolTypeU8),
    params.amountLow,
    params.amountHigh,
    String(params.proofElements.length),
    ...params.proofElements,
  ];
}

/** Split u256 (bigint) into low/high u128 decimal strings (matches Cairo u256 = (u128, u128)). */
export function u256ToLowHigh(value: bigint): [string, string] {
  const low = value % U128;
  const high = value / U128;
  return [low.toString(), high.toString()];
}
