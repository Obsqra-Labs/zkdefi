"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { toFixed } from "@/lib/format";
import { StreamCard, type StreamItem } from "./StreamCard";
import { OracleDashboardStrip } from "./OracleDashboardStrip";
import { useRiskProfileV2 } from "@/hooks/useProfile";
import { getExecutionGate, getGovernancePower, getLendingGate } from "@/lib/trust/adapters";
import { isTrustSurfaceWiringEnabled } from "@/lib/trust/flags";

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
  const trustSurfaceWiringEnabled = isTrustSurfaceWiringEnabled();
  const [items, setItems] = useState<StreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);
  const { profile: trustProfile } = useRiskProfileV2(
    trustSurfaceWiringEnabled ? address : undefined
  );
  const executionGate = useMemo(
    () =>
      trustSurfaceWiringEnabled
        ? getExecutionGate(trustProfile)
        : { mode: "allow" as const, reasons: [], limits: {} },
    [trustSurfaceWiringEnabled, trustProfile]
  );
  const lendingGate = useMemo(
    () =>
      trustSurfaceWiringEnabled
        ? getLendingGate(trustProfile)
        : { mode: "allow" as const, reasons: [], limits: {} },
    [trustSurfaceWiringEnabled, trustProfile]
  );
  const governance = useMemo(
    () => getGovernancePower(trustProfile),
    [trustProfile]
  );

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
      const normalized = (fetched ?? []).map((i) => ({
        ...i,
        actions: Array.isArray(i?.actions) ? i.actions : [],
      }));
      setItems(normalized);
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
      const normalized = (fetched ?? []).map((i) => ({
        ...i,
        actions: Array.isArray(i?.actions) ? i.actions : [],
      }));
      setItems(normalized);
    } catch {
      setItems([]);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleAction = useCallback(
    (action: string, itemId: string) => {
      if (
        trustSurfaceWiringEnabled &&
        action === "deploy" &&
        executionGate.mode === "block"
      ) {
        return;
      }
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
    [
      trustSurfaceWiringEnabled,
      executionGate.mode,
      onDeploy,
      onOpenGovernance,
      onOpenCircuitBoard,
      onOpenZkRag,
    ]
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
      {/* Oracle Dashboard Strip */}
      <OracleDashboardStrip address={address} onDeploy={onDeploy} />

      {trustSurfaceWiringEnabled ? (
        <div className="flex-shrink-0 px-2 py-1 border-b border-zinc-800 bg-zinc-900/60 text-[10px] text-zinc-400">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              execution:{" "}
              <span className="text-zinc-200 uppercase">{executionGate.mode}</span>
            </span>
            <span>
              lending: <span className="text-zinc-200 uppercase">{lendingGate.mode}</span>
            </span>
            <span>
              governance:{" "}
              <span className="text-zinc-200">{toFixed(governance.votingPower, 2)} vp</span>
            </span>
            {executionGate.reasons.length ? (
              <span className="truncate">
                reason: <span className="text-zinc-300">{executionGate.reasons.join(", ")}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Filter bar */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-zinc-800 flex items-center gap-2">
        <div className="flex gap-1 overflow-x-auto flex-1 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex-shrink-0 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                filter === f.id
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Search */}
        <div className="relative flex-shrink-0 w-36">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-6 pr-2 py-1 rounded bg-zinc-800/60 border border-zinc-700/50 text-zinc-200 text-[11px] placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />
        </div>
      </div>

      {/* Stream content */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
          </div>
        ) : dateGroups.length === 0 ? (
          <div className="py-10 text-center text-zinc-600 text-xs">
            No items in stream
          </div>
        ) : (
          dateGroups.map(([label, groupItems]) => (
            <section key={label}>
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">
                  {label}
                </span>
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-[9px] text-zinc-700">{groupItems.length}</span>
              </div>
              <div className="space-y-0.5">
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
