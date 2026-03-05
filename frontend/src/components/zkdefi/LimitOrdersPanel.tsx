"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "@starknet-react/core";
import {
  ArrowDownUp,
  Clock,
  Hash,
  Plus,
  RefreshCw,
  Shield,
  Target,
  X,
} from "lucide-react";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";

import { API_BASE, apiFetch } from "@/lib/api/client";

/* ── Known token map (Sepolia / Mainnet) ─────────────────────────────────── */
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": { symbol: "ETH", decimals: 18 },
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": { symbol: "STRK", decimals: 18 },
  "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": { symbol: "USDC", decimals: 6 },
  "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": { symbol: "fUSDC", decimals: 6 },
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": { symbol: "USDC", decimals: 6 },
  "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8": { symbol: "USDT", decimals: 6 },
};

function tokenSymbol(addr: string | undefined | null): string {
  if (!addr) return "???";
  const n = addr.toLowerCase();
  return KNOWN_TOKENS[n]?.symbol ?? `${n.slice(0, 6)}…${n.slice(-4)}`;
}

function tokenDecimals(addr: string | undefined | null): number {
  if (!addr) return 18;
  return KNOWN_TOKENS[addr.toLowerCase()]?.decimals ?? 18;
}

/** Derive a human-readable amount from raw wei + token address. */
function fromWei(wei: number | string | undefined | null, tokenAddr: string | undefined | null): number {
  const raw = Number(wei ?? 0);
  if (!raw || !isFinite(raw)) return 0;
  return raw / 10 ** tokenDecimals(tokenAddr);
}

/* ── API response shape (matches backend) ────────────────────────────────── */
interface RawLimitOrder {
  order_id: number | string | null;
  sell_token: string;
  buy_token: string;
  amount_wei: number;
  limit_tick: number;
  status: string;
  tx_hash: string | null;
  created_at: string | null;
  filled_at: string | null;
  cancelled_at: string | null;
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function LimitOrdersPanel() {
  const { address } = useAccount();
  const [orders, setOrders] = useState<RawLimitOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Create-form state
  const [pair, setPair] = useState("STRK/ETH");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [limitTick, setLimitTick] = useState("");
  const [amount, setAmount] = useState("");

  /* Derive sell/buy tokens from pair + side */
  const pairTokens: Record<string, [string, string]> = useMemo(
    () => ({
      "STRK/ETH": [
        "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      ],
      "ETH/USDC": [
        "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
      ],
      "STRK/USDC": [
        "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
      ],
    }),
    [],
  );

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ active_orders?: RawLimitOrder[] }>("/api/v1/strategies/limit-orders/active");
      setOrders(data.active_orders ?? []);
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchOrders(); }, [fetchOrders]);
  useVisibilityPolling(() => void fetchOrders(), 30_000, [fetchOrders]);

  const handleCreate = async () => {
    if (!address || !limitTick || !amount) return;
    const tokens = pairTokens[pair];
    if (!tokens) return;

    // side="buy" means buying base → selling quote → sell_token is tokens[1]
    const [sellToken, buyToken] =
      side === "buy" ? [tokens[1], tokens[0]] : [tokens[0], tokens[1]];

    const decimals = tokenDecimals(sellToken);
    const amountWei = Math.round(parseFloat(amount) * 10 ** decimals);

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/limit-orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wallet-Address": address,
        },
        body: JSON.stringify({
          user_address: address,
          sell_token: sellToken,
          buy_token: buyToken,
          amount_wei: amountWei,
          limit_tick: parseInt(limitTick, 10),
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setLimitTick("");
        setAmount("");
        void fetchOrders();
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateError(
          typeof data?.detail === "string" ? data.detail : `Error ${res.status}`,
        );
      }
    } catch {
      setCreateError("Connection error");
    } finally {
      setCreating(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "open":
        return "text-cyan-400 border-cyan-700/40 bg-cyan-950/40";
      case "partial":
        return "text-amber-400 border-amber-700/40 bg-amber-950/40";
      case "filled":
        return "text-emerald-400 border-emerald-700/40 bg-emerald-950/40";
      case "cancelled":
        return "text-zinc-500 border-zinc-700 bg-zinc-900/40";
      default:
        return "text-zinc-500 border-zinc-700 bg-zinc-900/40";
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-700/30">
            <Target className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Limit Orders</h3>
            <p className="text-[10px] text-zinc-500">Ekubo concentrated LP fills</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors border-violet-700/50 text-violet-300 hover:bg-violet-900/30 active:bg-violet-900/50"
          >
            {showCreate ? (
              <X className="w-3.5 h-3.5" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {showCreate ? "Cancel" : "New Order"}
          </button>
          <button
            type="button"
            onClick={() => void fetchOrders()}
            className="p-1.5 rounded-lg border border-zinc-700/60 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
            title="Refresh orders"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Limit orders use commit-reveal: your target price and size are committed as a hash. The order fills privately — other traders cannot front-run your limit.
        </span>
      </div>

      {/* ── Summary bar ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Open Orders", value: orders.filter((o) => o.status === "open").length, color: "text-cyan-400" },
          { label: "Filled", value: orders.filter((o) => o.status === "filled").length, color: "text-emerald-400" },
          { label: "Total", value: orders.length, color: "text-zinc-200" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2.5 text-center"
          >
            <p className={`text-lg font-semibold font-mono ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Create Order Form ───────────────────────────────────────────── */}
      {showCreate && (
        <div className="rounded-xl border border-violet-700/30 bg-gradient-to-b from-violet-950/20 to-zinc-900/40 p-5 space-y-4">
          <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
            Create Limit Order
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {/* Pair */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Pair</label>
              <select
                value={pair}
                onChange={(e) => setPair(e.target.value)}
                className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:border-violet-600 focus:ring-1 focus:ring-violet-600/30 outline-none transition-colors"
              >
                {Object.keys(pairTokens).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            {/* Side */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Side</label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setSide("buy")}
                  className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    side === "buy"
                      ? "border-emerald-600 bg-emerald-600/20 text-emerald-400"
                      : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setSide("sell")}
                  className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    side === "sell"
                      ? "border-rose-600 bg-rose-600/20 text-rose-400"
                      : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  Sell
                </button>
              </div>
            </div>
            {/* Tick */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Limit Tick</label>
              <input
                type="number"
                step="1"
                placeholder="e.g. -84000"
                value={limitTick}
                onChange={(e) => setLimitTick(e.target.value)}
                className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:border-violet-600 focus:ring-1 focus:ring-violet-600/30 outline-none transition-colors"
              />
              <p className="text-[9px] text-zinc-600 mt-1">Ekubo tick index for the fill price</p>
            </div>
            {/* Amount */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Amount ({side === "buy" ? pair.split("/")[1] : pair.split("/")[0]})
              </label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:border-violet-600 focus:ring-1 focus:ring-violet-600/30 outline-none transition-colors"
              />
            </div>
          </div>
          {createError && (
            <div className="rounded-lg border border-rose-700/40 bg-rose-950/30 px-3 py-2">
              <p className="text-xs text-rose-400">{createError}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !address || !limitTick || !amount}
            className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-sm font-medium transition-all"
          >
            {creating ? "Submitting…" : `Place ${side.toUpperCase()} Limit Order`}
          </button>
          <p className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-1">
            <Shield className="w-3 h-3 text-emerald-500/60" />
            Order intent is hashed before submission · revealed only at fill time
          </p>
          {!address && (
            <p className="text-[10px] text-zinc-500 text-center">
              Connect wallet to create orders
            </p>
          )}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 text-amber-300 text-xs px-4 py-2.5">
          {error}
        </div>
      )}

      {/* ── Orders List ─────────────────────────────────────────────────── */}
      {orders.length > 0 ? (
        <div className="space-y-3">
          {orders.map((order, idx) => {
            const sellSym = tokenSymbol(order.sell_token);
            const buySym = tokenSymbol(order.buy_token);
            const humanAmount = fromWei(order.amount_wei, order.sell_token);
            const isFilled = order.status === "filled";
            const isCancelled = order.status === "cancelled";

            return (
              <div
                key={order.order_id ?? `order-${idx}`}
                className={`rounded-xl border p-4 transition-colors ${
                  isFilled
                    ? "border-emerald-800/40 bg-emerald-950/10"
                    : isCancelled
                      ? "border-zinc-800/40 bg-zinc-900/30 opacity-60"
                      : "border-zinc-800/60 bg-zinc-900/50 hover:border-zinc-700/60"
                }`}
              >
                {/* Row 1: pair + status */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ArrowDownUp className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-sm font-semibold text-zinc-100">
                      {sellSym}
                    </span>
                    <span className="text-[10px] text-zinc-600">→</span>
                    <span className="text-sm font-semibold text-zinc-100">
                      {buySym}
                    </span>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 text-[10px] rounded-full border font-medium uppercase tracking-wider ${statusBadge(order.status)}`}
                  >
                    {order.status}
                  </span>
                </div>

                {/* Row 2: data grid */}
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-zinc-500 block mb-0.5">Selling</span>
                    <p className="text-zinc-200 font-mono font-medium">
                      {humanAmount > 0 ? humanAmount.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
                      <span className="text-zinc-500 ml-1 text-[10px]">{sellSym}</span>
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500 block mb-0.5">Limit Tick</span>
                    <p className="text-zinc-200 font-mono font-medium">
                      {order.limit_tick != null ? order.limit_tick.toLocaleString() : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500 block mb-0.5">Tx</span>
                    <p className="text-zinc-400 font-mono text-[11px] truncate" title={order.tx_hash ?? ""}>
                      {order.tx_hash
                        ? order.tx_hash.length > 14
                          ? `${order.tx_hash.slice(0, 8)}…${order.tx_hash.slice(-4)}`
                          : order.tx_hash
                        : "—"}
                    </p>
                  </div>
                </div>

                {/* Row 3: timestamps */}
                <div className="flex items-center gap-3 mt-2.5 text-[10px] text-zinc-600">
                  {order.created_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(order.created_at).toLocaleString()}
                    </span>
                  )}
                  {order.filled_at && (
                    <span className="text-emerald-600">
                      Filled {new Date(order.filled_at).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : !loading ? (
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-10 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-zinc-800/60 mx-auto mb-3">
            <Target className="w-6 h-6 text-zinc-600" />
          </div>
          <p className="text-sm text-zinc-400 font-medium">No active limit orders</p>
          <p className="text-xs text-zinc-600 mt-1.5 max-w-xs mx-auto">
            Create a limit order to place a narrow LP position at your target price.
            The AI engine fills it automatically when the market crosses.
          </p>
        </div>
      ) : null}

      {/* ── How It Works ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/40 bg-zinc-900/20 p-4">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          How Limit Orders Work
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs text-zinc-400">
          <div className="space-y-1">
            <p className="text-zinc-300 font-medium">1. Set a Tick Target</p>
            <p>
              Choose an Ekubo tick and the system creates a narrow LP range around it.
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-zinc-300 font-medium">2. Earn While Waiting</p>
            <p>
              Your position earns LP fees while waiting for the market to reach your price.
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-zinc-300 font-medium">3. Auto-Fill</p>
            <p>
              When price crosses your range, the order fills and you receive the target token.
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-zinc-300 font-medium">4. Privacy Layer</p>
            <p>
              Your order parameters are committed as a Pedersen hash. The matching engine verifies the commitment at fill time — no price or size leakage before execution.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
