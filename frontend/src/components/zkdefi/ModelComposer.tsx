"use client";

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import {
  Brain,
  Plus,
  Check,
  AlertCircle,
  Zap,
  Shield,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface Model {
  id: string;
  name: string;
  type: string;
  timeout: number;
  description?: string;
}

export type AgentDecisionLogic = "AND" | "OR";

export interface ComposerDraft {
  name?: string;
  processors?: string[];
  decisionLogic?: AgentDecisionLogic;
}

interface LlmProviderRecord {
  provider_id: string;
  name: string;
  description?: string;
  default_model: string;
  models: string[];
  requires_api_key_env: boolean;
  requires_base_url: boolean;
  api_key_env?: string;
  base_url?: string;
  defaults?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
  };
}

export interface ComposedAgent {
  id: string;
  name: string;
  processors: string[];
  decision_logic: { type: AgentDecisionLogic };
  llm?: {
    provider?: string;
    model?: string;
  };
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

const MODEL_ICONS: Record<string, ReactNode> = {
  risk_scoring: <TrendingUp className="w-4 h-4" />,
  correlation_risk: <Zap className="w-4 h-4" />,
  twap_position: <TrendingUp className="w-4 h-4" />,
  safety_diversification: <Shield className="w-4 h-4" />,
  credit_scoring: <Brain className="w-4 h-4" />,
  anomaly_detection: <AlertCircle className="w-4 h-4" />,
};

const FALLBACK_MODELS: Model[] = [
  { id: "risk_scoring", name: "Risk Score", type: "groth16", timeout: 10 },
  { id: "correlation_risk", name: "Correlation Risk", type: "groth16", timeout: 10 },
  { id: "twap_position", name: "TWAP Position", type: "groth16", timeout: 10 },
  { id: "safety_diversification", name: "Safety Diversification", type: "groth16", timeout: 10 },
  { id: "credit_scoring", name: "Credit Scoring", type: "risc_zero", timeout: 120 },
];

const FALLBACK_PROVIDERS: LlmProviderRecord[] = [
  {
    provider_id: "openai",
    name: "OpenAI",
    default_model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o3-mini"],
    requires_api_key_env: true,
    requires_base_url: false,
    api_key_env: "OPENAI_API_KEY",
    defaults: { temperature: 0.2, max_tokens: 1024, top_p: 1 },
  },
  {
    provider_id: "anthropic",
    name: "Anthropic",
    default_model: "claude-3-7-sonnet-latest",
    models: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    requires_api_key_env: true,
    requires_base_url: false,
    api_key_env: "ANTHROPIC_API_KEY",
    defaults: { temperature: 0.2, max_tokens: 1024, top_p: 1 },
  },
  {
    provider_id: "claude",
    name: "Claude",
    default_model: "claude-3-7-sonnet-latest",
    models: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    requires_api_key_env: true,
    requires_base_url: false,
    api_key_env: "ANTHROPIC_API_KEY",
    defaults: { temperature: 0.2, max_tokens: 1024, top_p: 1 },
  },
  {
    provider_id: "local",
    name: "Local / OpenAI-Compatible",
    default_model: "llama3.1:8b",
    models: ["llama3.1:8b", "mistral:7b", "qwen2.5:7b"],
    requires_api_key_env: false,
    requires_base_url: true,
    base_url: "http://localhost:11434/v1",
    defaults: { temperature: 0.2, max_tokens: 1024, top_p: 1 },
  },
  {
    provider_id: "deterministic",
    name: "Deterministic",
    default_model: "deterministic-v1",
    models: ["deterministic-v1"],
    requires_api_key_env: false,
    requires_base_url: false,
    defaults: { temperature: 0, max_tokens: 512, top_p: 1 },
  },
];

function clampFloat(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

interface ModelComposerProps {
  userAddress: string;
  onAgentCreated?: (agent: ComposedAgent) => void;
  draft?: ComposerDraft | null;
  onLog?: (level: "info" | "success" | "error", message: string) => void;
}

export function ModelComposer({ userAddress, onAgentCreated, draft, onLog }: ModelComposerProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [decisionLogic, setDecisionLogic] = useState<AgentDecisionLogic>("AND");
  const [agentName, setAgentName] = useState("");
  const [providers, setProviders] = useState<LlmProviderRecord[]>(FALLBACK_PROVIDERS);
  const [providerId, setProviderId] = useState<string>("deterministic");
  const [llmModel, setLlmModel] = useState<string>("deterministic-v1");
  const [temperature, setTemperature] = useState<number>(0);
  const [maxTokens, setMaxTokens] = useState<number>(512);
  const [topP, setTopP] = useState<number>(1);
  const [apiKeyEnv, setApiKeyEnv] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const provider = useMemo(() => {
    return providers.find((item) => item.provider_id === providerId) || FALLBACK_PROVIDERS[FALLBACK_PROVIDERS.length - 1];
  }, [providers, providerId]);

  const applyProviderDefaults = useCallback((next: LlmProviderRecord) => {
    setProviderId(next.provider_id);
    setLlmModel(next.default_model);
    setTemperature(next.defaults?.temperature ?? 0.2);
    setMaxTokens(next.defaults?.max_tokens ?? 1024);
    setTopP(next.defaults?.top_p ?? 1);
    setApiKeyEnv(next.api_key_env ?? "");
    setBaseUrl(next.base_url ?? "");
  }, []);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ models?: Model[] }>("/api/v1/agents/models/list");
      if (data.models?.length) {
        setModels(data.models);
      } else {
        setModels(FALLBACK_MODELS);
      }
    } catch {
      setModels(FALLBACK_MODELS);
      onLog?.("error", "Falling back to local model list");
    } finally {
      setLoading(false);
    }
  }, [onLog]);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await apiFetch<{ providers?: LlmProviderRecord[] }>("/api/v1/agents/providers");
      if (data.providers?.length) {
        setProviders(data.providers);
      }
    } catch {
      setProviders(FALLBACK_PROVIDERS);
    }
  }, []);

  useEffect(() => {
    fetchModels();
    fetchProviders();
  }, [fetchModels, fetchProviders]);

  useEffect(() => {
    if (!providers.some((item) => item.provider_id === providerId)) {
      applyProviderDefaults(providers[0] || FALLBACK_PROVIDERS[FALLBACK_PROVIDERS.length - 1]);
    }
  }, [applyProviderDefaults, providerId, providers]);

  useEffect(() => {
    if (!draft) return;
    setAgentName(draft.name ?? "");
    setSelectedModels(Array.from(new Set(draft.processors ?? [])));
    setDecisionLogic(draft.decisionLogic ?? "AND");
    setSuccess(null);
    setError(null);
    onLog?.("info", "Loaded draft from Circuit Board");
  }, [draft, onLog]);

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
      onLog?.("error", "Agent name missing");
      return;
    }
    if (selectedModels.length === 0) {
      setError("Please select at least one model");
      onLog?.("error", "No models selected");
      return;
    }
    if (provider.requires_api_key_env && !apiKeyEnv.trim()) {
      setError(`${provider.name} requires API key env var`);
      return;
    }
    if (provider.requires_base_url && !baseUrl.trim()) {
      setError(`${provider.name} requires base URL`);
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        user_address: userAddress,
        name: agentName.trim(),
        processors: selectedModels,
        decision_logic: { type: decisionLogic },
        llm: {
          provider: provider.provider_id,
          model: llmModel.trim() || provider.default_model,
          temperature: clampFloat(temperature, 0, 2, provider.defaults?.temperature ?? 0.2),
          max_tokens: clampInt(maxTokens, 64, 8192, provider.defaults?.max_tokens ?? 1024),
          top_p: clampFloat(topP, 0, 1, provider.defaults?.top_p ?? 1),
          api_key_env: apiKeyEnv.trim() || undefined,
          base_url: baseUrl.trim() || undefined,
        },
      };

      const agent = await apiFetch<ComposedAgent>("/api/v1/agents/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setSuccess(`Agent "${agent.name}" created successfully!`);
      onLog?.("success", `Created agent ${agent.name}`);
      setAgentName("");
      setSelectedModels([]);
      setDecisionLogic("AND");
      onAgentCreated?.(agent);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Network error - backend may be offline";
      setError(message);
      onLog?.("error", message);
    } finally {
      setCreating(false);
    }
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
                    <div className="text-xs text-zinc-500">{model.type}</div>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mt-1 ml-8">
                  {MODEL_DESCRIPTIONS[model.id] || model.description || "zkML proof model"}
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

      {/* LLM Configuration */}
      <div className="mb-4 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
        <div className="mb-2 flex items-center gap-2 text-sm text-zinc-300">
          <Sparkles className="w-4 h-4 text-violet-400" />
          LLM Provider Configuration
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <label className="text-xs text-zinc-400 mb-1 block">Provider</label>
            <select
              value={providerId}
              onChange={(event) => {
                const selected = providers.find((item) => item.provider_id === event.target.value);
                if (selected) applyProviderDefaults(selected);
              }}
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white"
            >
              {providers.map((item) => (
                <option key={item.provider_id} value={item.provider_id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-zinc-400 mb-1 block">Model</label>
            <select
              value={llmModel}
              onChange={(event) => setLlmModel(event.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white"
            >
              {(provider.models?.length ? provider.models : [provider.default_model]).map((modelName) => (
                <option key={modelName} value={modelName}>
                  {modelName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Temperature</label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Top P</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={topP}
              onChange={(event) => setTopP(Number(event.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-zinc-400 mb-1 block">Max Tokens</label>
            <input
              type="number"
              min={64}
              max={8192}
              step={64}
              value={maxTokens}
              onChange={(event) => setMaxTokens(Number(event.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white"
            />
          </div>

          {provider.requires_api_key_env && (
            <div className="sm:col-span-2">
              <label className="text-xs text-zinc-400 mb-1 block">API Key Env Var</label>
              <input
                value={apiKeyEnv}
                onChange={(event) => setApiKeyEnv(event.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white"
                placeholder={provider.api_key_env || "OPENAI_API_KEY"}
              />
            </div>
          )}

          {provider.requires_base_url && (
            <div className="sm:col-span-2">
              <label className="text-xs text-zinc-400 mb-1 block">Base URL</label>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white"
                placeholder={provider.base_url || "http://localhost:11434/v1"}
              />
            </div>
          )}
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
          <p className="text-xs text-zinc-500 mt-1">
            LLM: <span className="text-violet-300">{provider.name}</span> · {llmModel || provider.default_model}
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
