"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { TokenInfo } from "@/types/ekubo";

/* ── Constants ─────────────────────────────────────────────────────── */

const SEPOLIA_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const SEPOLIA_USDC = "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080";
const SEPOLIA_FUSDC = "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23";
const SEPOLIA_ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const POPULAR_ADDRESSES = [SEPOLIA_ETH, SEPOLIA_STRK, SEPOLIA_USDC, SEPOLIA_FUSDC];

type TokenMeta = { symbol: string; decimals: number };

const KNOWN_TOKENS: Record<string, TokenMeta> = {
  [SEPOLIA_STRK.toLowerCase()]: { symbol: "STRK", decimals: 18 },
  [SEPOLIA_USDC.toLowerCase()]: { symbol: "USDC", decimals: 6 },
  [SEPOLIA_FUSDC.toLowerCase()]: { symbol: "fUSDC", decimals: 6 },
  [SEPOLIA_ETH.toLowerCase()]: { symbol: "ETH", decimals: 18 },
};

/* ── Helpers ───────────────────────────────────────────────────────── */

function normalizeAddr(addr: string): string {
  const raw = (addr || "").trim().toLowerCase();
  if (!raw) return "";
  const w = raw.startsWith("0x") ? raw.slice(2) : raw;
  return `0x${w.replace(/^0+/, "") || "0"}`;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

function formatBalance(raw: bigint, decimals: number): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  const padded = frac.toString().padStart(decimals, "0");
  const shown = padded.slice(0, 6).replace(/0+$/, "");
  return shown ? `${whole}.${shown}` : whole.toString();
}

function tokenSymbol(addr: string, tokens: TokenInfo[]): string {
  const known = KNOWN_TOKENS[addr.toLowerCase()];
  if (known) return known.symbol;
  const t = tokens.find((x) => x.address?.toLowerCase() === addr.toLowerCase());
  return t?.symbol ?? t?.name ?? shortAddr(addr);
}

function tokenDecimals(addr: string, tokens: TokenInfo[]): number {
  const known = KNOWN_TOKENS[addr.toLowerCase()];
  if (known) return known.decimals;
  const t = tokens.find((x) => x.address?.toLowerCase() === addr.toLowerCase());
  return typeof t?.decimals === "number" ? t.decimals : 18;
}

/* ── Props ─────────────────────────────────────────────────────────── */

export interface TokenSelectorModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (address: string) => void;
  tokens: TokenInfo[];
  balances?: Record<string, bigint>; // normalized address -> raw balance
  excludeAddress?: string; // hide the other side of the pair
}

/* ── Component ─────────────────────────────────────────────────────── */

export function TokenSelectorModal({
  open,
  onClose,
  onSelect,
  tokens,
  balances = {},
  excludeAddress,
}: TokenSelectorModalProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  /* Build merged token list: known tokens first, then from API */
  const allTokens = useMemo(() => {
    const seen = new Set<string>();
    const out: { address: string; symbol: string; decimals: number; isPopular: boolean; logoUrl?: string }[] = [];

    // Add known tokens first
    for (const addr of POPULAR_ADDRESSES) {
      const norm = normalizeAddr(addr);
      const meta = KNOWN_TOKENS[addr.toLowerCase()];
      if (!meta) continue;
      if (excludeAddress && normalizeAddr(excludeAddress) === norm) continue;
      // Try to find logo_url from API tokens
      const apiToken = tokens.find((t) => t.address && normalizeAddr(t.address) === norm);
      seen.add(norm);
      out.push({ address: addr, symbol: meta.symbol, decimals: meta.decimals, isPopular: true, logoUrl: apiToken?.logo_url });
    }

    // Add API tokens
    for (const t of tokens) {
      if (!t.address) continue;
      const norm = normalizeAddr(t.address);
      if (seen.has(norm)) continue;
      if (excludeAddress && normalizeAddr(excludeAddress) === norm) continue;
      seen.add(norm);
      const known = KNOWN_TOKENS[t.address.toLowerCase()];
      out.push({
        address: t.address,
        symbol: known?.symbol ?? t.symbol ?? t.name ?? shortAddr(t.address),
        decimals: known?.decimals ?? t.decimals ?? 18,
        isPopular: false,
        logoUrl: t.logo_url,
      });
    }

    return out;
  }, [tokens, excludeAddress]);

  /* Filter by search */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTokens;
    return allTokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q),
    );
  }, [allTokens, search]);

  const popular = useMemo(() => filtered.filter((t) => t.isPopular), [filtered]);
  const others = useMemo(() => filtered.filter((t) => !t.isPopular), [filtered]);

  const handleSelect = useCallback(
    (addr: string) => {
      onSelect(addr);
      onClose();
    },
    [onSelect, onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 flex flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-100">Select Token</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search tokens (ETH, STRK, USDC...)"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <p className="text-[10px] text-zinc-600 mt-1 px-1">{allTokens.length} tokens available</p>
        </div>

        {/* Popular chips */}
        {popular.length > 0 && !search && (
          <div className="px-5 pb-2">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Popular</p>
            <div className="flex flex-wrap gap-2">
              {popular.map((t) => (
                <button
                  key={t.address}
                  type="button"
                  onClick={() => handleSelect(t.address)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-800/60 text-sm text-zinc-200 hover:border-emerald-600/40 hover:bg-zinc-800 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 flex items-center justify-center text-[10px] font-bold text-emerald-300">
                    {t.symbol.charAt(0)}
                  </span>
                  {t.symbol}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="mx-5 border-t border-zinc-800" />

        {/* Token list */}
        <div className="overflow-y-auto px-2 py-2" style={{ maxHeight: '40vh', minHeight: '120px' }}>
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-8">No tokens found</p>
          ) : (
            <div className="space-y-0.5">
              {(search ? filtered : [...popular, ...others]).map((t) => {
                const norm = normalizeAddr(t.address);
                const bal = balances[norm];
                return (
                  <button
                    key={t.address}
                    type="button"
                    onClick={() => handleSelect(t.address)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-zinc-800/70 transition-colors group"
                  >
                    {/* Icon */}
                    {t.logoUrl ? (
                      <img
                        src={t.logoUrl}
                        alt={t.symbol}
                        className="w-8 h-8 shrink-0 rounded-full border border-zinc-700 group-hover:border-emerald-600/40 transition-colors"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-zinc-700 flex items-center justify-center text-xs font-bold text-emerald-300 group-hover:border-emerald-600/40 transition-colors">
                        {t.symbol.charAt(0)}
                      </div>
                    )}

                    {/* Symbol + address */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-100">{t.symbol}</div>
                      <div className="text-[11px] text-zinc-500 truncate font-mono">{shortAddr(t.address)}</div>
                    </div>

                    {/* Balance */}
                    {bal !== undefined && (
                      <div className="text-right shrink-0">
                        <div className="text-sm text-zinc-300 font-mono">
                          {formatBalance(bal, t.decimals)}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Exports for reuse ─────────────────────────────────────────────── */

export { KNOWN_TOKENS, POPULAR_ADDRESSES, SEPOLIA_STRK, SEPOLIA_USDC, SEPOLIA_FUSDC, SEPOLIA_ETH };
export { normalizeAddr, shortAddr, formatBalance, tokenSymbol, tokenDecimals };
