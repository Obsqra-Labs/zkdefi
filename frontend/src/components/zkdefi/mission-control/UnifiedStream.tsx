"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { StreamCard, type StreamItem } from "./StreamCard";

const POLL_INTERVAL_MS = 15000;
const INITIAL_LIMIT = 30;
const LOAD_MORE_INCREMENT = 30;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "receipt", label: "Receipts" },
  { id: "decision", label: "Decisions" },
  { id: "opportunity", label: "Opportunities" },
  { id: "privacy", label: "Privacy" },
  { id: "governance", label: "Governance" },
  { id: "lending", label: "Lending" },
  { id: "staking", label: "Staking" },
] as const;

interface StreamResponse {
  address: string;
  items: StreamItem[];
  count: number;
  timestamp?: string;
}

interface UnifiedStreamProps {
  address: string | undefined;
  onDeploy?: (opportunityId: string) => void;
  onOpenGovernance?: () => void;
  onOpenCircuitBoard?: () => void;
  onOpenZkRag?: () => void;
}

function getDateGroupLabel(isoDate: string): string {
  if (!isoDate) return "Unknown";
  const d = new Date(isoDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - itemDate.getTime()) / 86400000);
  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "YESTERDAY";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function UnifiedStream({
  address,
  onDeploy,
  onOpenGovernance,
  onOpenCircuitBoard,
  onOpenZkRag,
}: UnifiedStreamProps) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchStream = useCallback(async (limitToUse: number): Promise<StreamItem[]> => {
    if (!address) return [];
    const typesParam = filter === "all" ? "all" : filter;
    const data = await apiFetch<StreamResponse>(
      `/api/v1/zkdefi/mc/stream/${address}?types=${typesParam}&limit=${limitToUse}`
    );
    return data.items ?? [];
  }, [address, filter]);

  const load = useCallback(async (limitToUse = limit) => {
    if (!address) {
      setLoading(false);
      setItems([]);
      return;
    }
    try {
      const fetched = await fetchStream(limitToUse);
      setItems(fetched);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [address, fetchStream, limit]);

  useEffect(() => {
    setLoading(true);
    setLimit(INITIAL_LIMIT);
    load(INITIAL_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, filter]);

  useEffect(() => {
    if (!address) return;
    const t = setInterval(() => load(), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [address, filter, load]);

  const handleLoadOlder = async () => {
    setLoadingMore(true);
    const newLimit = limit + LOAD_MORE_INCREMENT;
    setLimit(newLimit);
    try {
      const fetched = await fetchStream(newLimit);
      setItems(fetched);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleAction = useCallback(
    (action: string, itemId: string) => {
      if (action === "deploy" && onDeploy) {
        onDeploy(itemId);
      } else if (action === "open_governance" && onOpenGovernance) {
        onOpenGovernance();
      } else if (
        (action === "edit_circuit_board" || action === "view_policy") &&
        onOpenCircuitBoard
      ) {
        onOpenCircuitBoard();
      } else if (action === "query_intelligence" && onOpenZkRag) {
        onOpenZkRag();
      }
    },
    [onDeploy, onOpenGovernance, onOpenCircuitBoard, onOpenZkRag]
  );

  const filteredItems = searchQuery.trim()
    ? items.filter((i) =>
        i.id.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : items;

  const grouped = filteredItems.reduce<Record<string, StreamItem[]>>((acc, item) => {
    const label = getDateGroupLabel(item.timestamp);
    if (!acc[label]) acc[label] = [];
    acc[label].push(item);
    return acc;
  }, {});

  const dateGroups = Object.entries(grouped);

  if (!address) {
    return (
      <div className="p-4 text-center text-zinc-500 text-sm">
        Connect wallet to view stream
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex-shrink-0 p-2 border-b border-zinc-800">
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.id
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search by receipt ID */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by receipt ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700 text-zinc-200 text-xs placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />
        </div>
      </div>

      {/* Stream content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : dateGroups.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-sm">
            No items in stream
          </div>
        ) : (
          dateGroups.map(([label, groupItems]) => (
            <section key={label}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
                  {label}
                </h3>
                <span className="text-[10px] text-zinc-600">
                  {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {groupItems.map((item) => (
                  <StreamCard
                    key={item.id}
                    item={item}
                    onAction={handleAction}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {!loading && items.length > 0 && items.length >= limit && (
          <div className="pt-2">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingMore}
              className="w-full py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading...
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
