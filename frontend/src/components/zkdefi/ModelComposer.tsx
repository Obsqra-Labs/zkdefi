"use client";

import { useState, useEffect } from "react";
import { Brain, Plus, Trash2, Check, AlertCircle, Zap, Shield, TrendingUp } from "lucide-react";
import { apiUrl } from "@/lib/api/client";



interface Model {
  id: string;
  name: string;
  type: "groth16" | "risc_zero";
  timeout: number;
  description?: string;
}

interface ComposedAgent {
  id: string;
  name: string;
  processors: string[];
  decision_logic: { type: "AND" | "OR" };
  active: boolean;
  created_at: number;
}

const MODEL_DESCRIPTIONS: Record<string, string> = {
  risk_scoring: "zkML risk score based on portfolio features",
  correlation_risk: "Proves portfolio correlation is below threshold",
  twap_position: "Proves 7-day TWAP position is within limits",
  safety_diversification: "Proves diversification across safety-rated protocols",
  credit_scoring: "Cross-chain reputation score using RISC Zero",
  anomaly_detection: "Detects suspicious activity patterns",
};

const MODEL_ICONS: Record<string, React.ReactNode> = {
  risk_scoring: <TrendingUp className="w-4 h-4" />,
  correlation_risk: <Zap className="w-4 h-4" />,
  twap_position: <TrendingUp className="w-4 h-4" />,
  safety_diversification: <Shield className="w-4 h-4" />,
  credit_scoring: <Brain className="w-4 h-4" />,
  anomaly_detection: <AlertCircle className="w-4 h-4" />,
};

export function ModelComposer({
  userAddress,
  onAgentCreated,
}: {
  userAddress: string;
  onAgentCreated?: (agent: ComposedAgent) => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [decisionLogic, setDecisionLogic] = useState<"AND" | "OR">("AND");
  const [agentName, setAgentName] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/v1/agents/models/list");
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
      } else {
        // Fallback to hardcoded models if API unavailable
        setModels([
          { id: "risk_scoring", name: "Risk Score", type: "groth16", timeout: 10 },
          { id: "correlation_risk", name: "Correlation Risk", type: "groth16", timeout: 10 },
          { id: "twap_position", name: "TWAP Position", type: "groth16", timeout: 10 },
          { id: "safety_diversification", name: "Safety Diversification", type: "groth16", timeout: 10 },
          { id: "credit_scoring", name: "Credit Scoring", type: "risc_zero", timeout: 120 },
        ]);
      }
    } catch {
      // Fallback
      setModels([
        { id: "risk_scoring", name: "Risk Score", type: "groth16", timeout: 10 },
        { id: "correlation_risk", name: "Correlation Risk", type: "groth16", timeout: 10 },
        { id: "twap_position", name: "TWAP Position", type: "groth16", timeout: 10 },
        { id: "safety_diversification", name: "Safety Diversification", type: "groth16", timeout: 10 },
        { id: "credit_scoring", name: "Credit Scoring", type: "risc_zero", timeout: 120 },
      ]);
    }
    setLoading(false);
  };

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
    setError(null);
    setSuccess(null);
  };

  const createAgent = async () => {
    if (!agentName.trim()) {
      setError("Please enter an agent name");
      return;
    }
    if (selectedModels.length === 0) {
      setError("Please select at least one model");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/agents/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: userAddress,
          name: agentName.trim(),
          processors: selectedModels,
          decision_logic: { type: decisionLogic },
        }),
      });

      if (res.ok) {
        const agent = await res.json();
        setSuccess(`Agent "${agent.name}" created successfully!`);
        setAgentName("");
        setSelectedModels([]);
        onAgentCreated?.(agent);
      } else {
        const data = await res.json();
        setError(data.detail || "Failed to create agent");
      }
    } catch (e) {
      setError("Network error - backend may be offline");
    }
    setCreating(false);
  };

  return (
    <div className="glass rounded-xl border border-zinc-800 p-6">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <Brain className="w-5 h-5 text-cyan-400" />
        Compose Custom Agent
        <span className="ml-auto text-xs text-zinc-500">zkML Marketplace</span>
      </h3>

      {/* Agent Name */}
      <div className="mb-4">
        <label className="text-sm text-zinc-400 mb-1 block">Agent Name</label>
        <input
          type="text"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="My Custom Agent"
          className="w-full px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:border-cyan-500 focus:outline-none text-white"
        />
      </div>

      {/* Models Selection */}
      <div className="mb-4">
        <label className="text-sm text-zinc-400 mb-2 block">Select Models</label>
        {loading ? (
          <div className="text-center py-4 text-zinc-500">Loading models...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {models.map((model) => (
              <button
                key={model.id}
                onClick={() => toggleModel(model.id)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  selectedModels.includes(model.id)
                    ? "bg-cyan-600/20 border-cyan-500 text-cyan-300"
                    : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600 text-zinc-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded flex items-center justify-center ${
                      selectedModels.includes(model.id)
                        ? "bg-cyan-600 text-white"
                        : "bg-zinc-700 text-zinc-400"
                    }`}
                  >
                    {selectedModels.includes(model.id) ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      MODEL_ICONS[model.id] || <Plus className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{model.name}</div>
                    <div className="text-xs text-zinc-500">
                      {model.type === "risc_zero" ? "RISC Zero" : "Groth16"}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mt-1 ml-8">
                  {MODEL_DESCRIPTIONS[model.id] || "zkML proof model"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Decision Logic */}
      <div className="mb-4">
        <label className="text-sm text-zinc-400 mb-2 block">Decision Logic</label>
        <div className="flex gap-2">
          <button
            onClick={() => setDecisionLogic("AND")}
            className={`flex-1 py-2 px-4 rounded-lg border transition-all ${
              decisionLogic === "AND"
                ? "bg-emerald-600 border-emerald-500 text-white"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            AND
            <span className="block text-xs opacity-70">All models must pass</span>
          </button>
          <button
            onClick={() => setDecisionLogic("OR")}
            className={`flex-1 py-2 px-4 rounded-lg border transition-all ${
              decisionLogic === "OR"
                ? "bg-orange-600 border-orange-500 text-white"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            OR
            <span className="block text-xs opacity-70">Any model can pass</span>
          </button>
        </div>
      </div>

      {/* Selected Summary */}
      {selectedModels.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <p className="text-xs text-zinc-400 mb-1">Selected Models:</p>
          <div className="flex flex-wrap gap-1">
            {selectedModels.map((id) => {
              const model = models.find((m) => m.id === id);
              return (
                <span
                  key={id}
                  className="px-2 py-1 text-xs rounded bg-cyan-600/20 text-cyan-300 border border-cyan-600/30"
                >
                  {model?.name || id}
                </span>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Logic: <span className={decisionLogic === "AND" ? "text-emerald-400" : "text-orange-400"}>{decisionLogic}</span>
            {decisionLogic === "AND"
              ? " - Agent executes only if ALL models pass"
              : " - Agent executes if ANY model passes"}
          </p>
        </div>
      )}

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-900/20 border border-emerald-800 text-emerald-300 text-sm flex items-center gap-2">
          <Check className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Create Button */}
      <button
        onClick={createAgent}
        disabled={creating || selectedModels.length === 0 || !agentName.trim()}
        className="w-full py-3 rounded-lg bg-gradient-to-r from-cyan-600 to-emerald-600 text-white font-medium hover:from-cyan-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        {creating ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Creating Agent...
          </>
        ) : (
          <>
            <Plus className="w-4 h-4" />
            Create Composed Agent
          </>
        )}
      </button>
    </div>
  );
}
