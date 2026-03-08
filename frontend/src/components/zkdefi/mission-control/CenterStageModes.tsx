"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { UnifiedStream } from "./UnifiedStream";
import { GovernanceOverlay } from "./GovernanceOverlay";

type CenterMode = "intelligence" | "execution_flow" | "memory_lane" | "governance";

interface CenterStageModesProps {
  address: string | undefined;
  onDeploy?: (opportunityId: string) => void;
  onOpenGovernance?: () => void;
  onOpenCircuitBoard?: () => void;
  onOpenZkRag?: () => void;
}

const MODES: Array<{ id: CenterMode; label: string }> = [
  { id: "intelligence", label: "Intelligence" },
  { id: "execution_flow", label: "Execution Flow" },
  { id: "memory_lane", label: "Memory Lane" },
  { id: "governance", label: "Governance" },
];

export function CenterStageModes(props: CenterStageModesProps) {
  const [mode, setMode] = useState<CenterMode>("intelligence");

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/40 px-2 py-1.5 flex items-center gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              mode === m.id ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        {mode === "intelligence" && <UnifiedStream {...props} />}
        {mode === "execution_flow" && <ExecutionFlowPanel address={props.address} />}
        {mode === "memory_lane" && <MemoryLaneForensicPanel address={props.address} />}
        {mode === "governance" && (
          <GovernanceOverlay
            address={props.address}
            onClose={() => setMode("intelligence")}
          />
        )}
      </div>
    </div>
  );
}

function ExecutionFlowPanel({ address }: { address: string | undefined }) {
  const [loading, setLoading] = useState(true);
  const [steps, setSteps] = useState<Record<string, any>>({});
  const [timestamp, setTimestamp] = useState<string>("");

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const data = await apiFetch<any>(`/api/v1/zkdefi/mc/execution/current/${address}`);
      setSteps(data?.steps || {});
      setTimestamp(data?.timestamp || "");
    } catch {
      setSteps({});
      setTimestamp("");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (!address) {
    return <div className="p-4 text-zinc-500 text-sm">Connect wallet to view execution flow.</div>;
  }
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const ordered = ["intent", "policy", "proof_package", "agent", "strategy", "execution", "receipt"];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {ordered.map((key, idx) => {
        const step = steps?.[key] || {};
        const status = String(step.status || "pending");
        const color =
          status === "complete"
            ? "bg-emerald-500"
            : status === "failed"
              ? "bg-red-500"
              : status === "waiting"
                ? "bg-amber-500"
                : "bg-zinc-600";
        return (
          <div key={key} className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
              <span className="text-xs uppercase tracking-wide text-zinc-500">Step {idx + 1}</span>
              <span className="text-sm font-medium text-zinc-200">{key.replace("_", " ")}</span>
            </div>
            <pre className="mt-2 text-xs text-zinc-400 whitespace-pre-wrap break-all">
              {JSON.stringify(step, null, 2)}
            </pre>
          </div>
        );
      })}
      {timestamp && <div className="text-xs text-zinc-600">Updated: {new Date(timestamp).toLocaleString()}</div>}
    </div>
  );
}

function MemoryLaneForensicPanel({ address }: { address: string | undefined }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [forensicId, setForensicId] = useState<string | null>(null);
  const [forensic, setForensic] = useState<any | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const data = await apiFetch<any>(`/api/v1/zkdefi/mc/receipts/timeline/${address}?limit=150&type=all`);
      const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
      const flattened: any[] = [];
      for (const group of timeline) {
        const receipts = Array.isArray(group?.receipts) ? group.receipts : [];
        flattened.push(...receipts);
      }
      setRows(flattened);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const openForensic = useCallback(async (receiptId: string) => {
    setForensicId(receiptId);
    setForensic(null);
    try {
      const detail = await apiFetch<any>(`/api/v1/zkdefi/mc/receipts/${receiptId}`);
      setForensic(detail);
    } catch {
      setForensic({ error: "Unable to load forensic receipt detail." });
    }
  }, []);

  const filtered = useMemo(() => {
    let out = rows;
    if (typeFilter !== "all") out = out.filter((r) => String(r?.type || "").toLowerCase() === typeFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((r) => String(r?.receipt_id || "").toLowerCase().includes(q));
    }
    return out;
  }, [rows, query, typeFilter]);

  if (!address) {
    return <div className="p-4 text-zinc-500 text-sm">Connect wallet to view memory lane.</div>;
  }

  return (
    <div className="h-full min-h-0 relative">
      <div className="h-full overflow-y-auto p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative w-64 max-w-full">
            <Search className="w-3 h-3 text-zinc-600 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search receipt ID"
              className="w-full pl-6 pr-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs"
          >
            <option value="all">All</option>
            <option value="gate">Gate</option>
            <option value="execute">Execute</option>
            <option value="deposit">Deposit</option>
            <option value="warning">Warning</option>
          </select>
        </div>

        {loading ? (
          <div className="h-32 flex items-center justify-center text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-zinc-600 text-sm py-6 text-center">No receipts.</div>
        ) : (
          filtered.map((r) => {
            const id = String(r?.receipt_id || "");
            const isExpanded = expanded === id;
            return (
              <div key={id} className="rounded border border-zinc-800 bg-zinc-900/40">
                <button
                  onClick={() => setExpanded(isExpanded ? null : id)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs text-zinc-500">{new Date(String(r?.timestamp || "")).toLocaleString()}</div>
                    <div className="text-sm text-zinc-100">{String(r?.intent_summary || "Receipt")}</div>
                    <div className="text-[11px] text-zinc-500">{id}</div>
                  </div>
                  <span className="text-xs text-zinc-400">{String(r?.gate_status || "pending")}</span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2">
                    <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all">
                      {JSON.stringify(r, null, 2)}
                    </pre>
                    <button
                      onClick={() => openForensic(id)}
                      className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
                    >
                      Open Forensic Drawer
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {forensicId && (
        <div className="absolute inset-y-0 right-0 w-full max-w-xl border-l border-zinc-800 bg-zinc-950/95 backdrop-blur p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-zinc-200 font-medium">Forensic: {forensicId}</div>
            <button
              onClick={() => {
                setForensicId(null);
                setForensic(null);
              }}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all overflow-auto h-[calc(100%-2rem)]">
            {forensic ? JSON.stringify(forensic, null, 2) : "Loading..."}
          </pre>
        </div>
      )}
    </div>
  );
}
