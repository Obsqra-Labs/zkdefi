import { apiFetch } from "@/lib/api/client";

const PREFIX = "/api/v1/zkdefi/auth/session";

export interface DualWalletSessionStatus {
  active: boolean;
  status: string;
  session_id?: string;
  starknet_address?: string;
  chain?: string;
  evm_address?: string;
  issued_at?: number;
  issued_at_iso?: string;
  expires_at?: number;
  verified_at?: string;
  revoked?: boolean;
  auth_provider?: string;
  credential_summary?: {
    mode?: string;
    standard?: string;
    generated_at?: string;
    ethereum?: {
      network?: string;
      address?: string;
      chain_id?: string;
      selected_chain?: string;
      verified?: boolean;
      signature_type?: string;
      signature_digest?: string;
    };
    starknet?: {
      address?: string;
      chain_id?: string;
      present?: boolean;
      signature_type?: string;
      signature_digest?: string;
      signed_at?: string;
      typed_data_primary_type?: string;
    };
  } | null;
  history?: Array<{
    at?: string;
    action?: string;
    status?: string;
    auth_provider?: string;
    chain?: string;
    evm_address?: string;
    bound?: boolean;
    credential_mode?: string;
  }>;
  identity_binding?: {
    linked_chain_key?: string | null;
    linked_address?: string | null;
    bound?: boolean;
    linked_updated_at?: string | null;
    reason?: string;
  };
  identity_binding_enabled?: boolean;
  purpose?: string;
  disclaimer?: string;
}

export interface SessionStartResponse {
  nonce_id: string;
  challenge: string;
  expires_at: number;
  chain: string;
  address: string;
  purpose?: string;
}

export interface CompleteDualWalletSessionOptions {
  authProvider?: string;
  credentials?: Record<string, unknown>;
}

export async function startDualWalletSession(
  starknetAddress: string,
  address: string,
  chain = "ethereum",
): Promise<SessionStartResponse> {
  return apiFetch<SessionStartResponse>(`${PREFIX}/start`, {
    method: "POST",
    body: JSON.stringify({
      starknet_address: starknetAddress,
      chain,
      address,
    }),
  });
}

export async function completeDualWalletSession(
  starknetAddress: string,
  address: string,
  nonceId: string,
  signature: string,
  chain = "ethereum",
  options?: CompleteDualWalletSessionOptions,
): Promise<DualWalletSessionStatus> {
  return apiFetch<DualWalletSessionStatus>(`${PREFIX}/complete`, {
    method: "POST",
    body: JSON.stringify({
      starknet_address: starknetAddress,
      chain,
      address,
      nonce_id: nonceId,
      signature,
      auth_provider: options?.authProvider,
      credentials: options?.credentials,
    }),
  });
}

export async function getDualWalletSession(starknetAddress: string): Promise<DualWalletSessionStatus> {
  return apiFetch<DualWalletSessionStatus>(`${PREFIX}/${starknetAddress}`);
}

export async function revokeDualWalletSession(starknetAddress: string): Promise<DualWalletSessionStatus> {
  return apiFetch<DualWalletSessionStatus>(`${PREFIX}/${starknetAddress}`, {
    method: "DELETE",
  });
}
