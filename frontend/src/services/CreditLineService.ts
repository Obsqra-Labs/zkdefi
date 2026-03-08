/**
 * Credit Line Service - Credit scoring and borrowing
 */

import { apiUrl } from '@/lib/api/client';

export interface CreditLineRequest {
  user_address: string;
  collateral_token: string;
  collateral_amount: number;
  desired_credit_usd: number;
}

export interface CreditLineResponse {
  user_address: string;
  status: 'pending' | 'active' | 'closed';
  credit_limit_usd: number;
  credit_available_usd: number;
  credit_used_usd: number;
  collateral_token: string;
  collateral_amount: number;
  ltv_ratio: number;
  interest_rate: number;
  created_at: string;
}

export interface CreditScoreResponse {
  user_address: string;
  fico_score: number; // 300-850
  fico_tier: 'poor' | 'fair' | 'good' | 'excellent';
  components: Record<string, number>;
  confidence: number;
  proof?: string;
}

export interface CreditTransactionRequest {
  user_address: string;
  amount_usd: number;
  action: 'borrow' | 'repay';
}

export interface CreditTransactionResponse {
  status: 'pending' | 'confirmed' | 'failed';
  tx_hash: string | null;
  action: string;
  amount: number;
  new_balance: number;
}

export class CreditLineService {
  async openCreditLine(request: CreditLineRequest): Promise<CreditLineResponse> {
    try {
      const response = await fetch(apiUrl('/api/v1/zkdefi/credit/lines/open'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Open credit line failed:', error);
      throw error;
    }
  }

  async getCreditScore(
    address: string,
    includeProof: boolean = false
  ): Promise<CreditScoreResponse> {
    try {
      const url = new URL(apiUrl(`/api/v1/zkdefi/credit/score/${address}`));
      if (includeProof) url.searchParams.append('include_proof', 'true');

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Credit score fetch failed:', error);
      throw error;
    }
  }

  async borrow(lineId: string, request: CreditTransactionRequest): Promise<CreditTransactionResponse> {
    try {
      const response = await fetch(apiUrl(`/api/v1/zkdefi/credit/lines/${lineId}/borrow`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Borrow failed:', error);
      throw error;
    }
  }

  async repay(lineId: string, request: CreditTransactionRequest): Promise<CreditTransactionResponse> {
    try {
      const response = await fetch(apiUrl(`/api/v1/zkdefi/credit/lines/${lineId}/repay`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Repay failed:', error);
      throw error;
    }
  }

  async getCreditLines(address: string): Promise<{
    user_address: string;
    active_lines: number;
    total_limit_usd: number;
    total_available_usd: number;
    total_used_usd: number;
    lines: CreditLineResponse[];
  }> {
    try {
      const response = await fetch(apiUrl(`/api/v1/zkdefi/credit/lines/${address}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Fetch credit lines failed:', error);
      throw error;
    }
  }
}

export const creditLineService = new CreditLineService();
