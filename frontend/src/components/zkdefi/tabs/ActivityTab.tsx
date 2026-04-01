"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Loader2, ExternalLink, AlertCircle, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { StreamCard, type StreamItem } from "../mission-control/StreamCard";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";

const INITIAL_LIMIT = 30;
const LOAD_MORE_INCREMENT = 30;
const POLL_MS = 15_000;

const FILTERS = [
  { id: "receipt", label: "Receipts" },
  { id: "all", label: "All Events" },
  { id: "decision", label: "Decisions" },
  { id: "privacy", label: "Proofs" },
  { id: "deposit", label: "Deposits" },
  { id: "governance", label: "Votes" },
] as const;

const OPPORTUNITY_TYPES = new Set(["opportunity", "lending", "staking"]);

interface StreamResponse {
  address: string;
  items: StreamItem[];
  count: number;
}

function dateGroupLabel(iso: string): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const item = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - item.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function truncHash(h: string) {
  if (!h) return "";
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

function sortStreamItems(items: StreamItem[], activeFilter: string): StreamItem[] {
  const typeRank: Record<string, number> = {
    receipt: 0,
    privacy: 1,
    decision: 2,
    deposit: 3,
    governance: 4,
  };

  return [...items].sort((a, b) => {
    const at = new Date(a.timestamp).getTime() || 0;
    const bt = new Date(b.timestamp).getTime() || 0;

    // Receipt-first ordering only when user is in mixed view.
    if (activeFilter === "all") {
      const ar = typeRank[a.type] ?? 99;
      const br = typeRank[b.type] ?? 99;
      if (ar !== br) return ar - br;
    }

    return bt - at;
  });
}

export function ActivityTab({ address }: { address: string }) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("receipt");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchStream = useCallback(
    async (lim: number) => {
      const typesParam = filter === "all" ? "all" : filter;
      const data = await apiFetch<StreamResponse>(
        `/api/v1/zkdefi/mc/stream/${address}?types=${typesParam}&limit=${lim}&offset=0`,
      );
      return (data.items ?? [])
        .filter((i) => !OPPORTUNITY_TYPES.has(i.type))
        .map((i) => ({
          ...i,
          actions: Array.isArray(i?.actions) ? i.actions : [],
        }));
    },
    [address, filter],
  );

  const load = useCallback(
    async (lim = limit) => {
      try {
        setError(null);
        const fetched = await fetchStream(lim);
        setItems(fetched);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load activity");
        setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [fetchStream, limit],
  );

  useEffect(() => {
    setLoading(true);
    setLimit(INITIAL_LIMIT);
    load(INITIAL_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, filter]);

  useEffect(() => {
    const t = setInterval(() => load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const handleLoadOlder = async () => {
    setLoadingMore(true);
    const next = limit + LOAD_MORE_INCREMENT;
    setLimit(next);
    await load(next);
  };

  const filtered = useMemo(() => {
    const sorted = sortStreamItems(items, filter);
    if (!search.trim()) return sorted;
    const q = search.trim().toLowerCase();
    return sorted.filter(
      (i) =>
        i.title?.toLowerCase().includes(q) ||
        i.subtitle?.toLowerCase().includes(q) ||
        i.id?.toLowerCase().includes(q) ||
        Object.values(i.hashes ?? {}).some((h) => h?.toLowerCase().includes(q)),
    );
  }, [filter, items, search]);

  const receiptCount = useMemo(
    () => items.filter((i) => i.type === "receipt").length,
    [items],
  );

  const groups = useMemo(() => {
    const map: Record<string, StreamItem[]> = {};
    for (const item of filtered) {
      const label = dateGroupLabel(item.timestamp);
      (map[label] ??= []).push(item);
    }
    return Object.entries(map);
  }, [filtered]);

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <p className="text-sm text-zinc-400">{error}</p>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="px-3 py-1.5 text-xs rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1.5"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-3 pt-2 pb-1 text-[11px] text-zinc-500">
        History is receipt-first. Showing {receiptCount} verified receipts out of {items.length} events.
      </div>

      {/* Filter bar + search */}
      <div className="flex-shrink-0 px-3 py-1.5 border-b border-zinc-800 flex items-center gap-1.5">
        <div className="flex gap-1 overflow-x-auto flex-1 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                filter === f.id
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-shrink-0 w-40">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-6 pr-2 py-1 rounded bg-zinc-800/60 border border-zinc-700/50 text-zinc-200 text-[11px] placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />
        </div>
      </div>

      {/* Stream content */}
      <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-2.5">
        {groups.length === 0 ? (
          <div className="py-16 text-center text-zinc-600 text-xs space-y-2">
            <p>No receipts yet</p>
            <p className="text-zinc-700">Receipt events will appear here first as you execute plans, then supporting decisions, proofs, and votes.</p>
          </div>
        ) : (
          groups.map(([label, groupItems]) => (
            <section key={label}>
              <div className="flex items-center gap-2 mb-0.5 px-1">
                <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">
                  {label}
                </span>
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-[9px] text-zinc-700">{groupItems.length}</span>
              </div>
              <div className="space-y-0.5">
                {groupItems.map((item) => (
                  <div key={item.id}>
                    <StreamCard item={item} />
                    {item.hashes && Object.keys(item.hashes).length > 0 && (
                      <div className="flex flex-wrap gap-2 px-3 pb-1.5 -mt-0.5">
                        {Object.entries(item.hashes).map(([key, hash]) =>
                          hash ? (
                            <a
                              key={key}
                              href={sepoliaStarkscanTxUrl(hash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-cyan-400 transition-colors"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              <span className="capitalize">{key}:</span>
                              <code className="font-mono">{truncHash(hash)}</code>
                            </a>
                          ) : null,
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {items.length > 0 && items.length >= limit && (
          <div className="pt-2 pb-4">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingMore}
              className="w-full py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                </>
              ) : (
                "Load older"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
