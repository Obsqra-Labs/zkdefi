import { apiFetch } from '@/lib/api/client';

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

type ReceiptFilters = {
  address?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  adapter?: string;
  limit?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStatus(value: unknown): 'pending' | 'confirmed' | 'failed' {
  const text = asString(value).toLowerCase();
  if (text.includes('fail') || text === 'blocked') return 'failed';
  if (text.includes('confirm') || text.includes('pass') || text.includes('complete') || text === 'executed') {
    return 'confirmed';
  }
  return 'pending';
}

function inferPrivacyLevel(value: unknown): 'public' | 'shielded' | 'dark_ledger' {
  const text = asString(value).toLowerCase();
  if (text.includes('dark')) return 'dark_ledger';
  if (text.includes('shield') || text.includes('privacy') || text.includes('commitment')) return 'shielded';
  return 'public';
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('not found') || msg.includes('(404)') || msg.includes('404');
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
  private buildPath(basePath: string, params?: URLSearchParams): string {
    const query = params?.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  private normalizeReceipt(raw: unknown): ReceiptWithImpact {
    if (!isRecord(raw)) {
      return {
        id: '',
        timestamp: new Date().toISOString(),
        action: 'receipt',
        adapter: 'unknown',
        opportunityName: '',
        amount: 0,
        privacyLevel: 'public',
        yieldImpact: 0,
        trustDelta: 0,
        status: 'pending',
        reputationImpact: 0,
      };
    }

    const hashes = isRecord(raw.hashes) ? raw.hashes : {};
    const receiptId =
      asString(raw.id) ||
      asString(raw.receipt_id) ||
      `${asString(raw.timestamp)}-${asString(raw.type)}` ||
      `receipt-${Date.now()}`;
    const action = asString(raw.action) || asString(raw.type) || 'receipt';
    const opportunity = asString(raw.opportunityName) || asString(raw.intent_summary) || asString(raw.strategy_name);
    const source = asString(raw.adapter) || asString(raw.source) || asString(raw.venue) || 'unknown';
    const status = asStatus(raw.status || raw.gate_status);
    const trustDelta = asNumber(raw.trustDelta, asNumber(raw.trust_delta, 0));
    const txHash = asString(raw.txHash) || asString(raw.tx_hash) || asString(hashes.execution);
    const proofHash = asString(raw.proofHash) || asString(raw.proof_hash) || asString(hashes.intent);
    const explanation = asString(raw.explanationFromAI) || asString(raw.intent_summary);

    return {
      id: receiptId,
      timestamp: asString(raw.timestamp, new Date().toISOString()),
      action,
      adapter: source,
      opportunityName: opportunity,
      amount: asNumber(raw.amount, 0),
      privacyLevel: inferPrivacyLevel(raw.privacyLevel || raw.intent_summary || raw.strategy_name),
      yieldImpact: asNumber(raw.yieldImpact, 0),
      trustDelta,
      txHash: txHash || undefined,
      status,
      reputationImpact: asNumber(raw.reputationImpact, trustDelta),
      proofHash: proofHash || undefined,
      explanationFromAI: explanation || undefined,
    };
  }

  private normalizeReceipts(data: unknown): ReceiptWithImpact[] {
    if (Array.isArray(data)) return data.map((item) => this.normalizeReceipt(item));
    if (isRecord(data) && Array.isArray(data.receipts)) {
      return data.receipts.map((item) => this.normalizeReceipt(item));
    }
    return [];
  }

  private normalizeTimelinePayload(data: unknown): ReceiptWithImpact[] {
    if (Array.isArray(data)) {
      return data.map((item) => this.normalizeReceipt(item));
    }
    if (!isRecord(data)) {
      return [];
    }
    if (Array.isArray(data.receipts)) {
      return data.receipts.map((item) => this.normalizeReceipt(item));
    }
    if (Array.isArray(data.timeline)) {
      const flattened = data.timeline.flatMap((group) => {
        if (!isRecord(group) || !Array.isArray(group.receipts)) return [];
        return group.receipts;
      });
      return flattened.map((item) => this.normalizeReceipt(item));
    }
    return [];
  }

  private applyClientFilters(receipts: ReceiptWithImpact[], filters?: ReceiptFilters): ReceiptWithImpact[] {
    return receipts.filter((receipt) => {
      if (filters?.type && receipt.action !== filters.type) return false;
      if (filters?.adapter && receipt.adapter !== filters.adapter) return false;

      const ts = Date.parse(receipt.timestamp);
      if (filters?.startDate && Number.isFinite(ts)) {
        const start = Date.parse(filters.startDate);
        if (Number.isFinite(start) && ts < start) return false;
      }
      if (filters?.endDate && Number.isFinite(ts)) {
        const end = Date.parse(filters.endDate);
        if (Number.isFinite(end) && ts > end) return false;
      }
      return true;
    });
  }

  private async getMissionControlReceiptFallback(address: string, limit: number = 120): Promise<ReceiptWithImpact[]> {
    const endpoint = this.buildPath(
      `/api/v1/zkdefi/mc/receipts/timeline/${address}`,
      new URLSearchParams({ limit: String(limit), type: 'all' }),
    );
    const data = await apiFetch<{ timeline?: Array<{ receipts?: unknown[] }> }>(endpoint, {
      method: 'GET',
    });

    const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
    const flattened = timeline.flatMap((group) => (Array.isArray(group?.receipts) ? group.receipts : []));
    return flattened.map((item) => this.normalizeReceipt(item));
  }

  /**
   * Record a new trade receipt
   *
   * @param receipt - TradeReceipt to record
   * @returns receiptId (string)
   * @throws Error if storage fails
   */
  async recordReceipt(receipt: TradeReceipt): Promise<string> {
    try {
      const data = await apiFetch<Record<string, unknown>>('/api/v1/zkdefi/receipts', {
        method: 'POST',
        body: JSON.stringify(receipt),
      });
      return asString(data.id) || asString(data.receipt_id) || receipt.id;
    } catch (error) {
      if (isNotFoundError(error)) {
        return receipt.id;
      }
      throw error;
    }
  }

  /**
   * Fetch receipts with optional filters
   *
   * @param filters - Optional filters for receipts
   *   - startDate: ISO8601 date string
   *   - endDate: ISO8601 date string
   *   - type: action type (e.g., 'swap', 'lp_add')
   *   - adapter: adapter name (e.g., 'SwapAdapter')
   * @returns ReceiptWithImpact[] in descending date order
   */
  async getReceipts(filters?: ReceiptFilters): Promise<ReceiptWithImpact[]> {
    const params = new URLSearchParams();
    if (filters?.address) params.append('address', filters.address);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.adapter) params.append('adapter', filters.adapter);

    const timelineEndpoint = this.buildPath('/api/v1/zkdefi/receipts/timeline', params);
    const endpoint = this.buildPath('/api/v1/zkdefi/receipts', params);

    try {
      const timelineData = await apiFetch<unknown>(timelineEndpoint, { method: 'GET' });
      const timelineReceipts = this.normalizeTimelinePayload(timelineData);
      if (timelineReceipts.length > 0) {
        return this.applyClientFilters(timelineReceipts, filters);
      }
      if (!filters?.address) {
        return [];
      }
    } catch (timelineError) {
      if (!isNotFoundError(timelineError)) {
        if (!filters?.address) {
          throw timelineError;
        }
      }
    }

    try {
      const data = await apiFetch<unknown>(endpoint, { method: 'GET' });
      const receipts = this.normalizeReceipts(data);
      if (receipts.length > 0) return this.applyClientFilters(receipts, filters);
    } catch (primaryError) {
      if (filters?.address) {
        try {
          const fallback = await this.getMissionControlReceiptFallback(filters.address, filters.limit ?? 120);
          return this.applyClientFilters(fallback, filters);
        } catch {
          // If both APIs fail and the primary was 404, degrade to empty list.
        }
      }

      if (isNotFoundError(primaryError)) {
        return [];
      }
      throw primaryError;
    }

    if (filters?.address) {
      try {
        const fallback = await this.getMissionControlReceiptFallback(filters.address, filters.limit ?? 120);
        return this.applyClientFilters(fallback, filters);
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Fetch receipt summary statistics
   *
   * @returns ReceiptSummary with aggregate metrics
   */
  async getReceiptSummary(): Promise<ReceiptSummary> {
    const data = await apiFetch<Partial<ReceiptSummary>>('/api/v1/zkdefi/receipts/summary', {
      method: 'GET',
    });
    return {
      totalExecutions: asNumber(data.totalExecutions, 0),
      totalYield: asNumber(data.totalYield, 0),
      successRate: asNumber(data.successRate, 0),
      reputationGainedFromProofs: asNumber(data.reputationGainedFromProofs, 0),
      topPerformingAdapter: asString(data.topPerformingAdapter, ''),
      lastExecutionTime: asString(data.lastExecutionTime, ''),
    };
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
    const endpoint = this.buildPath('/api/v1/zkdefi/receipts/timeline', params);
    const data = await apiFetch<unknown>(endpoint, {
      method: 'GET',
    });
    return this.normalizeReceipts(data);
  }
}
