/**
 * Privacy Vault Service - Deposit/Withdraw shielded pools
 */

import { apiUrl } from '@/lib/api/client';

export interface ShieldedDepositRequest {
  user_address: string;
  token: string;
  amount_wei: number;
  commitment: string;
  metadata?: Record<string, any>;
}

export interface ShieldedWithdrawRequest {
  user_address: string;
  commitment: string;
  nullifier: string;
  proof: string;
  recipient?: string;
}

export interface DepositResponse {
  status: 'pending' | 'confirmed' | 'failed';
  tx_hash: string | null;
  commitment: string;
  amount: number;
  token: string;
}

export interface WithdrawResponse {
  status: 'pending' | 'confirmed' | 'failed';
  tx_hash: string | null;
  recipient: string;
  amount: number;
  token: string;
}

export class PrivacyVaultService {
  async depositShielded(request: ShieldedDepositRequest): Promise<DepositResponse> {
    try {
      const response = await fetch(apiUrl('/api/v1/zkdefi/privacy/vault/deposit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Deposit failed:', error);
      throw error;
    }
  }

  async withdrawShielded(request: ShieldedWithdrawRequest): Promise<WithdrawResponse> {
    try {
      const response = await fetch(apiUrl('/api/v1/zkdefi/privacy/vault/withdraw'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Withdraw failed:', error);
      throw error;
    }
  }

  async getCommitmentStatus(commitment: string): Promise<{
    commitment: string;
    status: 'active' | 'spent' | 'unknown';
    available_for_withdrawal: boolean;
  }> {
    try {
      const response = await fetch(apiUrl(`/api/v1/zkdefi/privacy/vault/status/${commitment}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Status check failed:', error);
      throw error;
    }
  }

  async getShieldedBalance(address: string): Promise<{
    address: string;
    total_shielded_usd: number;
    pools: Array<{
      token: string;
      amount: number;
      commitment_count: number;
    }>;
  }> {
    try {
      const response = await fetch(apiUrl(`/api/v1/zkdefi/privacy/vault/balance/${address}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Balance fetch failed:', error);
      throw error;
    }
  }
}

export const privacyVaultService = new PrivacyVaultService();
