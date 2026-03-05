"use client";

import { useEffect, useState } from "react";
import { Sparkles, CheckCircle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { API_BASE } from "@/lib/api/client";

interface ProviderStatus {
  provider_id: string;
  name: string;
  type: string;
  model: string;
  active: boolean;
  healthy: boolean;
  latency_ms: number | null;
  error: string | null;
}

export function LLMProviderHealth() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/llm/providers`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setProviders(Array.isArray(data?.providers) ? data.providers : []);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check providers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const activeProvider = providers.find((p) => p.provider_id === "onyx" && p.healthy);

  return (
    <div className="glass rounded-xl border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          LLM Provider Status
        </h3>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 mb-3">Error: {error}</div>
      )}

      {/* Active provider highlight */}
      {activeProvider && (
        <div className="mb-3 p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/30">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">
              {activeProvider.name} — Active
            </span>
          </div>
          <p className="text-[10px] text-zinc-400 mt-1 ml-6">
            Model: {activeProvider.model} · {activeProvider.latency_ms}ms ·{" "}
            {activeProvider.type === "openai_compatible" ? "OpenAI API" : activeProvider.type}
          </p>
        </div>
      )}

      {/* All providers grid */}
      <div className="space-y-1.5">
        {loading && providers.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Pinging providers…
          </div>
        )}
        {providers.map((p) => (
          <div
            key={p.provider_id}
            className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-800"
          >
            <div className="flex items-center gap-2">
              {p.healthy ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-400" />
              )}
              <span className="text-xs font-medium text-zinc-300">{p.name}</span>
              {p.provider_id === "onyx" && (
                <span className="text-[9px] bg-amber-500/15 text-amber-300 px-1 py-0.5 rounded">PRIMARY</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              <span>{p.model || "—"}</span>
              {p.latency_ms !== null && (
                <span className={p.latency_ms < 500 ? "text-emerald-400" : p.latency_ms < 2000 ? "text-amber-400" : "text-red-400"}>
                  {p.latency_ms}ms
                </span>
              )}
              {p.error && (
                <span className="text-red-400 truncate max-w-[120px]" title={p.error}>
                  {p.error}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {lastChecked && (
        <p className="text-[10px] text-zinc-600 mt-3 text-right">Last checked: {lastChecked}</p>
      )}
    </div>
  );
}
