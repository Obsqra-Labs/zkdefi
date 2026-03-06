"use client";

import { useState, useEffect } from "react";
import { Boxes, Activity, Shield, Zap, Hash, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface L3Health {
  healthy: boolean;
  latest_block: number;
  chain_id: string;
  syncing: boolean;
}

interface ProvingPath {
  id: string;
  name: string;
  available: boolean;
}

interface L3Capabilities {
  proving_paths?: {
    paths?: ProvingPath[];
  };
}

interface L3Stats {
  enabled?: boolean;
  total_registrations?: number;
  total_failures?: number;
}

const PATH_ICONS: Record<string, React.ReactNode> = {
  groth16_garaga: <Shield className="w-3 h-3" />,
  stark_integrity: <Zap className="w-3 h-3" />,
  hash_only: <Hash className="w-3 h-3" />,
};

const PATH_COLORS: Record<string, string> = {
  groth16_garaga: "text-emerald-400",
  stark_integrity: "text-cyan-400",
  hash_only: "text-amber-400",
};

export function ProofChainStrip() {
  const [health, setHealth] = useState<L3Health | null>(null);
  const [paths, setPaths] = useState<ProvingPath[]>([]);
  const [stats, setStats] = useState<L3Stats | null>(null);

  useEffect(() => {
    apiFetch<L3Health>("/api/v1/zkdefi/risk_passport/settlement/madara/health")
      .then(setHealth)
      .catch(() => setHealth(null));

    apiFetch<L3Capabilities>("/api/v1/zkdefi/risk_passport/l3/capabilities")
      .then((d) => setPaths(d?.proving_paths?.paths ?? []))
      .catch(() => {});

    apiFetch<L3Stats>("/api/v1/zkdefi/risk_passport/l3/stats")
      .then(setStats)
      .catch(() => {});

    const interval = setInterval(() => {
      apiFetch<L3Health>("/api/v1/zkdefi/risk_passport/settlement/madara/health")
        .then(setHealth)
        .catch(() => {});
    }, 15_000);

    return () => clearInterval(interval);
  }, []);

  if (!health) return null;

  return (
    <div className="h-7 flex-shrink-0 border-b border-zinc-800/60 bg-zinc-950/80 px-4 flex items-center justify-between text-[11px]">
      {/* Left: Chain identity */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Boxes className="w-3 h-3 text-violet-400" />
          <span className="text-violet-300 font-medium">Proof Chain</span>
        </div>
        <span className="text-zinc-600">|</span>
        <div className="flex items-center gap-1.5">
          <Activity className={`w-2.5 h-2.5 ${health.healthy ? "text-emerald-400" : "text-red-400"}`} />
          <span className={health.healthy ? "text-emerald-400" : "text-red-400"}>
            {health.healthy ? "Live" : "Down"}
          </span>
        </div>
        <span className="text-zinc-600">|</span>
        <span className="text-zinc-400">
          Block <span className="text-zinc-200 font-mono">#{health.latest_block.toLocaleString()}</span>
        </span>
        {stats && stats.total_registrations !== undefined && (
          <>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">
              <span className="text-zinc-200 font-mono">{stats.total_registrations}</span> facts
            </span>
          </>
        )}
      </div>

      {/* Center: Proving paths */}
      <div className="flex items-center gap-3">
        {paths.map((p) => (
          <div key={p.id} className="flex items-center gap-1">
            <span className={p.available ? (PATH_COLORS[p.id] ?? "text-zinc-300") : "text-zinc-600"}>
              {PATH_ICONS[p.id] ?? <Zap className="w-3 h-3" />}
            </span>
            <span className={p.available ? "text-zinc-300" : "text-zinc-600"}>
              {p.id === "groth16_garaga" ? "Garaga" : p.id === "stark_integrity" ? "Integrity" : "Hash"}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${p.available ? "bg-emerald-400" : "bg-zinc-600"}`} />
          </div>
        ))}
      </div>

      {/* Right: Link to Forge */}
      <a
        href="https://starknet.obsqra.fi/forge/explorer"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-zinc-500 hover:text-violet-400 transition-colors"
      >
        Explorer
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
