"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { Brain, Boxes, Sparkles, Shield, Zap, ArrowRight, ExternalLink } from "lucide-react";
import { ModelComposer } from "@/components/zkdefi/ModelComposer";
import { MyAgents } from "@/components/zkdefi/MyAgents";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { listModels } from "@/lib/api/agents";

export default function MarketplacePage() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string; description?: string; type: string; timeout: number }>>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<"browse" | "compose" | "agents">("browse");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      const data = await listModels();
      setModels(data.models || []);
    } catch (e) {
      console.error("Failed to fetch models:", e);
    }
  };

  const handleAgentCreated = () => {
    setRefreshTrigger((prev) => prev + 1);
    setActiveTab("agents");
  };

  const getModelIcon = (type: string) => {
    switch (type) {
      case "groth16":
        return <Zap className="w-5 h-5 text-cyan-400" />;
      case "stone":
        return <Shield className="w-5 h-5 text-violet-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-emerald-400" />;
    }
  };

  const getModelTypeLabel = (type: string) => {
    switch (type) {
      case "groth16":
        return { label: "Groth16", color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30" };
      case "stone":
        return { label: "STONE", color: "text-violet-400 bg-violet-400/10 border-violet-400/30" };
      default:
        return { label: type, color: "text-zinc-400 bg-zinc-400/10 border-zinc-400/30" };
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 sticky top-0 bg-zinc-950/90 backdrop-blur-xl z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <a href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <span className="font-semibold">zkde.fi</span>
              </a>
              <nav className="hidden md:flex items-center gap-4">
                <a href="/agent" className="text-sm text-zinc-400 hover:text-white transition-colors">Dashboard</a>
                <a href="/marketplace" className="text-sm text-emerald-400 font-medium">Marketplace</a>
              </nav>
            </div>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30">
              <Boxes className="w-8 h-8 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">zkML Model Marketplace</h1>
              <p className="text-zinc-400">Compose privacy-preserving agents from verified models</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700">
              <Zap className="w-6 h-6 text-cyan-400 mb-2" />
              <h3 className="font-medium mb-1">Local Execution</h3>
              <p className="text-sm text-zinc-400">All agent logic runs locally in zkde.fi - no external dependencies</p>
            </div>
            <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700">
              <Shield className="w-6 h-6 text-emerald-400 mb-2" />
              <h3 className="font-medium mb-1">Privacy Proofs</h3>
              <p className="text-sm text-zinc-400">Groth16 and STONE proofs verify compliance without revealing data</p>
            </div>
            <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700">
              <Brain className="w-6 h-6 text-violet-400 mb-2" />
              <h3 className="font-medium mb-1">Composable</h3>
              <p className="text-sm text-zinc-400">Combine multiple models with AND/OR decision logic</p>
            </div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="border-b border-zinc-800 sticky top-16 bg-zinc-950/90 backdrop-blur-xl z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("browse")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "browse"
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-white"
              }`}
            >
              Browse Models
            </button>
            <button
              onClick={() => setActiveTab("compose")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "compose"
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-white"
              }`}
            >
              Compose Agent
            </button>
            <button
              onClick={() => setActiveTab("agents")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "agents"
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-white"
              }`}
            >
              My Agents
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Browse Models Tab */}
        {activeTab === "browse" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Available Models</h2>
              <span className="text-sm text-zinc-500">{models.length} models</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {models.map((model) => {
                const typeInfo = getModelTypeLabel(model.type);
                return (
                  <div
                    key={model.id}
                    className="p-5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-all group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-2 rounded-lg bg-zinc-800 group-hover:bg-zinc-700 transition-colors">
                        {getModelIcon(model.type)}
                      </div>
                      <span className={`px-2 py-1 text-xs rounded border ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                    </div>
                    
                    <h3 className="font-medium mb-1">{model.name}</h3>
                    <p className="text-sm text-zinc-400 mb-4">
                      {model.description || `Privacy-preserving ${model.id.replace(/_/g, " ")} verification`}
                    </p>
                    
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Timeout: {model.timeout}s</span>
                      <button
                        onClick={() => setActiveTab("compose")}
                        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        Use in Agent <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {models.length === 0 && (
              <div className="text-center py-16 text-zinc-500">
                <Boxes className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Loading models...</p>
              </div>
            )}
          </div>
        )}

        {/* Compose Agent Tab */}
        {activeTab === "compose" && (
          <div className="max-w-2xl mx-auto">
            {isConnected && address ? (
              <ModelComposer userAddress={address} onAgentCreated={handleAgentCreated} />
            ) : (
              <div className="text-center py-16">
                <Brain className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                <h3 className="text-xl font-medium mb-2">Connect Wallet</h3>
                <p className="text-zinc-400 mb-6">Connect your wallet to compose custom agents</p>
                <ConnectButton />
              </div>
            )}
          </div>
        )}

        {/* My Agents Tab */}
        {activeTab === "agents" && (
          <div className="max-w-2xl mx-auto">
            {isConnected && address ? (
              <MyAgents userAddress={address} refreshTrigger={refreshTrigger} />
            ) : (
              <div className="text-center py-16">
                <Brain className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
                <h3 className="text-xl font-medium mb-2">Connect Wallet</h3>
                <p className="text-zinc-400 mb-6">Connect your wallet to view your agents</p>
                <ConnectButton />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">zkde.fi by Obsqra Labs</p>
            <div className="flex items-center gap-4">
              <a href="/agent" className="text-sm text-zinc-400 hover:text-white transition-colors">Dashboard</a>
              <a href="https://github.com/nicholasoxy/zkdefi" target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                GitHub <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
