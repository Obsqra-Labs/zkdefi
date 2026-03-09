"use client";

/**
 * MarketplaceConsole — Core zkML marketplace UI.
 * Extracted from /marketplace page for center-stage embedding.
 */

import { useState, useEffect } from "react";
import { Brain, Boxes, Sparkles, Shield, Zap, ArrowRight } from "lucide-react";
import { ModelComposer } from "@/components/zkdefi/ModelComposer";
import { MyAgents } from "@/components/zkdefi/MyAgents";
import { apiFetch } from "@/lib/api/client";

interface Model {
  id: string;
  name: string;
  description?: string;
  type: string;
  timeout: number;
}

export interface MarketplaceConsoleProps {
  address: string | undefined;
}

export function MarketplaceConsole({ address }: MarketplaceConsoleProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<"browse" | "compose" | "agents">("browse");

  useEffect(() => {
    apiFetch<{ models?: Model[] }>("/api/v1/agents/models/list")
      .then((d) => setModels(d.models || []))
      .catch(() => {});
  }, []);

  const handleAgentCreated = () => {
    setRefreshTrigger((p) => p + 1);
    setActiveTab("agents");
  };

  const getModelIcon = (type: string) => {
    switch (type) {
      case "groth16": return <Zap className="w-4 h-4 text-cyan-400" />;
      case "stone": return <Shield className="w-4 h-4 text-violet-400" />;
      default: return <Sparkles className="w-4 h-4 text-emerald-400" />;
    }
  };

  const getModelTypeLabel = (type: string) => {
    switch (type) {
      case "groth16": return { label: "Groth16", color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30" };
      case "stone": return { label: "STONE", color: "text-violet-400 bg-violet-400/10 border-violet-400/30" };
      default: return { label: type, color: "text-zinc-400 bg-zinc-400/10 border-zinc-400/30" };
    }
  };

  if (!address) {
    return <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Connect wallet to access the marketplace.</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Boxes className="w-4.5 h-4.5 text-cyan-400" />
          zkML Model Marketplace
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Compose privacy-preserving agents from verified Groth16 + EZKL models.
        </p>
      </div>

      {/* Feature chips */}
      <div className="grid grid-cols-3 gap-2">
        <div className="px-2.5 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
          <Zap className="w-3.5 h-3.5 text-cyan-400 mb-1" />
          <div className="text-[11px] font-medium text-zinc-200">Local Execution</div>
          <div className="text-[10px] text-zinc-500">Agent logic runs locally</div>
        </div>
        <div className="px-2.5 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
          <Shield className="w-3.5 h-3.5 text-emerald-400 mb-1" />
          <div className="text-[11px] font-medium text-zinc-200">Privacy Proofs</div>
          <div className="text-[10px] text-zinc-500">Verified without data reveal</div>
        </div>
        <div className="px-2.5 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
          <Brain className="w-3.5 h-3.5 text-violet-400 mb-1" />
          <div className="text-[11px] font-medium text-zinc-200">Composable</div>
          <div className="text-[10px] text-zinc-500">AND/OR decision logic</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800 pb-px">
        {(["browse", "compose", "agents"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors capitalize ${
              activeTab === t
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-zinc-400 hover:text-white"
            }`}
          >{t === "browse" ? "Browse Models" : t === "compose" ? "Compose Agent" : "My Agents"}</button>
        ))}
      </div>

      {/* Browse */}
      {activeTab === "browse" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-300">Available Models</span>
            <span className="text-[11px] text-zinc-500">{models.length} models</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {models.map((model) => {
              const typeInfo = getModelTypeLabel(model.type);
              return (
                <div key={model.id} className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-all group">
                  <div className="flex items-start justify-between mb-2">
                    <div className="p-1.5 rounded-lg bg-zinc-800 group-hover:bg-zinc-700 transition-colors">
                      {getModelIcon(model.type)}
                    </div>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded border ${typeInfo.color}`}>{typeInfo.label}</span>
                  </div>
                  <h3 className="text-xs font-medium text-zinc-200 mb-1">{model.name}</h3>
                  <p className="text-[11px] text-zinc-400 mb-2 line-clamp-2">
                    {model.description || `Privacy-preserving ${model.id.replace(/_/g, " ")} verification`}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span>Timeout: {model.timeout}s</span>
                    <button onClick={() => setActiveTab("compose")}
                      className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors"
                    >Use <ArrowRight className="w-2.5 h-2.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          {models.length === 0 && (
            <div className="text-center py-12 text-zinc-500">
              <Boxes className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-xs">Loading models…</p>
            </div>
          )}
        </div>
      )}

      {/* Compose */}
      {activeTab === "compose" && (
        <div className="max-w-2xl">
          <ModelComposer userAddress={address} onAgentCreated={handleAgentCreated} />
        </div>
      )}

      {/* My Agents */}
      {activeTab === "agents" && (
        <div className="max-w-2xl">
          <MyAgents userAddress={address} refreshTrigger={refreshTrigger} />
        </div>
      )}
    </div>
  );
}
