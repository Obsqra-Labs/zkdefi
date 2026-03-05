/**
 * Lending API Client
 *
 * Communicates with the lending routes at /api/v1/zkdefi/lending/*.
 */

import { apiFetch } from "@/lib/api/client";

const PREFIX = "/api/v1/zkdefi/lending";

// ── Types ──────────────────────────────────────────────────────

export interface LendingPoolStats {
  pool_address: string;
  token: string;
  total_supplied_wei: number;
  total_supplied_eth: number;
  total_borrowed_wei: number;
  total_borrowed_eth: number;
  utilization_bps: number;
  supply_apy_bps: number;
  borrow_apy_bps: number;
  available_liquidity_wei: number;
  available_liquidity_eth: number;
}

export interface LoanPosition {
  loan_id: number;
  principal_wei: number;
  interest_wei: number;
  interest_rate_bps: number;
  opened_at: number;
  last_accrued: number;
  attestation_hash?: string;
  active: boolean;
  tx_hash?: string;
}

export interface SupplyPosition {
  supply_id: number;
  amount_wei: number;
  deposited_at: number;
  active: boolean;
  tx_hash?: string;
}

export interface UserLendingPositions {
  address: string;
  loans: LoanPosition[];
  supplies: SupplyPosition[];
  loan_count: number;
  supply_count: number;
}

export interface HealthFactorResult {
  address: string;
  health_factor: number;
  collateral_wei: number;
  total_debt_wei: number;
  status: "healthy" | "at_risk" | "liquidatable" | "no_debt";
  loan_count?: number;
}

export interface CallResult {
  calls: Array<{
    contractAddress: string;
    entrypoint: string;
    calldata: string[];
  }>;
  message: string;
}

// ── Pool ───────────────────────────────────────────────────────

export function getLendingPool(): Promise<LendingPoolStats> {
  return apiFetch<LendingPoolStats>(`${PREFIX}/pool`);
}

// ── User positions ─────────────────────────────────────────────

export function getUserLendingPositions(address: string): Promise<UserLendingPositions> {
  return apiFetch<UserLendingPositions>(`${PREFIX}/positions/${address}`);
}

// ── Supply ─────────────────────────────────────────────────────

export function buildSupplyTx(amountWei: number): Promise<CallResult> {
  return apiFetch<CallResult>(`${PREFIX}/supply`, {
    method: "POST",
    body: JSON.stringify({ amount_wei: amountWei }),
  });
}

export function confirmSupply(
  address: string,
  supplyId: number,
  amountWei: number,
  txHash?: string,
) {
  return apiFetch(`${PREFIX}/supply/confirm`, {
    method: "POST",
    body: JSON.stringify({
      address,
      supply_id: supplyId,
      amount_wei: amountWei,
      tx_hash: txHash,
    }),
  });
}

// ── Borrow ─────────────────────────────────────────────────────

export function buildBorrowTx(address: string, amountWei: number, attestationHash: string): Promise<CallResult> {
  return apiFetch<CallResult>(`${PREFIX}/borrow`, {
    method: "POST",
    body: JSON.stringify({
      address,
      amount_wei: amountWei,
      attestation_hash: attestationHash,
    }),
  });
}

export function confirmBorrow(
  address: string,
  loanId: number,
  principalWei: number,
  interestRateBps: number,
  attestationHash?: string,
  txHash?: string,
) {
  return apiFetch(`${PREFIX}/borrow/confirm`, {
    method: "POST",
    body: JSON.stringify({
      address,
      loan_id: loanId,
      principal_wei: principalWei,
      interest_rate_bps: interestRateBps,
      attestation_hash: attestationHash,
      tx_hash: txHash,
    }),
  });
}

// ── Repay ──────────────────────────────────────────────────────

export function buildRepayTx(loanId: number, amountWei: number): Promise<CallResult> {
  return apiFetch<CallResult>(`${PREFIX}/repay`, {
    method: "POST",
    body: JSON.stringify({ loan_id: loanId, amount_wei: amountWei }),
  });
}

export function confirmRepay(address: string, loanId: number, amountWei: number, txHash?: string) {
  return apiFetch(`${PREFIX}/repay/confirm`, {
    method: "POST",
    body: JSON.stringify({ address, loan_id: loanId, amount_wei: amountWei, tx_hash: txHash }),
  });
}

// ── Withdraw ───────────────────────────────────────────────────

export function buildWithdrawTx(supplyId: number): Promise<CallResult> {
  return apiFetch<CallResult>(`${PREFIX}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ supply_id: supplyId }),
  });
}

// ── Liquidate ──────────────────────────────────────────────────

export function buildLiquidateTx(loanId: number): Promise<CallResult> {
  return apiFetch<CallResult>(`${PREFIX}/liquidate`, {
    method: "POST",
    body: JSON.stringify({ loan_id: loanId }),
  });
}

// ── Health ──────────────────────────────────────────────────────

export function getHealthFactor(address: string, loanId?: number): Promise<HealthFactorResult> {
  const params = loanId != null ? `?loan_id=${loanId}` : "";
  return apiFetch<HealthFactorResult>(`${PREFIX}/health/${address}${params}`);
}

// ── Attestation (for borrow) ───────────────────────────────────

export function issueAttestation(address: string) {
  return apiFetch(`/api/v1/zkdefi/risk_passport/user/${address}/attestation`, {
    method: "POST",
  });
}

export function getActiveAttestation(address: string) {
  return apiFetch<{
    address: string;
    found: boolean;
    attestation: Record<string, unknown> | null;
  }>(`/api/v1/zkdefi/risk_passport/v2/user/${address}/attestation/active`);
}

export function issueAttestationV2(address: string, force = false) {
  const suffix = force ? "?force=true" : "";
  return apiFetch<{
    address: string;
    issued_new: boolean;
    attestation: Record<string, unknown>;
    force: boolean;
  }>(`/api/v1/zkdefi/risk_passport/v2/user/${address}/attestation/issue${suffix}`, {
    method: "POST",
  });
}

export function getRiskPassportV2(address: string) {
  return apiFetch<Record<string, unknown>>(`/api/v1/zkdefi/risk_passport/v2/user/${address}`);
}

export function getUserAttestations(address: string) {
  return apiFetch<{
    address: string;
    count: number;
    attestations: Array<Record<string, unknown>>;
  }>(`/api/v1/zkdefi/risk_passport/user/${address}/attestations`);
}
