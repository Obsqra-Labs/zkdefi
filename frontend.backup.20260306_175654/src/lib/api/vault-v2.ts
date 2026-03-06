const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003";

export interface VaultAccount {
  vault_id: string;
  owner_address: string;
  mode: string;
  tier: number;
  created_at: number;
}

export interface VaultBalance {
  vault_id: string;
  available: Record<string, number>;
  pending: Record<string, number>;
  by_token: Record<string, { available: number; pending: number; deployed: number }>;
}

export interface DepositIntent {
  intent_id: string;
  vault_id: string;
  amount_wei: string;
  token: string;
  rail: string;
  status: string;
  tx_hash?: string;
  commitment_hash?: string;
}

export interface Note {
  note_id: string;
  vault_id: string;
  rail_type: string;
  commitment_hash: string;
  token: string;
  amount_wei: string;
  custody: string;
  status: string;
}

export interface DeployProposal {
  proposal_hash: string;
  vault_id: string;
  adapters: string[];
  amounts: string[];
  token: string;
  status: string;
}

export interface Withdrawal {
  withdrawal_id: string;
  vault_id: string;
  amount_wei: string;
  token: string;
  destination: string;
  route: string;
  status: string;
  tx_hash?: string;
}

export interface LedgerEntry {
  entry_id: number;
  tx_type: string;
  amount_wei: string;
  token: string;
  dr_account: string;
  cr_account: string;
  receipt_hash: string;
  created_at: number;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/v1/zkdefi${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

export async function getOrCreateVault(
  ownerAddress: string,
  mode = "OPERATOR_MANAGED",
): Promise<VaultAccount> {
  return apiFetch("/vault/v2/account", {
    method: "POST",
    body: JSON.stringify({ owner_address: ownerAddress, mode }),
  });
}

export async function getVaultBalance(vaultId: string): Promise<VaultBalance> {
  return apiFetch(`/vault/v2/${vaultId}/balance`);
}

export async function createDepositIntent(
  vaultId: string,
  amountWei: string,
  token: string,
  rail: string,
): Promise<DepositIntent> {
  return apiFetch("/vault/v2/deposit/intent", {
    method: "POST",
    body: JSON.stringify({
      vault_id: vaultId,
      amount_wei: amountWei,
      token,
      rail,
    }),
  });
}

export async function confirmDeposit(
  intentId: string,
  txHash: string,
  commitmentHash: string,
): Promise<DepositIntent> {
  return apiFetch("/vault/v2/deposit/confirm", {
    method: "POST",
    body: JSON.stringify({
      intent_id: intentId,
      tx_hash: txHash,
      commitment_hash: commitmentHash,
    }),
  });
}

export async function getVaultNotes(
  vaultId: string,
  status?: string,
): Promise<Note[]> {
  const qs = status ? `?status=${status}` : "";
  return apiFetch(`/vault/v2/${vaultId}/notes${qs}`);
}

export async function createDeployIntent(
  vaultId: string,
  adapters: string[],
  amounts: string[],
  token: string,
): Promise<DeployProposal> {
  return apiFetch("/vault/v2/deploy/intent", {
    method: "POST",
    body: JSON.stringify({
      vault_id: vaultId,
      adapters,
      amounts,
      token,
    }),
  });
}

export async function commitDeploy(
  proposalHash: string,
  txHash: string,
): Promise<{ status: string; proposal_hash: string }> {
  return apiFetch("/vault/v2/deploy/commit", {
    method: "POST",
    body: JSON.stringify({
      proposal_hash: proposalHash,
      tx_hash: txHash,
    }),
  });
}

export async function settleDeploy(
  proposalHash: string,
  txHash: string,
): Promise<{ status: string; proposal_hash: string }> {
  return apiFetch("/vault/v2/deploy/settle", {
    method: "POST",
    body: JSON.stringify({
      proposal_hash: proposalHash,
      tx_hash: txHash,
    }),
  });
}

export async function requestWithdrawal(
  vaultId: string,
  amountWei: string,
  token: string,
  destination: string,
  route: string,
): Promise<Withdrawal> {
  return apiFetch("/vault/v2/withdraw/request", {
    method: "POST",
    body: JSON.stringify({
      vault_id: vaultId,
      amount_wei: amountWei,
      token,
      destination,
      route,
    }),
  });
}

export async function sweepToLedger(
  vaultId: string,
  noteId: string,
  amountWei: string,
  token: string,
): Promise<{ status: string; note_id: string }> {
  return apiFetch("/vault/v2/sweep/to-ledger", {
    method: "POST",
    body: JSON.stringify({
      vault_id: vaultId,
      note_id: noteId,
      amount_wei: amountWei,
      token,
    }),
  });
}

export async function sweepToVault(
  vaultId: string,
  amountWei: string,
  token: string,
  targetRail: string,
): Promise<{ status: string; note_id: string }> {
  return apiFetch("/vault/v2/sweep/to-vault", {
    method: "POST",
    body: JSON.stringify({
      vault_id: vaultId,
      amount_wei: amountWei,
      token,
      target_rail: targetRail,
    }),
  });
}

export async function getVaultReceipts(
  vaultId: string,
): Promise<LedgerEntry[]> {
  return apiFetch(`/vault/v2/${vaultId}/receipts`);
}
