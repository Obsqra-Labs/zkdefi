/**
 * Collateral Service - Deposit/withdraw and health monitoring
 */

import { apiUrl } from '@/lib/api/client';
import { fetchWithRetry } from '@/lib/api/fetchUtils';

export interface CollateralDepositRequest {
  user_address: string;
  token: string;
  amount: number;
}

export interface CollateralWithdrawRequest {
  user_address: string;
  token: string;
  amount: number;
}

export interface CollateralResponse {
  status: 'pending' | 'confirmed' | 'failed';
  tx_hash: string | null;
  token: string;
  amount: number;
  action: 'deposit' | 'withdraw';
}

export interface CollateralHealthResponse {
  user_address: string;
  health_factor: number;
  status: 'healthy' | 'at_risk' | 'liquidatable';
  total_collateral_usd: number;
  total_borrowed_usd: number;
  collaterals: Array<{
    token: string;
    amount: number;
    price_usd: number;
    value_usd: number;
    utilization: number;
  }>;
}

export interface CollateralStatusResponse {
  user_address: string;
  total_deposited_usd: number;
  total_available_usd: number;
  collateral_count: number;
  positions: Array<{
    token: string;
    amount: number;
    price_usd: number;
    value_usd: number;
  }>;
}

export class CollateralService {
  async depositCollateral(request: CollateralDepositRequest): Promise<CollateralResponse> {
    try {
      const response = await fetchWithRetry(apiUrl('/api/v1/zkdefi/collateral/deposit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Collateral deposit failed:', error);
      throw error;
    }
  }

  async withdrawCollateral(request: CollateralWithdrawRequest): Promise<CollateralResponse> {
    try {
      const response = await fetchWithRetry(apiUrl('/api/v1/zkdefi/collateral/withdraw'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Collateral withdraw failed:', error);
      throw error;
    }
  }

  async getCollateralStatus(address: string): Promise<CollateralStatusResponse> {
    try {
      const response = await fetchWithRetry(apiUrl(`/api/v1/zkdefi/collateral/${address}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Collateral status fetch failed:', error);
      throw error;
    }
  }

  async getHealthFactor(address: string): Promise<CollateralHealthResponse> {
    try {
      const response = await fetchWithRetry(apiUrl(`/api/v1/zkdefi/collateral/health/${address}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Health factor fetch failed:', error);
      throw error;
    }
  }

  async requestLiquidation(
    userAddress: string,
    collateralToken: string,
    amount: number
  ): Promise<{ status: string; tx_hash: string | null }> {
    try {
      const response = await fetchWithRetry(apiUrl('/api/v1/zkdefi/collateral/liquidate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_address: userAddress,
          collateral_token: collateralToken,
          amount,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Liquidation request failed:', error);
      throw error;
    }
  }
}

export const collateralService = new CollateralService();
