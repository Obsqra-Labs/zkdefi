/**
 * Ekubo positions — fetched directly from prod-api.ekubo.org
 * Positions on Starknet Sepolia use chain_id 0x534e5f4d41494f (SN_MAIO).
 */

// ---------------------------------------------------------------------------
// Token registry (Starknet addresses → symbol / decimals / indicative USD)
// ---------------------------------------------------------------------------

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; usd: number }> = {
  "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": { symbol: "ETH",   decimals: 18, usd: 2020 },
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": { symbol: "STRK",  decimals: 18, usd: 0.04 },
  "0x50974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637": { symbol: "zkdAI", decimals: 18, usd: 0.04 },
  "0x9b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121":  { symbol: "zkdETH", decimals: 18, usd: 2020 },
};

function tokenMeta(addr: string) {
  const key = addr.replace(/^0x0+/, "0x");
  return KNOWN_TOKENS[key] ?? { symbol: addr.slice(0, 6) + "…" + addr.slice(-4), decimals: 18, usd: 0 };
}

// ---------------------------------------------------------------------------
// Concentrated-liquidity math (Ekubo uses base 1.000001)
// ---------------------------------------------------------------------------

const LOG_BASE = Math.log(1.000001);

function tickToSqrtPrice(tick: number): number {
  return Math.exp((tick * LOG_BASE) / 2);
}

/** Compute token amounts from liquidity + ticks (standard CL formula) */
function computeAmounts(
  liquidity: number,
  currentTick: number,
  lowerTick: number,
  upperTick: number,
): { amount0: number; amount1: number } {
  const sqrtLower = tickToSqrtPrice(lowerTick);
  const sqrtUpper = tickToSqrtPrice(upperTick);
  const sqrtCurrent = tickToSqrtPrice(currentTick);

  let amount0 = 0;
  let amount1 = 0;

  if (currentTick < lowerTick) {
    // All in token0
    amount0 = liquidity * (1 / sqrtLower - 1 / sqrtUpper);
  } else if (currentTick >= upperTick) {
    // All in token1
    amount1 = liquidity * (sqrtUpper - sqrtLower);
  } else {
    amount0 = liquidity * (1 / sqrtCurrent - 1 / sqrtUpper);
    amount1 = liquidity * (sqrtCurrent - sqrtLower);
  }

  return { amount0: Math.max(0, amount0), amount1: Math.max(0, amount1) };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EkuboPosition {
  position_id: string;
  pool_key: {
    token0: string;
    token1: string;
    fee: string;
    tick_spacing: string;
  };
  bounds: { lower: number; upper: number };
  liquidity: string;
  /** Computed token amounts */
  amount0: number;
  amount1: number;
  /** Resolved symbols */
  token0Symbol: string;
  token1Symbol: string;
  /** Estimated USD value of this position */
  estimated_value_usd: number;
  /** Position image from Ekubo */
  image?: string;
}

export interface EkuboPositionsResponse {
  positions: EkuboPosition[];
  count: number;
  owner?: string;
  total_value_usd: number;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const EKUBO_API = "https://prod-api.ekubo.org";

export async function getEkuboPositions(owner: string): Promise<EkuboPositionsResponse> {
  try {
    const res = await fetch(`${EKUBO_API}/positions/${encodeURIComponent(owner)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { positions: [], count: 0, owner, total_value_usd: 0 };

    const raw = await res.json();
    const list: any[] = Array.isArray(raw) ? raw : raw?.data ?? [];

    let totalUsd = 0;
    const positions: EkuboPosition[] = list
      .filter((p: any) => Number(p.liquidity ?? 0) > 0)
      .map((p: any) => {
        const poolKey = p.pool_key ?? {};
        const t0 = tokenMeta(poolKey.token0 ?? "");
        const t1 = tokenMeta(poolKey.token1 ?? "");

        // Ekubo pool_state.tick is in full precision; bounds are position-level ticks.
        // The tick_spacing might mean bounds are stored as `tick / spacing`.
        const tickSpacing = parseInt(poolKey.tick_spacing ?? "1", 16) || 1;
        const rawCurrentTick = Number(p.pool_state?.tick ?? 0);
        const lowerTick = Number(p.bounds?.lower ?? 0) * tickSpacing;
        const upperTick = Number(p.bounds?.upper ?? 0) * tickSpacing;

        const liq = Number(p.liquidity ?? 0);
        const { amount0, amount1 } = computeAmounts(liq, rawCurrentTick, lowerTick, upperTick);

        // Normalise by decimals
        const normalised0 = amount0 / Math.pow(10, t0.decimals);
        const normalised1 = amount1 / Math.pow(10, t1.decimals);
        const usd = normalised0 * t0.usd + normalised1 * t1.usd;
        totalUsd += usd;

        return {
          position_id: String(p.id ?? ""),
          pool_key: {
            token0: poolKey.token0 ?? "",
            token1: poolKey.token1 ?? "",
            fee: poolKey.fee ?? "",
            tick_spacing: poolKey.tick_spacing ?? "",
          },
          bounds: { lower: Number(p.bounds?.lower ?? 0), upper: Number(p.bounds?.upper ?? 0) },
          liquidity: String(p.liquidity ?? "0"),
          amount0: normalised0,
          amount1: normalised1,
          token0Symbol: t0.symbol,
          token1Symbol: t1.symbol,
          estimated_value_usd: usd,
          image: p.image ?? undefined,
        };
      });

    return { positions, count: positions.length, owner, total_value_usd: totalUsd };
  } catch {
    return { positions: [], count: 0, owner, total_value_usd: 0 };
  }
}
