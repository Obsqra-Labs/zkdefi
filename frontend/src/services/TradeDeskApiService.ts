import { apiUrl } from "@/lib/api/client";
import { fetchWithRetry } from "@/lib/api/fetchUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Signal {
  yieldPrediction: number;
  riskPrediction: number;
  confidence: number;
  recommended: boolean;
}

export interface GatingResult {
  status: "unlocked" | "advisory" | "locked" | "proof_required";
  reason: string | null;
  requiredTier: number | null;
}

export interface UnifiedOpportunity {
  id: string;
  type:
    | "swap"
    | "lp"
    | "lending"
    | "staking"
    | "limit"
    | "dca"
    | "privacy"
    | "dark_ledger";
  productSlug: string;
  title: string;
  pair: string;
  protocol: string;
  currentYield: number;
  riskScore: number;
  tvlUsd: number;
  volume24h: number;
  privacyLevel: "public" | "shielded" | "fully_private";
  signal: Signal | null;
  aiNarrative: string | null;
  recommended: boolean;
  confidence: number;
  gating: GatingResult | null;
  executionMode: "wallet" | "relayer" | "both";
  calldataBuilder: string | null;
  metadata: Record<string, unknown>;
}

export interface OpportunityFilters {
  type?: string;
  minYield?: number;
  maxRisk?: number;
  privacyLevel?: string;
  limit?: number;
  offset?: number;
  userAddress?: string;
}

export interface PaginatedOpportunities {
  opportunities: UnifiedOpportunity[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface MarketContext {
  prices: Record<string, number>;
  stakingApy: number;
  timestamp: string;
  network: string;
}

export interface AdvisoryResponse {
  recommendation: "execute" | "wait" | "avoid";
  confidence: number;
  narrative: string;
  riskFactors: string[];
  suggestedAmount: number | null;
}

export interface SimulationResult {
  estimatedYield: number;
  priceImpact: number;
  gasEstimate: number;
  fees: number;
  netResult: number;
  riskAssessment: string;
}

export interface PreparedExecution {
  calldata: unknown[];
  contractAddress: string;
  entryPoint: string;
  estimatedGas: number;
  type: string;
}

export interface ExecutionStatus {
  txHash: string;
  status: string;
  confirmations: number;
  receipt: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const V2_PREFIX = "/api/v1/zkdefi/v2";

const RETRY_CONFIG = { maxRetries: 2, baseDelay: 800, timeoutMs: 15_000 };
const EXECUTE_RETRY_CONFIG = { maxRetries: 1, baseDelay: 500, timeoutMs: 30_000 };

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      qs.append(key, String(value));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

async function parseJson<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail =
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed (${response.status})`;
    throw new Error(`${detail} [${url}]`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TradeDeskApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = V2_PREFIX;
  }

  private url(path: string, query = ""): string {
    return apiUrl(`${this.baseUrl}${path}${query}`);
  }

  async getOpportunities(
    filters?: OpportunityFilters,
  ): Promise<PaginatedOpportunities> {
    const query = buildQuery({
      type: filters?.type,
      min_yield: filters?.minYield,
      max_risk: filters?.maxRisk,
      privacy_level: filters?.privacyLevel,
      limit: filters?.limit,
      offset: filters?.offset,
      user_address: filters?.userAddress,
    });
    const url = this.url("/opportunities", query);
    const res = await fetchWithRetry(url, { method: "GET" }, RETRY_CONFIG);
    return parseJson<PaginatedOpportunities>(res, url);
  }

  async getOpportunity(id: string): Promise<UnifiedOpportunity> {
    const url = this.url(`/opportunities/${encodeURIComponent(id)}`);
    const res = await fetchWithRetry(url, { method: "GET" }, RETRY_CONFIG);
    return parseJson<UnifiedOpportunity>(res, url);
  }

  async getMarketContext(): Promise<MarketContext> {
    const url = this.url("/market/context");
    const res = await fetchWithRetry(url, { method: "GET" }, RETRY_CONFIG);
    return parseJson<MarketContext>(res, url);
  }

  async getAdvisory(
    oppId: string,
    userAddress: string,
  ): Promise<AdvisoryResponse> {
    const query = buildQuery({ user_address: userAddress });
    const url = this.url(
      `/ai/advisory/${encodeURIComponent(oppId)}`,
      query,
    );
    const res = await fetchWithRetry(url, { method: "GET" }, RETRY_CONFIG);
    return parseJson<AdvisoryResponse>(res, url);
  }

  async simulate(params: {
    opportunityId: string;
    amount: number;
    userAddress: string;
  }): Promise<SimulationResult> {
    const url = this.url("/execute/simulate");
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: params.opportunityId,
          amount: params.amount,
          user_address: params.userAddress,
        }),
      },
      EXECUTE_RETRY_CONFIG,
    );
    return parseJson<SimulationResult>(res, url);
  }

  async prepare(params: {
    opportunityId: string;
    amount: number;
    params: Record<string, unknown>;
    userAddress: string;
  }): Promise<PreparedExecution> {
    const url = this.url("/execute/prepare");
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: params.opportunityId,
          amount: params.amount,
          params: params.params,
          user_address: params.userAddress,
        }),
      },
      EXECUTE_RETRY_CONFIG,
    );
    return parseJson<PreparedExecution>(res, url);
  }

  async submit(params: {
    opportunityId: string;
    amount: number;
    userAddress: string;
    calldata: unknown[];
  }): Promise<{ txHash: string; status: string; receiptId: string }> {
    const url = this.url("/execute/submit");
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: params.opportunityId,
          amount: params.amount,
          user_address: params.userAddress,
          calldata: params.calldata,
        }),
      },
      EXECUTE_RETRY_CONFIG,
    );
    return parseJson<{ txHash: string; status: string; receiptId: string }>(
      res,
      url,
    );
  }

  async getExecutionStatus(txHash: string): Promise<ExecutionStatus> {
    const url = this.url(
      `/execute/status/${encodeURIComponent(txHash)}`,
    );
    const res = await fetchWithRetry(url, { method: "GET" }, RETRY_CONFIG);
    return parseJson<ExecutionStatus>(res, url);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const tradeDeskApi = new TradeDeskApiService();
