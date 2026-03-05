"use client";

/**
 * AgentBuilder — Create identity-bound agents with ZK skills + LLM providers.
 *
 * The core UI for the agent creation flow:
 *   1. Name your agent
 *   2. Select ZK circuit skills (tools the agent can use)
 *   3. Choose an LLM provider (OpenAI, Clawbot, Local, Deterministic)
 *   4. Preview identity commitment
 *   5. Deploy → mints agent NFT on-chain
 */

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Plus,
  Shield,
  Zap,
  TrendingUp,
  AlertCircle,
  Activity,
  Target,
  ArrowRight,
  CheckCircle,
  XCircle,
  Cpu,
  Layers,
  Lock,
} from "lucide-react";

import { API_BASE } from "@/lib/api/client";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Skill {
  skill_id: string;
  name: string;
  description: string;
  category: string;
  parameters: Record<string, unknown>;
  requires_tier: number;
  circuit_ready: boolean;
}

interface LLMProvider {
  provider_id: string;
  name: string;
  type: string;
  default_model: string;
  available_models: string[];
  capabilities: string[];
  available: boolean;
  active: boolean;
  config_hash: string;
}

interface BuildResult {
  agent_id: string;
  name: string;
  owner_address: string;
  skills: string[];
  llm_provider: string;
  llm_config_hash: string;
  onchain_tx?: string;
}

function defaultSkills(): Skill[] {
  return [
    { skill_id: "il_predictor", name: "IL Predictor", description: "Predict impermanent loss", category: "agent_skill", parameters: {}, requires_tier: 0, circuit_ready: false },
    { skill_id: "yield_optimality", name: "Yield Optimality", description: "Verify yield allocation optimality", category: "agent_skill", parameters: {}, requires_tier: 0, circuit_ready: false },
    { skill_id: "slippage_bound", name: "Slippage Bound", description: "Verify trade slippage bounds", category: "agent_skill", parameters: {}, requires_tier: 0, circuit_ready: false },
    { skill_id: "reputation_check", name: "Reputation Score", description: "Prove agent reputation", category: "agent_identity", parameters: {}, requires_tier: 0, circuit_ready: false },
    { skill_id: "arb_check", name: "Arbitrage Check", description: "Verify cross-protocol arbitrage", category: "agent_skill", parameters: {}, requires_tier: 1, circuit_ready: false },
    { skill_id: "liquidation_check", name: "Liquidation Risk", description: "Check position health factors", category: "agent_skill", parameters: {}, requires_tier: 0, circuit_ready: false },
    { skill_id: "performance_attestation", name: "Performance Attestation", description: "Prove historical performance", category: "agent_identity", parameters: {}, requires_tier: 1, circuit_ready: false },
    { skill_id: "mev_protection", name: "MEV Resistance", description: "Prove MEV protection", category: "agent_skill", parameters: {}, requires_tier: 0, circuit_ready: false },
    { skill_id: "risk_score", name: "Risk Score", description: "Portfolio risk scoring", category: "ml_scoring", parameters: {}, requires_tier: 0, circuit_ready: false },
    { skill_id: "anomaly_detection", name: "Anomaly Detection", description: "Pool anomaly detection", category: "ml_scoring", parameters: {}, requires_tier: 0, circuit_ready: false },
  ];
}

function defaultProviders(): LLMProvider[] {
  return [
    { provider_id: "onyx", name: "Onyx", type: "openai_compatible", default_model: "onyx-defi-v1", available_models: ["onyx-defi-v1"], capabilities: ["allocation", "risk", "mev_detection"], available: true, active: true, config_hash: "" },
    { provider_id: "openai_gpt", name: "OpenAI GPT", type: "openai_compatible", default_model: "gpt-4o-mini", available_models: ["gpt-4o-mini", "gpt-4"], capabilities: ["allocation", "risk"], available: false, active: true, config_hash: "" },
    { provider_id: "clawbot", name: "Clawbot DeFi", type: "clawbot", default_model: "clawbot-defi-v1", available_models: ["clawbot-defi-v1"], capabilities: ["allocation", "risk", "mev_detection"], available: false, active: true, config_hash: "" },
    { provider_id: "local_llm", name: "Local LLM", type: "openai_compatible", default_model: "mistral:7b", available_models: ["mistral:7b", "llama3:8b"], capabilities: ["allocation"], available: false, active: true, config_hash: "" },
    { provider_id: "deterministic", name: "Deterministic", type: "deterministic", default_model: "deterministic-v1", available_models: ["deterministic-v1"], capabilities: ["allocation", "risk"], available: true, active: true, config_hash: "" },
  ];
}

function normalizeSkill(input: unknown): Skill {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    skill_id: String(row.skill_id ?? ""),
    name: String(row.name ?? row.skill_id ?? "Unknown Skill"),
    description: String(row.description ?? ""),
    category: String(row.category ?? "other"),
    parameters:
      row.parameters && typeof row.parameters === "object" && !Array.isArray(row.parameters)
        ? (row.parameters as Record<string, unknown>)
        : {},
    requires_tier: Number.isFinite(Number(row.requires_tier)) ? Number(row.requires_tier) : 0,
    circuit_ready: Boolean(row.circuit_ready),
  };
}

function normalizeProvider(input: unknown): LLMProvider {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    provider_id: String(row.provider_id ?? "unknown"),
    name: String(row.name ?? row.provider_id ?? "Unknown Provider"),
    type: String(row.type ?? "unknown"),
    default_model: String(row.default_model ?? "unknown"),
    available_models: Array.isArray(row.available_models) ? row.available_models.map((x) => String(x)) : [],
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.map((x) => String(x)) : [],
    available: Boolean(row.available),
    active: typeof row.active === "boolean" ? row.active : true,
    config_hash: row.config_hash == null ? "" : String(row.config_hash),
  };
}

function normalizeBuildResult(input: unknown): BuildResult {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const llmConfigHashRaw = row.llm_config_hash ?? row.config_hash;
  const skillsRaw = Array.isArray(row.skills)
    ? row.skills
    : Array.isArray(row.bound_skills)
      ? row.bound_skills
      : Array.isArray(row.skill_ids)
        ? row.skill_ids
        : [];

  return {
    agent_id: String(row.agent_id ?? row.id ?? ""),
    name: String(row.name ?? "Unnamed Agent"),
    owner_address: String(row.owner_address ?? row.owner ?? ""),
    skills: skillsRaw.map((entry) => String(entry)),
    llm_provider: String(row.llm_provider ?? row.llm_provider_id ?? "onyx"),
    llm_config_hash: llmConfigHashRaw == null ? "" : String(llmConfigHashRaw),
    onchain_tx: row.onchain_tx == null ? undefined : String(row.onchain_tx),
  };
}

// ---------------------------------------------------------------------------
// Skill category icons
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  agent_skill: <Zap className="w-4 h-4 text-amber-400" />,
  agent_identity: <Shield className="w-4 h-4 text-blue-400" />,
  ml_scoring: <TrendingUp className="w-4 h-4 text-emerald-400" />,
  merkle_privacy: <Lock className="w-4 h-4 text-purple-400" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  agent_skill: "Agent Skills",
  agent_identity: "Identity & Reputation",
  ml_scoring: "ML Scoring",
  merkle_privacy: "Privacy Proofs",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentBuilder({ address }: { address: string | undefined }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("onyx");
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch available skills and providers
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [skillsRes, providersRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/zkdefi/agent-builder/skills`),
          fetch(`${API_BASE}/api/v1/zkdefi/agent-builder/providers`),
        ]);
        let fetchedSkills: Skill[] = [];
        let fetchedProviders: LLMProvider[] = [];

        if (skillsRes.ok) {
          const data = await skillsRes.json();
          fetchedSkills = (Array.isArray(data?.skills) ? data.skills : []).map((entry: unknown) => normalizeSkill(entry));
        }
        if (providersRes.ok) {
          const data = await providersRes.json();
          fetchedProviders =
            (Array.isArray(data?.providers) ? data.providers : []).map((entry: unknown) => normalizeProvider(entry));
        }
        setSkills(fetchedSkills.length > 0 ? fetchedSkills : defaultSkills());
        setProviders(fetchedProviders.length > 0 ? fetchedProviders : defaultProviders());
      } catch {
        // Fallback to hardcoded skills for demo
        setSkills(defaultSkills());
        setProviders(defaultProviders());
      }
    };
    fetchData();
  }, []);

  const toggleSkill = useCallback((skillId: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }, []);

  const selectAllSkills = useCallback(() => {
    setSelectedSkills(new Set(skills.map((s) => s.skill_id)));
  }, [skills]);

  const buildAgent = async () => {
    if (!name.trim() || !address) return;
    setBuilding(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/agent-builder/agents/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          owner_address: address,
          skills: Array.from(selectedSkills),
          llm_provider: selectedProvider,
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail =
          payload && typeof payload === "object" && "detail" in payload
            ? String((payload as { detail?: unknown }).detail ?? "")
            : "";
        throw new Error(detail || `Build failed (${res.status})`);
      }

      const data = normalizeBuildResult(payload);
      setResult(data);
      setStep(4);
      toastSuccess(`Agent "${data.name}" built successfully!${data.onchain_tx ? " (minted on-chain)" : ""}`);
    } catch (e: any) {
      setError(e.message || "Build failed");
      toastError(e.message || "Agent build failed");
    } finally {
      setBuilding(false);
    }
  };

  // Group skills by category
  const groupedSkills = skills.reduce<Record<string, Skill[]>>((acc, skill) => {
    const cat = skill.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Brain className="w-5 h-5 text-[#00FFD1]" />
        <h2 className="text-lg font-semibold text-white">Agent Builder</h2>
        <span className="text-xs text-white/40 ml-auto">
          Step {step}/4
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-4">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              s <= step ? "bg-[#00FFD1]" : "bg-white/10"
            }`}
          />
        ))}
      </div>

      {/* Step 1: Name */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-white/60">
            Name your agent. This will be minted as an SRC-721 identity NFT.
          </p>
          <input
            type="text"
            placeholder="e.g. Yield Maximizer Alpha"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#00FFD1]/50 focus:outline-none"
            maxLength={31}
          />
          <div className="text-xs text-white/30">{name.length}/31 characters (felt252 limit)</div>
          <button
            onClick={() => name.trim() && setStep(2)}
            disabled={!name.trim()}
            className="w-full py-3 rounded-lg bg-[#00FFD1]/10 border border-[#00FFD1]/20 text-[#00FFD1] hover:bg-[#00FFD1]/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Step 2: Select Skills */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/60">
              Select ZK circuit skills (tools your agent can use).
            </p>
            <button
              onClick={selectAllSkills}
              className="text-xs text-[#00FFD1]/60 hover:text-[#00FFD1]"
            >
              Select All
            </button>
          </div>

          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {Object.entries(groupedSkills).map(([category, catSkills]) => (
              <div key={category}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  {CATEGORY_ICONS[category] || <Layers className="w-4 h-4 text-white/40" />}
                  <span className="text-xs font-medium text-white/50">
                    {CATEGORY_LABELS[category] || category}
                  </span>
                </div>
                <div className="space-y-1">
                  {catSkills.map((skill) => (
                    <button
                      key={skill.skill_id}
                      onClick={() => toggleSkill(skill.skill_id)}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-all text-sm ${
                        selectedSkills.has(skill.skill_id)
                          ? "border-[#00FFD1]/40 bg-[#00FFD1]/5 text-white"
                          : "border-white/5 bg-white/[0.02] text-white/60 hover:border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{skill.name}</span>
                        {selectedSkills.has(skill.skill_id) ? (
                          <CheckCircle className="w-4 h-4 text-[#00FFD1]" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-white/20" />
                        )}
                      </div>
                      <p className="text-xs text-white/40 mt-0.5">{skill.description}</p>
                      {skill.requires_tier > 0 && (
                        <span className="text-[10px] text-amber-400/80 mt-0.5 inline-block">
                          Requires Tier {skill.requires_tier}+
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded-lg border border-white/10 text-white/40 text-sm hover:text-white/60"
            >
              Back
            </button>
            <button
              onClick={() => selectedSkills.size > 0 && setStep(3)}
              disabled={selectedSkills.size === 0}
              className="flex-1 py-2 rounded-lg bg-[#00FFD1]/10 border border-[#00FFD1]/20 text-[#00FFD1] text-sm hover:bg-[#00FFD1]/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {selectedSkills.size} skills selected <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Choose LLM Provider */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-white/60">
            Choose the LLM backend for your agent&apos;s reasoning.
          </p>

          <div className="space-y-2">
            {providers.map((provider) => (
              <button
                key={provider.provider_id}
                onClick={() => setSelectedProvider(provider.provider_id)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                  selectedProvider === provider.provider_id
                    ? "border-[#00FFD1]/40 bg-[#00FFD1]/5"
                    : "border-white/5 bg-white/[0.02] hover:border-white/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-white/40" />
                    <span className={`font-medium text-sm ${selectedProvider === provider.provider_id ? "text-white" : "text-white/60"}`}>
                      {provider.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {provider.available ? (
                      <span className="text-[10px] text-emerald-400">Available</span>
                    ) : (
                      <span className="text-[10px] text-white/30">API Key Required</span>
                    )}
                    {selectedProvider === provider.provider_id && (
                      <CheckCircle className="w-4 h-4 text-[#00FFD1]" />
                    )}
                  </div>
                </div>
                <p className="text-xs text-white/30 mt-1">
                  Model: {provider.default_model} · Capabilities: {(provider.capabilities || []).join(", ") || "none"}
                </p>
              </button>
            ))}
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 rounded-lg border border-white/10 text-white/40 text-sm hover:text-white/60"
            >
              Back
            </button>
            <button
              onClick={buildAgent}
              disabled={building || !address}
              className="flex-1 py-2 rounded-lg bg-[#00FFD1] text-black text-sm font-medium hover:bg-[#00FFD1]/90 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {building ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4" /> Deploy Agent
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Result */}
      {step === 4 && result && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-[#00FFD1]/5 border border-[#00FFD1]/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-[#00FFD1]" />
              <span className="text-[#00FFD1] font-medium">Agent Deployed</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Name</span>
                <span className="text-white">{result.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Agent ID</span>
                <span className="text-white/80 font-mono text-xs">{result.agent_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Skills</span>
                <span className="text-white/80">{Array.isArray(result.skills) ? result.skills.length : 0} bound</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">LLM Provider</span>
                <span className="text-white/80">{result.llm_provider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Config Hash</span>
                <span className="text-white/40 font-mono text-[10px]">
                  {result.llm_config_hash ? `${result.llm_config_hash.slice(0, 18)}...` : "n/a"}
                </span>
              </div>
              {result.onchain_tx && (
                <div className="flex justify-between">
                  <span className="text-white/40">On-chain TX</span>
                  <a
                    href={`https://sepolia.starkscan.co/tx/${result.onchain_tx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 font-mono text-[10px] hover:underline"
                  >
                    {result.onchain_tx.slice(0, 18)}...
                  </a>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => {
              setStep(1);
              setName("");
              setSelectedSkills(new Set());
              setSelectedProvider("onyx");
              setResult(null);
              setError(null);
            }}
            className="w-full py-2 rounded-lg border border-white/10 text-white/40 text-sm hover:text-white/60"
          >
            Build Another Agent
          </button>
        </div>
      )}
    </div>
  );
}
