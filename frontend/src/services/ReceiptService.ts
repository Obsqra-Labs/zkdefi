import { apiUrl } from '@/lib/api/client';
import { fetchWithRetry } from '@/lib/api/fetchUtils';

/**
 * Trade receipt for audit trail and Memory Lane
 */
export interface TradeReceipt {
  id: string;
  timestamp: string;
  action: string;
  adapter: string;
  opportunityName?: string;
  amount: number;
  privacyLevel: 'public' | 'shielded' | 'dark_ledger';
  exposureLevel?: number;
  yieldImpact: number;
  trustDelta: number;
  commitment?: string;
  amountHashed?: string;
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
}

/**
 * Receipt with reputation impact (used for display)
 */
export interface ReceiptWithImpact extends TradeReceipt {
  reputationImpact: number;
  proofHash?: string;
  explanationFromAI?: string;
}

/**
 * Summary statistics for all receipts
 */
export interface ReceiptSummary {
  totalExecutions: number;
  totalYield: number;
  successRate: number;
  reputationGainedFromProofs: number;
  topPerformingAdapter: string;
  lastExecutionTime: string;
}

/**
 * ReceiptService
 *
 * Manages trade receipts for the Memory Lane timeline and audit trail.
 * Provides:
 * - Recording new trade receipts
 * - Retrieving receipts with optional filters (date, type, adapter)
 * - Summary statistics across all trades
 * - Timeline view of recent trades (newest first)
 *
 * Used by Memory Lane component for displaying execution history.
 */
export class ReceiptService {
  /**
   * Record a new trade receipt
   *
   * @param receipt - TradeReceipt to record
   * @returns receiptId (string)
   * @throws Error if storage fails
   */
  async recordReceipt(receipt: TradeReceipt): Promise<string> {
    const url = apiUrl('/api/v1/zkdefi/receipts');

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receipt),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to record receipt (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Fetch receipts with optional filters
   *
   * Fetches from Phase 2 ExecutionStore API (/api/v1/zkdefi/oracle/execution/history)
   * which provides real transaction data with confirmation status.
   *
   * @param filters - Optional filters for receipts
   *   - address: Starknet address to fetch history for
   *   - startDate: ISO8601 date string (for legacy compatibility)
   *   - endDate: ISO8601 date string (for legacy compatibility)
   *   - type: action type (for legacy compatibility)
   *   - adapter: adapter name (for legacy compatibility)
   * @returns ReceiptWithImpact[] in descending date order
   */
  async getReceipts(filters?: {
    address?: string;
    startDate?: string;
    endDate?: string;
    type?: string;
    adapter?: string;
  }): Promise<ReceiptWithImpact[]> {
    // Phase 2: Fetch real execution history
    if (filters?.address) {
      try {
        const params = new URLSearchParams();
        params.append('limit', '50');
        params.append('offset', '0');

        const url = apiUrl(
          `/api/v1/zkdefi/oracle/execution/history/${filters.address}?${params}`
        );

        const response = await fetchWithRetry(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          // Map execution records to receipt format
          if (data.executions && Array.isArray(data.executions)) {
            return data.executions.map((exec: any) => ({
              id: exec.call_id,
              timestamp: exec.confirmed_at || exec.submitted_at || exec.created_at,
              action: exec.method,
              adapter: exec.adapter,
              opportunityName: exec.adapter,
              amount: 0, // Placeholder
              privacyLevel: 'public',
              yieldImpact: 0, // Placeholder
              trustDelta: 0, // Placeholder
              txHash: exec.tx_hash,
              status: exec.status,
              reputationImpact: 0,
            }));
          }
        }
      } catch (err) {
        console.warn('Failed to fetch Phase 2 execution history:', err);
        // Fall through to legacy endpoint
      }
    }

    // Legacy fallback: Original receipts endpoint
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.adapter) params.append('adapter', filters.adapter);

    const url = apiUrl(`/api/v1/zkdefi/receipts?${params}`);

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.warn(`Receipts fallback failed (${response.status})`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch receipt summary statistics
   *
   * @returns ReceiptSummary with aggregate metrics
   */
  async getReceiptSummary(): Promise<ReceiptSummary> {
    const url = apiUrl('/api/v1/zkdefi/receipts/summary');

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch receipt summary (${response.status})`;
      throw new Error(detail);
    }

    return await response.json();
  }

  /**
   * Fetch receipt timeline (for Memory Lane)
   *
   * @param limit - Maximum number of receipts to return (default 50)
   * @returns ReceiptWithImpact[] in descending date order (newest first)
   */
  async getReceiptTimeline(limit: number = 50): Promise<ReceiptWithImpact[]> {
    const params = new URLSearchParams();
    params.append('limit', String(limit));

    const url = apiUrl(`/api/v1/zkdefi/receipts/timeline?${params}`);

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch receipt timeline (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }
}
