"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {Shield, TrendingUp, Activity, ExternalLink, RefreshCw, AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { ProvenanceDisplay, InlineProvenance } from "./ProvenanceDisplay";

interface MarketContext {
  pool_id: string;
  source: "zkrag" | "local_only";
  context_text: string;
  provenance: {
    fact_hash: string;
    block_range: string;
    merkle_root: string;
    source_count: number;
    verified_on_chain: boolean;
  } | null;
  enrichments: Record<string, any>;
  verified: boolean;
}

interface HistoricalPattern {
  pattern_type: string;
  description: string;
  block_range: string;
  confidence: number;
  provenance: {
    fact_hash: string;
    block_range: string;
  } | null;
}

interface ZkGraphHealth {
  available: boolean;
  base_url: string;
  cache_entries: {
    market_context: number;
    historical: number;
  };
  rate_limit: {
    rpm_used: number;
    rpm_limit: number;
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * ZkGraphWidget: Real-time attested intelligence from obsqra proven-index
 * 
 * Shows:
 * - Market context for selected pool (with provenance)
 * - Historical patterns (TVL divergences, volatility spikes)
 * - System health (cache, rate limits)
 * 
 * All data is cryptographically attested with fact hashes registered on-chain.
 */
export function ZkGraphWidget({ 
  poolId = "ekubo_eth_usdc",
  variant = "full"
}: {
  poolId?: string;
  variant?: "full" | "compact";
}) {
  const [health, setHealth] = useState<ZkGraphHealth | null>(null);
  const [context, setContext] = useState<MarketContext | null>(null);
  const [patterns, setPatterns] = useState<HistoricalPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [healthRes, contextRes, patternsRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/v1/zkdefi/zkgraph/health`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${API_BASE}/api/v1/zkdefi/zkgraph/context/${poolId}`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${API_BASE}/api/v1/zkdefi/zkgraph/patterns/general?limit=3`, { signal: AbortSignal.timeout(5000) }),
      ]);

      if (healthRes.status === "fulfilled" && healthRes.value.ok) {
        const data = toRecord(await healthRes.value.json());
        const cacheEntries = toRecord(data.cache_entries);
        const rateLimit = toRecord(data.rate_limit);
        setHealth({
          available: Boolean(data.available),
          base_url: toStringValue(data.base_url),
          cache_entries: {
            market_context: toNumber(cacheEntries.market_context, 0),
            historical: toNumber(cacheEntries.historical, 0),
          },
          rate_limit: {
            rpm_used: toNumber(rateLimit.rpm_used, 0),
            rpm_limit: toNumber(rateLimit.rpm_limit, 0),
          },
        });
      }

      if (contextRes.status === "fulfilled" && contextRes.value.ok) {
        const data = toRecord(await contextRes.value.json());
        const provenance = toRecord(data.provenance);
        const normalizedProvenance =
          typeof provenance.fact_hash === "string"
            ? {
                fact_hash: provenance.fact_hash,
                block_range: toStringValue(provenance.block_range),
                merkle_root: toStringValue(provenance.merkle_root),
                source_count: toNumber(provenance.source_count, 0),
                verified_on_chain: Boolean(provenance.verified_on_chain),
              }
            : null;
        setContext({
          pool_id: toStringValue(data.pool_id, poolId),
          source: data.source === "zkrag" ? "zkrag" : "local_only",
          context_text: toStringValue(data.context_text),
          provenance: normalizedProvenance,
          enrichments: toRecord(data.enrichments),
          verified: Boolean(data.verified),
        });
      }

      if (patternsRes.status === "fulfilled" && patternsRes.value.ok) {
        const data = toRecord(await patternsRes.value.json());
        const rows = Array.isArray(data.patterns) ? data.patterns : [];
        const normalized = rows
          .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
          .map((row) => {
            const provenance = toRecord(row.provenance);
            const normalizedProvenance =
              typeof provenance.fact_hash === "string"
                ? {
                    fact_hash: provenance.fact_hash,
                    block_range: toStringValue(provenance.block_range),
                  }
                : null;
            return {
              pattern_type: toStringValue(row.pattern_type, "pattern"),
              description: toStringValue(row.description, "No description available."),
              block_range: toStringValue(row.block_range),
              confidence: toNumber(row.confidence, 0),
              provenance: normalizedProvenance,
            };
          });
        setPatterns(normalized);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zkGraph data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every 60s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  if (variant === "compact") {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border border-emerald-500/20 bg-gradient-to-r from-emerald-900/20 to-emerald-800/20 px-3 py-2"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-xs text-emerald-300 truncate">
              {context && context.source === "zkrag" ? (
                `Attested: blocks ${context.provenance?.block_range}`
              ) : (
                "zkGraph: Available"
              )}
            </span>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-900/20 via-slate-900/50 to-slate-900/50 p-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-base font-semibold text-white">zkGraph Intelligence</h3>
            <p className="text-[10px] text-zinc-500">Attested on-chain data from obsqra</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-lg border border-zinc-700/50 bg-zinc-800/30 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600/50 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* System Health */}
      {health && (
        <div className="mb-4 rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-zinc-400">System Status</span>
            <span className={`font-medium ${health.available ? "text-emerald-400" : "text-amber-400"}`}>
              {health.available ? "Available" : "Disabled"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Cache:</span>
              <span className="text-zinc-300">
                {health.cache_entries.market_context + health.cache_entries.historical} entries
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Rate:</span>
              <span className="text-zinc-300">
                {health.rate_limit.rpm_used}/{health.rate_limit.rpm_limit} RPM
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Market Context */}
      {context && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-medium text-white">Market Context</h4>
            {context.source === "zkrag" && context.provenance && (
              <InlineProvenance provenance={context.provenance} />
            )}
          </div>
          
          {context.source === "zkrag" && context.context_text ? (
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-300">
              <p className="leading-relaxed">{context.context_text}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80">
              Local data only • No attested intelligence available
            </div>
          )}

          {context.source === "zkrag" && context.provenance && (
            <div className="mt-2">
              <ProvenanceDisplay 
                provenance={context.provenance} 
                variant="compact"
              />
            </div>
          )}
        </div>
      )}

      {/* Historical Patterns */}
      {patterns.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h4 className="text-sm font-medium text-white">Historical Patterns</h4>
          </div>
          <div className="space-y-2">
            {patterns.map((pattern, i) => (
              <div 
                key={i}
                className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-zinc-300">
                    {pattern.pattern_type}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300">
                    {(pattern.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {pattern.description}
                </p>
                {pattern.provenance && (
                  <div className="mt-1 text-[10px] text-zinc-500">
                    Blocks: {pattern.provenance.block_range}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer link */}
      <div className="mt-4 pt-3 border-t border-zinc-700/50">
        <a
          href="https://starknet.obsqra.fi/zkgraph"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <span>View full zkGraph dashboard</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </motion.div>
  );
}

/**
 * ZkGraphBadge: Minimal status indicator for navbar/header
 */
export function ZkGraphBadge() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/zkdefi/zkgraph/health`, { signal: AbortSignal.timeout(3000) })
      .then(res => res.json())
      .then(data => setAvailable(data.available))
      .catch(() => setAvailable(false));
  }, []);

  if (!available) return null;

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">
      <Shield className="w-2.5 h-2.5" />
      <span>Attested</span>
    </div>
  );
}
