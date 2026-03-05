"use client";

/**
 * Proof Explorer — browse, inspect, and submit ZK proofs on-chain.
 *
 * Shows:
 * - Aggregate proof statistics
 * - Available provable models and their status
 * - Proof history with model, hash, verification, and on-chain status
 * - Interactive yield forecast and anomaly detection with proof generation
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Upload,
  ExternalLink,
  Cpu,
  Activity,
  TrendingUp,
  AlertTriangle,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Layers,
  Timer,
  Brain,
  Link2,
} from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import * as batchApi from "@/lib/api/batch";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface ProofRecord {
  id: number;
  proof_hash: string;
  model_name: string;
  user_address: string;
  proof_type: string;
  action_type: string;
  proof_size_bytes: number;
  inference_output: string;
  verified_locally: boolean;
  created_at: number;
  created_at_iso: string;
  tx_hash: string | null;
  on_chain_proof_id: number | null;
  submitted_at: number | null;
  submitted_at_iso?: string;
}

interface ProofStats {
  total_proofs: number;
  verified_locally: number;
  submitted_on_chain: number;
  by_model: Record<string, number>;
  models_ready: Record<string, boolean>;
  available_models: string[];
}

interface ModelInfo {
  name: string;
  onnx_exists: boolean;
  onnx_size_bytes: number;
  ezkl_ready: boolean;
  has_compiled: boolean;
  has_proving_key: boolean;
  has_verification_key: boolean;
  has_srs: boolean;
  training_accuracy: number | null;
  training_loss: number | null;
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function truncHash(hash: string, n = 8): string {
  if (!hash) return "—";
  const h = hash.startsWith("0x") ? hash : `0x${hash}`;
  return h.length > n * 2 + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h;
}

function modelIcon(name: string) {
  if (name.includes("credit")) return <Shield className="w-4 h-4" />;
  if (name.includes("yield")) return <TrendingUp className="w-4 h-4" />;
  if (name.includes("anomaly")) return <AlertTriangle className="w-4 h-4" />;
  if (name.includes("timing")) return <Timer className="w-4 h-4" />;
  if (name.includes("fallback")) return <Brain className="w-4 h-4" />;
  return <Cpu className="w-4 h-4" />;
}

function modelColor(name: string): string {
  if (name.includes("credit")) return "text-blue-400";
  if (name.includes("yield")) return "text-green-400";
  if (name.includes("anomaly")) return "text-amber-400";
  if (name.includes("timing")) return "text-cyan-400";
  if (name.includes("fallback")) return "text-pink-400";
  return "text-gray-400";
}

/* ─── Batch Verification Panel ──────────────────────────────────────── */

function BatchVerificationPanel() {
  const [pending, setPending] = useState<batchApi.BatchPendingResponse | null>(null);
  const [history, setHistory] = useState<batchApi.BatchHistoryEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBatch = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        batchApi.getPendingBatch(),
        batchApi.getBatchHistory(5),
      ]);
      setPending(p);
      setHistory(h.batches || []);
      setError(null);
    } catch {
      setError("Batch verification service unavailable");
    }
  }, []);

  useEffect(() => { fetchBatch(); }, [fetchBatch]);

  const handleProcess = async () => {
    setProcessing(true);
    try {
      await batchApi.processBatch();
      await fetchBatch();
    } catch {
      setError("Failed to process batch");
    }
    setProcessing(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-5 h-5 text-indigo-400" />
        <h3 className="font-semibold text-white">Batch Verification</h3>
        <button
          onClick={fetchBatch}
          className="ml-auto text-gray-400 hover:text-white"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error ? (
        <div className="text-xs text-amber-400">{error}</div>
      ) : (
        <>
          {/* Pending count */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-400">
              Pending actions: <span className="text-white font-bold">{pending?.pending_count ?? "—"}</span>
            </div>
            {(pending?.pending_count ?? 0) > 0 && (
              <button
                onClick={handleProcess}
                disabled={processing}
                className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md disabled:opacity-50 flex items-center gap-1"
              >
                {processing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                Process Batch
              </button>
            )}
          </div>

          {/* Recent batches */}
          {history.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-gray-500 mb-1">Recent Batches</div>
              {history.map((b) => (
                <div key={b.batch_id} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${b.status === "verified" ? "bg-green-400" : b.status === "challenged" ? "bg-red-400" : "bg-blue-400"}`} />
                  <span className="font-mono text-gray-300">{truncHash(b.batch_id, 6)}</span>
                  <span className="text-gray-500">{b.action_count} actions</span>
                  {b.tx_hash && (
                    <a
                      href={`https://sepolia.voyager.online/tx/${b.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 hover:underline flex items-center gap-0.5"
                    >
                      <ExternalLink className="w-3 h-3" /> tx
                    </a>
                  )}
                  <span className="ml-auto text-gray-500">{b.submitted_at?.replace("T", " ").slice(0, 19)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Sequencer Status Panel ────────────────────────────────────────── */

function SequencerStatusPanel() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/proofs/sequencer-status`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) setStatus(await res.json());
        else setError(true);
      } catch {
        setError(true);
      }
    })();
  }, []);

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-5 h-5 text-teal-400" />
        <h3 className="font-semibold text-white">Proof Sequencer</h3>
      </div>
      {error ? (
        <div className="text-xs text-gray-500">Sequencer status unavailable — proofs are still forwarded in background</div>
      ) : status ? (
        <div className="text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Submitted</span>
            <span className="text-white font-mono">{String(status.submitted_count ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Queued (retry)</span>
            <span className="text-white font-mono">{String(status.retry_queue_size ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Endpoint</span>
            <span className="text-gray-400 font-mono truncate ml-2">{String(status.endpoint ?? "obsqra.fi")}</span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-500">Loading…</div>
      )}
    </div>
  );
}

/* ─── Components ────────────────────────────────────────────────────── */

function StatsCards({ stats }: { stats: ProofStats | null }) {
  if (!stats) return null;
  const cards = [
    { label: "Total Proofs", value: stats.total_proofs, icon: <Shield className="w-5 h-5 text-blue-400" /> },
    { label: "Verified Locally", value: stats.verified_locally, icon: <CheckCircle className="w-5 h-5 text-green-400" /> },
    { label: "On-Chain", value: stats.submitted_on_chain, icon: <Upload className="w-5 h-5 text-purple-400" /> },
    { label: "Models Available", value: stats.available_models.length, icon: <Cpu className="w-5 h-5 text-amber-400" /> },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center gap-2 mb-1 text-sm text-gray-400">{c.icon}{c.label}</div>
          <div className="text-2xl font-bold text-white">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function ModelCards({ models }: { models: ModelInfo[] }) {
  if (!models.length) return null;
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
        <Cpu className="w-5 h-5 text-blue-400" />
        Provable Models
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {models.map((m) => (
          <div key={m.name} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              {modelIcon(m.name)}
              <span className={`font-mono text-sm ${modelColor(m.name)}`}>{m.name}</span>
              {m.ezkl_ready ? (
                <span className="ml-auto text-xs bg-green-900/60 text-green-300 px-2 py-0.5 rounded-full">EZKL Ready</span>
              ) : (
                <span className="ml-auto text-xs bg-red-900/60 text-red-300 px-2 py-0.5 rounded-full">Not Setup</span>
              )}
            </div>
            <div className="text-xs text-gray-400 space-y-1">
              <div>ONNX: {m.onnx_exists ? `${(m.onnx_size_bytes / 1024).toFixed(1)} KB` : "—"}</div>
              {m.training_accuracy != null && (
                <div>Accuracy: {(m.training_accuracy * 100).toFixed(1)}%</div>
              )}
              <div className="flex gap-2 mt-1">
                {m.has_compiled && <span className="text-green-500" title="Compiled">&#9679; compiled</span>}
                {m.has_proving_key && <span className="text-green-500" title="PK">&#9679; pk</span>}
                {m.has_verification_key && <span className="text-green-500" title="VK">&#9679; vk</span>}
                {m.has_srs && <span className="text-green-500" title="SRS">&#9679; srs</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProofRow({
  proof,
  onSubmit,
  submitting,
}: {
  proof: ProofRecord;
  onSubmit: (hash: string) => void;
  submitting: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copyHash = () => {
    navigator.clipboard.writeText(proof.proof_hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  let output: number[] = [];
  try {
    output = JSON.parse(proof.inference_output);
  } catch {
    /* ignore */
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-2">
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {/* Model badge */}
        <span className={`flex items-center gap-1 text-xs font-mono ${modelColor(proof.model_name)}`}>
          {modelIcon(proof.model_name)}
          {proof.model_name}
        </span>

        {/* Hash */}
        <span className="font-mono text-xs text-gray-300">{truncHash(proof.proof_hash)}</span>
        <button onClick={(e) => { e.stopPropagation(); copyHash(); }} className="text-gray-500 hover:text-white" title="Copy hash">
          {copied ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>

        {/* Verification badge */}
        {proof.verified_locally ? (
          <span className="text-xs bg-green-900/50 text-green-300 px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Verified
          </span>
        ) : (
          <span className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Clock className="w-3 h-3" /> Unverified
          </span>
        )}

        {/* On-chain badge */}
        {proof.tx_hash ? (
          <a
            href={`https://sepolia.voyager.online/tx/${proof.tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1 hover:bg-purple-800/50"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" /> On-chain
          </a>
        ) : (
          <button
            disabled={submitting === proof.proof_hash}
            onClick={(e) => { e.stopPropagation(); onSubmit(proof.proof_hash); }}
            className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full flex items-center gap-1 hover:bg-gray-600 disabled:opacity-50"
          >
            {submitting === proof.proof_hash ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            Submit
          </button>
        )}

        {/* Size + time */}
        <span className="ml-auto text-xs text-gray-500">{proof.proof_size_bytes} B</span>
        <span className="text-xs text-gray-500">{proof.created_at_iso?.replace("T", " ").replace("Z", "")}</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400 space-y-1">
          <div><strong>Proof Hash:</strong> <span className="font-mono text-gray-300">{proof.proof_hash}</span></div>
          <div><strong>Type:</strong> {proof.proof_type}</div>
          <div><strong>Action:</strong> {proof.action_type}</div>
          {proof.user_address && <div><strong>User:</strong> <span className="font-mono">{truncHash(proof.user_address, 12)}</span></div>}
          {output.length > 0 && (
            <div><strong>Output:</strong> [{output.map((v) => v.toFixed(4)).join(", ")}]</div>
          )}
          {proof.tx_hash && (
            <div>
              <strong>TX:</strong>{" "}
              <a href={`https://sepolia.voyager.online/tx/${proof.tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline font-mono">
                {truncHash(proof.tx_hash, 12)}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Interactive Testers ───────────────────────────────────────────── */

function YieldForecastTester({ onProofGenerated }: { onProofGenerated: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/proofs/yield-forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generate_proof: true }),
      });
      const data = await res.json();
      setResult(data);
      onProofGenerated();
    } catch (e) {
      setResult({ error: String(e) });
    }
    setLoading(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-5 h-5 text-green-400" />
        <h3 className="font-semibold text-white">Yield Forecast</h3>
        <button
          onClick={run}
          disabled={loading}
          className="ml-auto px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-sm rounded-md disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
          {loading ? "Proving…" : "Run + Prove"}
        </button>
      </div>
      {result && (
        <div className="text-xs space-y-1">
          {"label" in result && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Prediction:</span>
              <span className={`font-bold ${
                result.label === "surging" ? "text-green-400" :
                result.label === "growing" ? "text-blue-400" :
                result.label === "stable" ? "text-gray-300" : "text-red-400"
              }`}>{String(result.label).toUpperCase()}</span>
            </div>
          )}
          {result.proof != null && typeof result.proof === "object" ? (
            <div className="text-green-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Proof: {truncHash(String((result.proof as Record<string, string>).proof_hash ?? ""))}
            </div>
          ) : null}
          {result.error ? <div className="text-red-400">{String(result.error)}</div> : null}
        </div>
      )}
    </div>
  );
}

function AnomalyDetectTester({ onProofGenerated }: { onProofGenerated: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/proofs/anomaly-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generate_proof: true }),
      });
      const data = await res.json();
      setResult(data);
      onProofGenerated();
    } catch (e) {
      setResult({ error: String(e) });
    }
    setLoading(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <h3 className="font-semibold text-white">Anomaly Detection</h3>
        <button
          onClick={run}
          disabled={loading}
          className="ml-auto px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-md disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
          {loading ? "Proving…" : "Run + Prove"}
        </button>
      </div>
      {result && (
        <div className="text-xs space-y-1">
          {"label" in result && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Classification:</span>
              <span className={`font-bold ${
                result.label === "safe" ? "text-green-400" :
                result.label === "warning" ? "text-amber-400" : "text-red-400"
              }`}>{String(result.label).toUpperCase()}</span>
            </div>
          )}
          {result.proof != null && typeof result.proof === "object" ? (
            <div className="text-green-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Proof: {truncHash(String((result.proof as Record<string, string>).proof_hash ?? ""))}
            </div>
          ) : null}
          {result.error ? <div className="text-red-400">{String(result.error)}</div> : null}
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────── */

export default function ProofExplorerPage() {
  const [stats, setStats] = useState<ProofStats | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [proofs, setProofs] = useState<ProofRecord[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, modelsRes, proofsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/zkdefi/proofs/stats`),
        fetch(`${API_BASE}/api/v1/zkdefi/proofs/models`),
        fetch(`${API_BASE}/api/v1/zkdefi/proofs/?limit=100${filter !== "all" ? `&model_name=${filter}` : ""}`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (modelsRes.ok) {
        const d = await modelsRes.json();
        setModels(d.models || []);
      }
      if (proofsRes.ok) {
        const d = await proofsRes.json();
        setProofs(d.proofs || []);
      }
    } catch (e) {
      console.error("Failed loading proof data:", e);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const submitOnChain = async (hash: string) => {
    setSubmitting(hash);
    try {
      await fetch(`${API_BASE}/api/v1/zkdefi/proofs/submit/${hash}`, { method: "POST" });
      await fetchData();
    } catch (e) {
      console.error("Submit failed:", e);
    }
    setSubmitting(null);
  };

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-8 h-8 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold">Proof Explorer</h1>
            <p className="text-sm text-gray-400">
              Browse, verify, and submit ZK proofs from 5 EZKL-provable ML models
            </p>
          </div>
          <button onClick={fetchData} className="ml-auto text-gray-400 hover:text-white" title="Refresh">
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Stats */}
        <StatsCards stats={stats} />

        {/* Models */}
        <ModelCards models={models} />

        {/* Interactive Testers */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            Generate Proofs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <YieldForecastTester onProofGenerated={fetchData} />
            <AnomalyDetectTester onProofGenerated={fetchData} />
          </div>
        </div>

        {/* Proof Infrastructure */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Proof Infrastructure
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BatchVerificationPanel />
            <SequencerStatusPanel />
          </div>
        </div>

        {/* Proof History */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-400" />
              Proof History
            </h2>
            <div className="flex gap-1 ml-auto flex-wrap">
              {["all", "creditworthiness", "yield_forecast", "anomaly_detector", "timing_predictor", "llm_fallback"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-2 py-1 rounded-md ${
                    filter === f
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {f === "all" ? "All" : f.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          {proofs.length === 0 ? (
            <div className="text-center text-gray-500 py-8 border border-gray-700 rounded-lg">
              No proofs yet. Use the testers above or the risk profile endpoint to generate proofs.
            </div>
          ) : (
            <div>
              {proofs.map((p) => (
                <ProofRow
                  key={p.proof_hash}
                  proof={p}
                  onSubmit={submitOnChain}
                  submitting={submitting}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="mt-8 pt-4 border-t border-gray-800 flex gap-4 text-xs text-gray-500">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
          <Link href="/mvp" className="hover:text-white">Brain</Link>
          <span>
            Registry: <span className="font-mono text-gray-400">{truncHash("0x20ea9a32eae3fe6fe5137ca9f576383f8723913e1619f17120cf1aeb7e06305", 10)}</span>
          </span>
        </div>
      </div>
    </main>
  );
}
