import {
  AggregatedDexQuoteRequest,
  AggregatedDexQuoteResponse,
  AvnuBuildRequest,
  AvnuBuildResponse,
  AvnuQuoteRequest,
  AvnuQuoteResponse,
  BuildTxResponse,
  DexQuoteRequest,
  DexQuoteResponse,
  EkuboCapabilities,
  EkuboPositionsResponse,
  LpBuildRequest,
  LpBuildResponse,
  LpPreviewRequest,
  LpPreviewResponse,
  LpRecommendationResponse,
  LpRemoveBuildRequest,
  MarketSurfaceResponse,
  SwapBuildRequest,
  SwapQuoteRequest,
  SwapQuoteResponse,
  TokenInfo,
} from "@/types/ekubo";

import { API_BASE, apiFetch } from "@/lib/api/client";

export function getEkuboCapabilities(): Promise<EkuboCapabilities> {
  return apiFetch<EkuboCapabilities>("/api/v1/zkdefi/ekubo/capabilities");
}

export function getMarketSurface(): Promise<MarketSurfaceResponse> {
  return apiFetch<MarketSurfaceResponse>("/api/v1/zkdefi/market/surface");
}

export function getEkuboPositions(owner: string): Promise<EkuboPositionsResponse> {
  const q = encodeURIComponent(owner);
  return apiFetch<EkuboPositionsResponse>(`/api/v1/zkdefi/ekubo/positions?owner=${q}`);
}

export function getDexTokens(pageSize = 500): Promise<{ tokens: TokenInfo[] }> {
  return apiFetch<{ tokens: TokenInfo[] }>(`/api/v1/zkdefi/dex/tokens?page_size=${pageSize}`);
}

export function quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
  return apiFetch<SwapQuoteResponse>("/api/v1/zkdefi/ekubo/swap/quote", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function buildSwapTx(request: SwapBuildRequest): Promise<BuildTxResponse> {
  return apiFetch<BuildTxResponse>("/api/v1/zkdefi/ekubo/swap/build", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function quoteDexSwap(request: DexQuoteRequest): Promise<DexQuoteResponse> {
  return apiFetch<DexQuoteResponse>("/api/v1/zkdefi/dex/quote", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function quoteAggregatedDexSwap(request: AggregatedDexQuoteRequest): Promise<AggregatedDexQuoteResponse> {
  return apiFetch<AggregatedDexQuoteResponse>("/api/v1/zkdefi/dex/aggregated-quote", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function quoteAvnuSwap(request: AvnuQuoteRequest): Promise<AvnuQuoteResponse> {
  return apiFetch<AvnuQuoteResponse>("/api/v1/zkdefi/dex/avnu/quote", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function buildAvnuSwapTx(request: AvnuBuildRequest): Promise<AvnuBuildResponse> {
  return apiFetch<AvnuBuildResponse>("/api/v1/zkdefi/dex/avnu/build", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function previewLp(request: LpPreviewRequest): Promise<LpPreviewResponse> {
  return apiFetch<LpPreviewResponse>("/api/v1/zkdefi/ekubo/lp/preview", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function buildLpAddTx(request: LpBuildRequest): Promise<LpBuildResponse> {
  return apiFetch<LpBuildResponse>("/api/v1/zkdefi/ekubo/lp/add/build", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function buildLpRemoveTx(request: LpRemoveBuildRequest): Promise<LpBuildResponse> {
  return apiFetch<LpBuildResponse>("/api/v1/zkdefi/ekubo/lp/remove/build", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function confirmPositionStatus(
  positionId: string,
  status: string,
  txHash?: string,
  ekuboNftId?: number,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/v1/zkdefi/ekubo/lp/status", {
    method: "POST",
    body: JSON.stringify({
      position_id: positionId,
      status,
      tx_hash: txHash,
      ekubo_nft_id: ekuboNftId ?? null,
    }),
  });
}

export function verifyLpTx(
  txHash: string,
  owner: string,
  positionId?: string,
): Promise<{
  verified: boolean;
  execution_status?: string;
  ekubo_nft_id?: number | null;
  error?: string;
  position_updated?: boolean;
}> {
  const params = new URLSearchParams({ tx_hash: txHash, owner });
  if (positionId) params.set("position_id", positionId);
  return apiFetch(`/api/v1/zkdefi/ekubo/lp/verify-tx?${params}`, {
    method: "POST",
  });
}

export function purgeStalePositions(
  owner: string,
  maxAgeHours = 1,
): Promise<{ ok: boolean; purged: number; remaining: number }> {
  const params = new URLSearchParams({ owner, max_age_hours: String(maxAgeHours) });
  return apiFetch(`/api/v1/zkdefi/ekubo/lp/purge-stale?${params}`, {
    method: "POST",
  });
}

export function syncOnchainBalance(
  owner: string,
): Promise<{
  onchain_nft_balance: number | null;
  local_active: number;
  local_built: number;
  local_total: number;
  synced: boolean;
}> {
  const params = new URLSearchParams({ owner });
  return apiFetch(`/api/v1/zkdefi/ekubo/lp/sync?${params}`, { method: "POST" });
}

export function importOnchainPositions(
  owner: string,
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
  positions_imported: Array<{ nft_id: number; status: string; fee_bps?: number }>;
  total_local: number;
}> {
  const params = new URLSearchParams({ owner });
  return apiFetch(`/api/v1/zkdefi/ekubo/lp/import-onchain?${params}`, { method: "POST" });
}

export function buildCollectFeesTx(
  owner: string,
  positionId: string,
): Promise<{
  position_id: string;
  approvals: Array<{ contract_address: string; entrypoint: string; calldata: string[] }>;
  calls: Array<{ contract_address: string; entrypoint: string; calldata: string[] }>;
  warnings: string[];
}> {
  const params = new URLSearchParams({ owner, position_id: positionId });
  return apiFetch(`/api/v1/zkdefi/ekubo/lp/collect-fees/build?${params}`, { method: "POST" });
}

export function getLpRecommendation(
  userAddress: string,
  riskProfile: "conservative" | "neutral" | "aggressive" = "neutral",
): Promise<LpRecommendationResponse> {
  return apiFetch<LpRecommendationResponse>("/api/v1/zkdefi/ekubo/lp/recommend", {
    method: "POST",
    body: JSON.stringify({ user_address: userAddress, risk_profile: riskProfile }),
  });
}
