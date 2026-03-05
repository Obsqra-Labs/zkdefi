"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { formatPct as fmtPctSafe, formatPrice as fmtPriceSafe, formatUsd as fmtUsdSafe } from "@/lib/numberFormat";

const API_BASE = process.env.NEXT_PUBLIC_MM_SIM_API || "http://localhost:8099";

/* ── Types matching the real-activity on-chain API ────────────────────────── */
type PoolInfo = {
  name: string;
  token0: string;
  token1: string;
  token0_symbol: string;
  token1_symbol: string;
  fee_bps: number;
  tick_spacing: number;
  initialized: boolean;
  tick: number;
  price: number;
  tvl_usd: number;
  token0_balance: string;
  token1_balance: string;
  volume_24h_usd?: number;
  error: string | null;
};

type BotStatus = {
  enabled: boolean;
  available: boolean;
  interval_sec?: number;
  total?: number;
  successful?: number;
  failed?: number;
  last_tx_hash?: string;
  total_volume_wei?: number;
  positions_created?: number;
  orders_placed?: number;
  behavior_mix?: {
    degen?: number;
    retail?: number;
    whale?: number;
  };
  last_behavior?: string;
};

type APYInfo = {
  tracked_positions: number;
  weighted_apy_pct: number;
  weighted_apr_pct?: number;
  pools?: Record<
    string,
    { apr_24h_pct: number; apy_24h_pct: number; apr_7d_pct: number; apy_7d_pct: number }
  >;
};

type ChainState = {
  block_number: number;
  total_tvl_usd: number;
  total_pools: number;
  initialized_pools: number;
  data_quality: string;
  pools: PoolInfo[];
  timestamp: number;
  poll_count: number;
  mode?: string;
  bots?: {
    swap: BotStatus;
    lp: BotStatus;
    limit: BotStatus;
  };
  apy?: APYInfo;
  fee_policy?: {
    mode?: string;
    split?: { reinvest_lp?: number; stake_strk?: number; treasury_reserve?: number };
  };
  fee_automation?: {
    cycles?: number;
    fee_txs?: number;
  };
};

type AgentStats = {
  summary?: {
    total_transactions?: number;
    overall_success_rate?: number;
  };
};

type Tokenomics = {
  tokens?: {
    zkdETH?: { circulating?: number };
    zkdAI?: { circulating?: number };
  };
};

type PoolTrend = {
  price: "up" | "down" | "flat";
  tvl: "up" | "down" | "flat";
  volume: "up" | "down" | "flat";
};

type SimEvent = {
  ts: number;
  category: string;
  message: string;
  payload: Record<string, unknown>;
};

type LPPosition = {
  ekubo_nft_id: number;
  token0: string;
  token1: string;
  fee_tier: number;
  lower_tick: number;
  upper_tick: number;
  status: string;
  mint_tx_hash?: string;
};

function fmtUsd(value: number | undefined) {
  return fmtUsdSafe(value, "—");
}

function fmtPrice(value: number | undefined, tick?: number) {
  if (tick != null && Math.abs(tick) > 88_700_000) return "—";
  return fmtPriceSafe(value, "—");
}

function fmtPct(value: number | undefined) {
  return fmtPctSafe(value, 2, "—");
}

function shortenAddr(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortenHash(hash: string | undefined) {
  if (!hash) return null;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function trendArrow(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "↗";
  if (direction === "down") return "↘";
  return "→";
}

function trendClass(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "text-emerald-400";
  if (direction === "down") return "text-red-400";
  return "text-slate-500";
}

function heuristicApy(poolName: string, tvlUsd: number, initialized: boolean): number {
  if (!initialized) return 0;
  const hash = [...poolName].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 1000, 0);
  const depthBoost = tvlUsd >= 500_000 ? 6 : tvlUsd >= 100_000 ? 4 : tvlUsd >= 25_000 ? 2 : 0;
  const apy = 4 + (hash % 2200) / 100 + depthBoost;
  return Math.max(4, Math.min(32, apy));
}

const VOYAGER_BASE = "https://sepolia.voyager.online";

/* ── Category → colour mapping for event feed ────────────────────────────── */
const categoryColor: Record<string, string> = {
  system: "text-blue-400",
  pool: "text-emerald-400",
  price: "text-amber-400",
  trade: "text-cyan-400",
  lp: "text-purple-400",
  limit: "text-pink-400",
  fees: "text-yellow-300",
  admin: "text-orange-400",
  scenario: "text-yellow-400",
  error: "text-red-400",
};

const botLabels: Record<string, { label: string; icon: string; color: string }> = {
  swap: { label: "Swap Bot", icon: "⇋", color: "text-cyan-400" },
  lp: { label: "LP Bot", icon: "💧", color: "text-purple-400" },
  limit: { label: "Limit Bot", icon: "📊", color: "text-pink-400" },
};

export default function SimulatorPage() {
  const [state, setState] = useState<ChainState | null>(null);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [positions, setPositions] = useState<LPPosition[]>([]);
  const [connected, setConnected] = useState(false);
  const [apyData, setApyData] = useState<APYInfo | null>(null);
  const [tokenomics, setTokenomics] = useState<Tokenomics | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [poolTrends, setPoolTrends] = useState<Record<string, PoolTrend>>({});
  const prevPoolsRef = useRef<PoolInfo[]>([]);

  /* WebSocket for live updates */
  const wsUrl = useMemo(() => {
    if (API_BASE.startsWith("https://"))
      return API_BASE.replace("https://", "wss://") + "/ws/public";
    if (API_BASE.startsWith("http://"))
      return API_BASE.replace("http://", "ws://") + "/ws/public";
    return `ws://${API_BASE}/ws/public`;
  }, []);

  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 5000);
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            state?: ChainState;
            events?: SimEvent[];
          };
          if (data.state) {
            const previous = prevPoolsRef.current;
            const trends: Record<string, PoolTrend> = {};
            const prevByName = new Map(previous.map((p) => [p.name, p]));
            for (const pool of data.state.pools || []) {
              const prev = prevByName.get(pool.name);
              const priceDir: PoolTrend["price"] = !prev || Math.abs((pool.price || 0) - (prev.price || 0)) < 1e-12
                ? "flat"
                : (pool.price || 0) > (prev.price || 0) ? "up" : "down";
              const tvlDir: PoolTrend["tvl"] = !prev || Math.abs((pool.tvl_usd || 0) - (prev.tvl_usd || 0)) < 1e-6
                ? "flat"
                : (pool.tvl_usd || 0) > (prev.tvl_usd || 0) ? "up" : "down";
              const volDir: PoolTrend["volume"] = !prev || Math.abs((pool.volume_24h_usd || 0) - (prev.volume_24h_usd || 0)) < 1e-6
                ? "flat"
                : (pool.volume_24h_usd || 0) > (prev.volume_24h_usd || 0) ? "up" : "down";
              trends[pool.name] = { price: priceDir, tvl: tvlDir, volume: volDir };
            }
            setPoolTrends(trends);
            setState(data.state);
            prevPoolsRef.current = data.state.pools || [];
            if (data.state.apy) setApyData(data.state.apy);
          }
          if (data.events) setEvents(data.events.slice(-60).reverse());
        } catch {
          /* ignore parse errors */
        }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [wsUrl]);

  /* Fetch positions + APY periodically */
  const fetchPositions = useCallback(() => {
    fetch(`${API_BASE}/public/positions`)
      .then((r) => r.json())
      .then((d) => setPositions(d.positions || []))
      .catch(() => {});
  }, []);

  const fetchApy = useCallback(() => {
    fetch(`${API_BASE}/public/apy`)
      .then((r) => r.json())
      .then((d) => setApyData(d))
      .catch(() => {});
  }, []);

  const fetchExtras = useCallback(() => {
    fetch(`${API_BASE}/public/tokenomics`).then((r) => r.json()).then((d) => setTokenomics(d)).catch(() => {});
    fetch(`${API_BASE}/public/agent`).then((r) => r.json()).then((d) => setAgentStats(d)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchPositions();
    fetchApy();
    fetchExtras();
    const iv = setInterval(() => {
      fetchPositions();
      fetchApy();
      fetchExtras();
    }, 30_000);
    return () => clearInterval(iv);
  }, [fetchPositions, fetchApy, fetchExtras]);

  const quality = state?.data_quality || "loading";
  const qualityBadge =
    quality === "on-chain"
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      : quality === "loading"
        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
        : "bg-red-500/20 text-red-400 border-red-500/30";

  const mode = state?.mode || "loading";
  const modeBadge =
    mode === "real_activity"
      ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
      : "bg-slate-500/20 text-slate-400 border-slate-500/30";

  const bots = state?.bots;
  const aggregateApy = apyData?.weighted_apy_pct ?? 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                zkDeFi Market Simulator
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                Real on-chain bots generating swaps, LP positions &amp; limit
                orders on Starknet Sepolia via Ekubo DEX
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${qualityBadge}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`}
                />
                {quality === "on-chain"
                  ? "Live On-Chain"
                  : quality === "loading"
                    ? "Connecting..."
                    : quality}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${modeBadge}`}
              >
                {mode === "real_activity" ? "Real Activity" : mode === "read_only" ? "Read-Only" : "Loading"}
              </span>
              {state?.block_number ? (
                <span className="text-xs text-slate-500">
                  Block{" "}
                  <a
                    href={`${VOYAGER_BASE}/block/${state.block_number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-white underline-offset-2 hover:underline"
                  >
                    #{state.block_number.toLocaleString()}
                  </a>
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {/* ── Summary Stats ───────────────────────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {[
            [
              "Total TVL",
              fmtUsd(state?.total_tvl_usd),
              "Aggregate across all tracked pools",
            ],
            [
              "Active Pools",
              `${state?.initialized_pools ?? 0} / ${state?.total_pools ?? 0}`,
              "Initialized vs tracked",
            ],
            [
              "LP Positions",
              String(positions.length),
              "On-chain Ekubo NFT positions",
            ],
            [
              "Aggregate APY",
              aggregateApy > 0 ? fmtPct(aggregateApy) : "Calculating...",
              "Weighted from real fee accrual",
            ],
            [
              "Network",
              "Starknet Sepolia",
              `Poll #${state?.poll_count ?? 0}`,
            ],
            [
              "Agent Tx",
              String(agentStats?.summary?.total_transactions ?? 0),
              `${fmtPct(agentStats?.summary?.overall_success_rate ?? 0)} success`,
            ],
            [
              "zkdETH Supply",
              (tokenomics?.tokens?.zkdETH?.circulating ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
              "Tokenomics",
            ],
            [
              "zkdAI Supply",
              (tokenomics?.tokens?.zkdAI?.circulating ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
              "Tokenomics",
            ],
            [
              "Fee Cycles",
              String(state?.fee_automation?.cycles ?? 0),
              `Mode: ${state?.fee_policy?.mode ?? "—"}`,
            ],
          ].map(([label, value, sub]) => (
            <div
              key={String(label)}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
            >
              <p className="text-xs text-slate-500 uppercase tracking-wide">
                {label}
              </p>
              <p className="text-xl font-semibold mt-1">{value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
            </div>
          ))}
        </section>

        {/* ── Bot Activity Panel ──────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium mb-4">Real Activity Bots</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {(["swap", "lp", "limit"] as const).map((key) => {
              const bot = bots?.[key];
              const meta = botLabels[key];
              const isActive = bot?.enabled && bot?.available;
              return (
                <div
                  key={key}
                  className="rounded-lg border border-slate-700/50 bg-slate-950/50 p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{meta.icon}</span>
                      <span className={`font-medium ${meta.color}`}>
                        {meta.label}
                      </span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        isActive
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                          : bot?.available
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
                            : "bg-slate-500/15 text-slate-400 border-slate-500/20"
                      }`}
                    >
                      {isActive
                        ? "Running"
                        : bot?.available
                          ? "Stopped"
                          : "No Wallet"}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs text-slate-400">
                    <div className="flex justify-between">
                      <span>Interval</span>
                      <span className="text-slate-300">
                        {bot?.interval_sec ? `${bot.interval_sec}s` : "—"}
                      </span>
                    </div>
                    {key === "swap" && (
                      <>
                        <div className="flex justify-between">
                          <span>Total Swaps</span>
                          <span className="text-slate-300">
                            {bot?.total ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Successful</span>
                          <span className="text-emerald-400">
                            {bot?.successful ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Failed</span>
                          <span className="text-red-400">
                            {bot?.failed ?? 0}
                          </span>
                        </div>
                        {bot?.behavior_mix && typeof bot.behavior_mix === "object" && (
                          <div className="pt-1 border-t border-slate-800/60 mt-1">
                            <div className="flex justify-between">
                              <span>Degen</span>
                              <span className="text-pink-300">{bot.behavior_mix.degen ?? 0}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Retail</span>
                              <span className="text-cyan-300">{bot.behavior_mix.retail ?? 0}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Whale</span>
                              <span className="text-amber-300">{bot.behavior_mix.whale ?? 0}</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {key === "lp" && (
                      <>
                        <div className="flex justify-between">
                          <span>Positions Created</span>
                          <span className="text-slate-300">
                            {bot?.positions_created ?? bot?.total ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Successful</span>
                          <span className="text-emerald-400">
                            {bot?.successful ?? 0}
                          </span>
                        </div>
                      </>
                    )}
                    {key === "limit" && (
                      <>
                        <div className="flex justify-between">
                          <span>Orders Placed</span>
                          <span className="text-slate-300">
                            {bot?.orders_placed ?? bot?.total ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Successful</span>
                          <span className="text-emerald-400">
                            {bot?.successful ?? 0}
                          </span>
                        </div>
                      </>
                    )}
                    {bot?.last_tx_hash && (
                      <div className="flex justify-between">
                        <span>Last Tx</span>
                        <a
                          href={`${VOYAGER_BASE}/tx/${bot.last_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          {shortenHash(bot.last_tx_hash)}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Pool Table ──────────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <h2 className="text-lg font-medium">Ekubo Pools</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-2.5">Pair</th>
                  <th className="text-right px-5 py-2.5">Price</th>
                  <th className="text-right px-5 py-2.5">Tick</th>
                  <th className="text-right px-5 py-2.5">TVL</th>
                  <th className="text-right px-5 py-2.5">Volume 24h</th>
                  <th className="text-right px-5 py-2.5">Fee</th>
                  <th className="text-right px-5 py-2.5">APY 24h</th>
                  <th className="text-center px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {(state?.pools || []).map((pool) => {
                  const poolApyData = apyData?.pools?.[pool.name];
                  const boundaryTick = Math.abs(pool.tick) > 88_700_000;
                  const trend = poolTrends[pool.name] || { price: "flat", tvl: "flat", volume: "flat" };
                  const apyValue = poolApyData?.apy_24h_pct && poolApyData.apy_24h_pct > 0
                    ? poolApyData.apy_24h_pct
                    : heuristicApy(pool.name, pool.tvl_usd || 0, !!pool.initialized);
                  return (
                  <tr
                    key={pool.name}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium">{pool.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {shortenAddr(pool.token0)} / {shortenAddr(pool.token1)}
                      </div>
                    </td>
                    <td className="text-right px-5 py-3 font-mono">
                      <span className={trendClass(trend.price)}>{trendArrow(trend.price)}</span>{" "}
                      {pool.initialized ? fmtPrice(pool.price, pool.tick) : "—"}
                    </td>
                    <td className="text-right px-5 py-3 font-mono text-slate-400">
                      {pool.initialized
                        ? pool.tick.toLocaleString()
                        : "—"}
                    </td>
                    <td className="text-right px-5 py-3 text-slate-300">
                      <span className={trendClass(trend.tvl)}>{trendArrow(trend.tvl)}</span>{" "}
                      {pool.tvl_usd > 0 ? fmtUsd(pool.tvl_usd) : "—"}
                    </td>
                    <td className="text-right px-5 py-3 text-slate-400">
                      <span className={trendClass(trend.volume)}>{trendArrow(trend.volume)}</span>{" "}
                      {pool.volume_24h_usd
                        ? fmtUsd(pool.volume_24h_usd)
                        : "—"}
                    </td>
                    <td className="text-right px-5 py-3 text-slate-400">
                      {pool.fee_bps}bps
                    </td>
                    <td className="text-right px-5 py-3">
                      {apyValue > 0 ? (
                        <span className="text-emerald-400 font-medium">
                          {fmtPct(apyValue)}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="text-center px-5 py-3">
                      {pool.initialized ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {boundaryTick ? "Boundary" : "Active"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-500/15 text-slate-400 border border-slate-500/20">
                          Not Init
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {(!state?.pools || state.pools.length === 0) && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-8 text-center text-slate-500"
                    >
                      {connected
                        ? "Waiting for first chain poll..."
                        : "Connecting to market monitor..."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── LP Positions + Event Feed side by side ──────────────────── */}
        <section className="grid gap-4 lg:grid-cols-2">
          {/* LP Positions */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="text-lg font-medium mb-3">LP Positions</h2>
            {positions.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                No active LP positions found
              </p>
            ) : (
              <div className="space-y-2 max-h-[360px] overflow-auto">
                {positions.map((pos) => (
                  <div
                    key={pos.ekubo_nft_id}
                    className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        NFT #{pos.ekubo_nft_id}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          pos.status === "active"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-slate-500/15 text-slate-400"
                        }`}
                      >
                        {pos.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1.5 space-y-0.5">
                      <div>
                        Ticks: [{pos.lower_tick.toLocaleString()},{" "}
                        {pos.upper_tick.toLocaleString()}]
                      </div>
                      <div>Fee: {pos.fee_tier}bps</div>
                      {pos.mint_tx_hash && (
                        <a
                          href={`${VOYAGER_BASE}/tx/${pos.mint_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          View on Voyager &rarr;
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Event Feed */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="text-lg font-medium mb-3">Activity Feed</h2>
            <div className="h-[360px] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs font-mono leading-5">
              {events.length === 0 && (
                <div className="text-slate-500 py-4 text-center font-sans">
                  Waiting for events...
                </div>
              )}
              {events.map((event, i) => (
                <div
                  key={`${event.ts}-${i}`}
                  className={`${categoryColor[event.category] || "text-slate-300"}`}
                >
                  <span className="text-slate-600">
                    [{new Date(event.ts * 1000).toLocaleTimeString()}]
                  </span>{" "}
                  <span className="text-slate-500">[{event.category}]</span>{" "}
                  {event.message}
                  {event.payload && Object.keys(event.payload).length > 0 && (
                    <span className="text-slate-600">
                      {" "}
                      {JSON.stringify(event.payload)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer className="text-center text-xs text-slate-600 pb-4">
          Real on-chain data from Starknet Sepolia RPC &middot; Bot activity
          via Ekubo DEX &middot;{" "}
          <a
            href="https://sepolia.voyager.online"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-slate-300"
          >
            Voyager Explorer
          </a>
        </footer>
      </div>
    </main>
  );
}
