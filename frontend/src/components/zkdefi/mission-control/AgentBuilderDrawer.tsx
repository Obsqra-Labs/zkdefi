"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Brain,
  Check,
  Clock,
  Cpu,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { toastError, toastSuccess } from "@/lib/toast";

export type AgentDecisionLogic = "AND" | "OR";

export interface AgentBuilderDraft {
  name?: string;
  processors?: string[];
  decisionLogic?: AgentDecisionLogic;
}

interface ModelRecord {
  id: string;
  name: string;
  description?: string;
  type: string;
  timeout: number;
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

interface AgentRecord {
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

interface ExecutionResult {
  agent_name: string;
  should_execute: boolean;
  total_time_ms: number;
}

interface ActivityEntry {
  id: number;
  level: "info" | "success" | "error";
  message: string;
}

interface AgentBuilderDrawerProps {
  userAddress: string;
  draft?: AgentBuilderDraft | null;
}

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

const DEMO_EXECUTION_PAYLOAD = {
  portfolio: {
    assets: { eth: 50000, usdc: 30000, strk: 20000 },
    daily_positions: [10000, 11000, 10500, 12000, 11500, 13000, 12500],
    volatility: 30,
    liquidity: 70,
  },
  constraints: {
    max_risk: 100,
    max_correlation: 90,
    max_twap: 50000,
    min_diversification: 30,
    min_credit: 400,
  },
};

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function AgentBuilderDrawer({ userAddress, draft }: AgentBuilderDrawerProps) {
  const [activeTab, setActiveTab] = useState<"compose" | "agents">("compose");
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [providers, setProviders] = useState<LlmProviderRecord[]>(FALLBACK_PROVIDERS);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [executingAgent, setExecutingAgent] = useState<string | null>(null);
  const [lastExecution, setLastExecution] = useState<ExecutionResult | null>(null);

  const [name, setName] = useState("");
  const [processors, setProcessors] = useState<string[]>([]);
  const [logic, setLogic] = useState<AgentDecisionLogic>("AND");

  const [providerId, setProviderId] = useState("deterministic");
  const [llmModel, setLlmModel] = useState("deterministic-v1");
  const [temperature, setTemperature] = useState(0);
  const [maxTokens, setMaxTokens] = useState(512);
  const [topP, setTopP] = useState(1);
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const provider = useMemo(
    () => providers.find((item) => item.provider_id === providerId) ?? FALLBACK_PROVIDERS[FALLBACK_PROVIDERS.length - 1],
    [providers, providerId]
  );

  const addActivity = useCallback((level: ActivityEntry["level"], message: string) => {
    setActivity((prev) => [{ id: Date.now(), level, message }, ...prev].slice(0, 8));
  }, []);

  const applyProviderDefaults = useCallback((nextProvider: LlmProviderRecord) => {
    setProviderId(nextProvider.provider_id);
    setLlmModel(nextProvider.default_model);
    setTemperature(nextProvider.defaults?.temperature ?? 0.2);
    setMaxTokens(nextProvider.defaults?.max_tokens ?? 1024);
    setTopP(nextProvider.defaults?.top_p ?? 1);
    setApiKeyEnv(nextProvider.api_key_env ?? "");
    setBaseUrl(nextProvider.base_url ?? "");
  }, []);

  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const response = await apiFetch<{ models: ModelRecord[] }>("/api/v1/agents/models/list");
      setModels(response.models || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load models";
      setError(message);
      addActivity("error", message);
    } finally {
      setLoadingModels(false);
    }
  }, [addActivity]);

  const fetchProviders = useCallback(async () => {
    try {
      const response = await apiFetch<{ providers: LlmProviderRecord[] }>("/api/v1/agents/providers");
      if (response.providers?.length) {
        setProviders(response.providers);
      }
    } catch {
      setProviders(FALLBACK_PROVIDERS);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const response = await apiFetch<{ agents: AgentRecord[] }>(`/api/v1/agents/user/${userAddress}`);
      setAgents(response.agents || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load agents";
      addActivity("error", message);
    } finally {
      setLoadingAgents(false);
    }
  }, [addActivity, userAddress]);

  useEffect(() => {
    fetchModels();
    fetchProviders();
    fetchAgents();
  }, [fetchAgents, fetchModels, fetchProviders]);

  useEffect(() => {
    applyProviderDefaults(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.provider_id]);

  useEffect(() => {
    if (!draft) return;
    setName(draft.name ?? "");
    setProcessors(Array.from(new Set(draft.processors ?? [])));
    setLogic(draft.decisionLogic ?? "AND");
    setActiveTab("compose");
    addActivity("info", "Loaded draft from Circuit Board");
  }, [addActivity, draft]);

  const toggleProcessor = useCallback((processorId: string) => {
    setProcessors((prev) =>
      prev.includes(processorId) ? prev.filter((item) => item !== processorId) : [...prev, processorId]
    );
    setError(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setError("Agent name is required");
      return;
    }
    if (processors.length === 0) {
      setError("Select at least one model");
      return;
    }

    setCreatingAgent(true);
    setError(null);
    addActivity("info", `Creating agent ${name.trim()}…`);

    try {
      const payload = {
        user_address: userAddress,
        name: name.trim(),
        processors,
        decision_logic: { type: logic },
        llm: {
          provider: providerId,
          model: llmModel.trim() || provider.default_model,
          temperature: clamp(temperature, 0, 2),
          max_tokens: clamp(maxTokens, 64, 8192),
          top_p: clamp(topP, 0, 1),
          api_key_env: apiKeyEnv.trim() || undefined,
          base_url: baseUrl.trim() || undefined,
        },
      };

      const created = await apiFetch<AgentRecord>("/api/v1/agents/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      toastSuccess(`Agent \"${created.name}\" created`);
      addActivity("success", `Created ${created.name} (${created.id})`);
      setName("");
      setProcessors([]);
      setLogic("AND");
      setLastExecution(null);
      await fetchAgents();
      setActiveTab("agents");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create agent";
      setError(message);
      addActivity("error", message);
      toastError(message);
    } finally {
      setCreatingAgent(false);
    }
  }, [
    addActivity,
    apiKeyEnv,
    baseUrl,
    fetchAgents,
    llmModel,
    logic,
    maxTokens,
    name,
    processors,
    provider.default_model,
    providerId,
    temperature,
    topP,
    userAddress,
  ]);

  const handleExecute = useCallback(
    async (agentId: string) => {
      setExecutingAgent(agentId);
      setLastExecution(null);
      try {
        const result = await apiFetch<ExecutionResult>(`/api/v1/agents/${agentId}/execute`, {
          method: "POST",
          body: JSON.stringify({ user_address: userAddress, ...DEMO_EXECUTION_PAYLOAD }),
        });
        setLastExecution(result);
        addActivity("success", `Executed ${result.agent_name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Execution failed";
        addActivity("error", message);
        toastError(message);
      } finally {
        setExecutingAgent(null);
      }
    },
    [addActivity, userAddress]
  );

  const handleDeactivate = useCallback(
    async (agentId: string) => {
      try {
        await apiFetch(`/api/v1/agents/${agentId}?user_address=${userAddress}`, { method: "DELETE" });
        addActivity("success", `Deactivated ${agentId}`);
        await fetchAgents();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to deactivate agent";
        addActivity("error", message);
        toastError(message);
      }
    },
    [addActivity, fetchAgents, userAddress]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Agent Builder</h3>
            <p className="text-xs text-zinc-500">Compose from models, bind provider config, and deploy.</p>
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-1">
          <button
            onClick={() => setActiveTab("compose")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "compose" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Compose Agent
          </button>
          <button
            onClick={() => {
              setActiveTab("agents");
              fetchAgents();
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "agents" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            My Agents
          </button>
        </div>
      </div>

      {activeTab === "compose" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <label className="mb-1 block text-xs text-zinc-400">Agent Name</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              placeholder="My autonomous allocation agent"
            />

            <div className="mt-3">
              <p className="mb-2 text-xs text-zinc-400">Decision Logic</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLogic("AND")}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    logic === "AND"
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400"
                  }`}
                >
                  AND - all models pass
                </button>
                <button
                  onClick={() => setLogic("OR")}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    logic === "OR"
                      ? "border-orange-500 bg-orange-500/20 text-orange-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400"
                  }`}
                >
                  OR - any model passes
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-zinc-400">Models</p>
              <span className="text-xs text-zinc-500">{processors.length} selected</span>
            </div>
            {loadingModels ? (
              <div className="text-xs text-zinc-500">Loading models...</div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {models.map((model) => {
                  const selected = processors.includes(model.id);
                  return (
                    <button
                      key={model.id}
                      onClick={() => toggleProcessor(model.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{model.name}</span>
                        {selected ? <Check className="h-4 w-4" /> : <Cpu className="h-4 w-4 text-zinc-500" />}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{model.id} · {model.type} · {model.timeout}s</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="mb-2 text-xs text-zinc-400">LLM Provider Configuration</p>

            <label className="mb-1 block text-xs text-zinc-500">Provider</label>
            <select
              value={providerId}
              onChange={(event) => {
                const selected = providers.find((item) => item.provider_id === event.target.value);
                if (selected) applyProviderDefaults(selected);
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              {providers.map((item) => (
                <option key={item.provider_id} value={item.provider_id}>
                  {item.name}
                </option>
              ))}
            </select>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-zinc-500">Model</label>
                <select
                  value={llmModel}
                  onChange={(event) => setLlmModel(event.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                >
                  {(provider.models?.length ? provider.models : [provider.default_model]).map((modelName) => (
                    <option key={modelName} value={modelName}>
                      {modelName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Temperature</label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Top P</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={topP}
                  onChange={(event) => setTopP(Number(event.target.value))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-zinc-500">Max Tokens</label>
                <input
                  type="number"
                  min={64}
                  max={8192}
                  step={64}
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(Number(event.target.value))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
              {provider.requires_api_key_env && (
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-zinc-500">API Key Env Var</label>
                  <input
                    value={apiKeyEnv}
                    onChange={(event) => setApiKeyEnv(event.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    placeholder={provider.api_key_env || "OPENAI_API_KEY"}
                  />
                </div>
              )}
              {provider.requires_base_url && (
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-zinc-500">Base URL</label>
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    placeholder={provider.base_url || "http://localhost:11434/v1"}
                  />
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-900/20 p-3 text-sm text-red-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creatingAgent}
            className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {creatingAgent ? "Creating Agent..." : "Create Agent"}
          </button>
        </div>
      )}

      {activeTab === "agents" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <span className="text-xs text-zinc-400">{agents.length} agent(s)</span>
            <button
              onClick={fetchAgents}
              className="rounded border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
              title="Refresh agents"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {loadingAgents ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-center">
              <Brain className="mx-auto h-10 w-10 text-zinc-600" />
              <p className="mt-2 text-sm text-zinc-400">No agents yet</p>
            </div>
          ) : (
            agents.map((agent) => (
              <div key={agent.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">{agent.name}</p>
                    <p className="text-xs text-zinc-500">{agent.id}</p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] ${agent.active ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-700 text-zinc-300"}`}>
                    {agent.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {agent.processors.map((processor) => (
                    <span key={processor} className="rounded border border-cyan-700/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">
                      {processor}
                    </span>
                  ))}
                </div>

                <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {agent.llm?.provider || "deterministic"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDate(agent.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    {agent.decision_logic.type}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => handleExecute(agent.id)}
                    disabled={executingAgent === agent.id}
                    className="inline-flex items-center gap-1 rounded border border-emerald-700 bg-emerald-700/20 px-2 py-1 text-xs text-emerald-300 disabled:opacity-60"
                  >
                    <Play className="h-3 w-3" />
                    {executingAgent === agent.id ? "Running" : "Execute"}
                  </button>
                  <button
                    onClick={() => handleDeactivate(agent.id)}
                    className="inline-flex items-center gap-1 rounded border border-red-700 bg-red-700/20 px-2 py-1 text-xs text-red-300"
                  >
                    <Trash2 className="h-3 w-3" />
                    Deactivate
                  </button>
                </div>
              </div>
            ))
          )}

          {lastExecution && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm">
              <p className="font-medium text-zinc-100">Execution: {lastExecution.agent_name}</p>
              <p className={`mt-1 ${lastExecution.should_execute ? "text-emerald-300" : "text-red-300"}`}>
                {lastExecution.should_execute ? "Execution approved" : "Execution blocked"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Total time: {lastExecution.total_time_ms}ms</p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Builder Activity</p>
        {activity.length === 0 ? (
          <p className="text-xs text-zinc-600">No activity yet.</p>
        ) : (
          <div className="space-y-1.5">
            {activity.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    entry.level === "success" ? "bg-emerald-400" : entry.level === "error" ? "bg-red-400" : "bg-cyan-400"
                  }`}
                />
                <span className="text-zinc-300">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
