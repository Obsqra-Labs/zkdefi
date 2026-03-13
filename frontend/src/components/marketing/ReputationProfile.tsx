"use client";

import { useState, useCallback } from "react";
import {
  Shield,
  Flame,
  Heart,
  Zap,
  BarChart3,
  Layers,
  Diamond,
  User,
  Activity,
  Crown,
  TrendingUp,
  Wallet,
  Loader2,
  Download,
  Lock,
  Cpu,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ─── types ─────────────────────────────────────────────────────────── */

interface BehavioralSignal {
  signal: string;
  value: number;
  label: string;
  evidence: string;
  category: string;
}

export interface ReputationData {
  wallet_address: string;
  scanned_at: string;
  account_type: string;
  nonce: number;
  account_exists: boolean;
  is_contract_deployer: boolean;
  total_capital_usd: number;
  capital_by_protocol: Record<string, number>;
  protocol_count: number;
  position_count: number;
  signals: BehavioralSignal[];
  defi_veteran_score: number;
  conviction_score: number;
  activity_score: number;
  diversity_score: number;
  capital_score: number;
  resilience_score: number;
  recommended_tier: number;
  tier_reasoning: string;
  profile_hash: string;
  scan_duration_ms: number;
  errors: string[];
  // Credit scoring (FICO pack)
  fico_score?: number;
  fico_tier?: string;
  credit_class?: string;
  credit_class_index?: number;
  credit_confidence?: number;
  credit_features?: Record<string, number>;
  credit_feature_hash?: string;
  credit_model_hash?: string;
  credit_circuit_version?: string;
  ezkl_ready?: boolean;
}

/* ─── helpers ───────────────────────────────────────────────────────── */

const SIGNAL_ICONS: Record<string, typeof Shield> = {
  power_user: Crown,
  active_user: Activity,
  regular_user: User,
  new_user: User,
  whale: Diamond,
  substantial_capital: TrendingUp,
  modest_capital: Wallet,
  diversified: Layers,
  concentrated: Flame,
  defi_native: Zap,
  defi_experienced: BarChart3,
  diamond_hands: Diamond,
  balanced_deployer: Shield,
  staker: Heart,
  liquidity_provider: Layers,
  market_survivor: Shield,
  rug_survivor: Flame,
  custom_contract: Zap,
  argent_user: User,
  braavos_user: User,
  oz_account: Zap,
  multisig: Shield,
  vesu_user: TrendingUp,
  endur_staker: Heart,
  nostra_user: BarChart3,
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  experience:  { bg: "bg-cyan-500/10",    text: "text-cyan-400",    border: "border-cyan-500/20" },
  capital:     { bg: "bg-emerald-500/10",  text: "text-emerald-400",  border: "border-emerald-500/20" },
  conviction:  { bg: "bg-violet-500/10",   text: "text-violet-400",   border: "border-violet-500/20" },
  resilience:  { bg: "bg-amber-500/10",    text: "text-amber-400",    border: "border-amber-500/20" },
  governance:  { bg: "bg-rose-500/10",     text: "text-rose-400",     border: "border-rose-500/20" },
};

const TIER_STYLES: Record<number, { label: string; color: string; bg: string; border: string }> = {
  1: { label: "Tier 1 — Explorer",    color: "text-zinc-400",    bg: "bg-zinc-500/10",    border: "border-zinc-500/20" },
  2: { label: "Tier 2 — Operator",    color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20" },
  3: { label: "Tier 3 — Veteran",     color: "text-emerald-400", bg: "bg-emerald-500/10",  border: "border-emerald-500/20" },
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  argent_v1: "Argent V1",
  "argent_v0.3": "Argent V0.3",
  argent_new: "Argent",
  argent_multisig: "Argent Multisig",
  braavos: "Braavos",
  braavos_base: "Braavos",
  openzeppelin: "OpenZeppelin",
  openzeppelin_c1: "OpenZeppelin (Cairo 1)",
  custom: "Custom Contract",
  unknown: "Unknown",
};

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  if (score >= 20) return "text-cyan-400";
  return "text-zinc-500";
}

function scoreBarColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  if (score >= 20) return "bg-cyan-500";
  return "bg-zinc-600";
}

/* ─── ScoreBar ──────────────────────────────────────────────────────── */

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-medium text-zinc-400">{label}</span>
        <span className={`font-bold ${scoreColor(score)}`}>{score}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-700 ${scoreBarColor(score)}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
    </div>
  );
}

/* ─── proof/VC/browser types ────────────────────────────────────────── */

interface ProofResult {
  proof_hash: string;
  proof_size_bytes: number;
  verified: boolean;
  witness_ms: number;
  prove_ms: number;
  verify_ms: number;
  total_ms: number;
}

interface VCResult {
  credential_id: string;
  target_chain: string;
  envelope: Record<string, unknown>;
  integrity_hash: string;
}

interface BrowserScoreResult {
  fico_score: number;
  fico_tier: string;
  credit_class: string;
  confidence: number;
  inference_ms: number;
  ran_in_browser: true;
}

/* ─── main component ────────────────────────────────────────────────── */

export function ReputationProfile({ data }: { data: ReputationData }) {
  const tier = TIER_STYLES[data.recommended_tier] ?? TIER_STYLES[1];
  const accountLabel = ACCOUNT_TYPE_LABELS[data.account_type] ?? data.account_type;
  const hasFico = data.fico_score != null && data.fico_score > 0;

  // Proof generation state
  const [proofState, setProofState] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  // VC export state
  const [vcState, setVcState] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [vcResult, setVcResult] = useState<VCResult | null>(null);
  const [vcCopied, setVcCopied] = useState(false);

  // Browser scorer state
  const [browserState, setBrowserState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [browserScore, setBrowserScore] = useState<BrowserScoreResult | null>(null);

  // Generate ZK proof
  const handleGenerateProof = useCallback(async () => {
    if (!data.credit_features || proofState === "generating") return;
    setProofState("generating");
    setProofError(null);
    try {
      const featureVector = data.credit_features
        ? Object.values(data.credit_features)
        : [];
      // We need the normalized vector — re-extract from name order
      // Actually the backend needs normalized features. Get them from circuit-info or re-score.
      // For now, call the backend which uses the feature vector.
      const result = await apiFetch<{ wallet_address: string } & ProofResult>(
        "/api/v1/paper-trade/generate-proof",
        {
          method: "POST",
          body: JSON.stringify({
            wallet_address: data.wallet_address,
            feature_vector: featureVector,
          }),
          timeoutMs: 120_000, // proofs can take a while
        }
      );
      setProofResult(result);
      setProofState("done");
    } catch (err) {
      setProofError(err instanceof Error ? err.message : "Proof generation failed");
      setProofState("error");
    }
  }, [data, proofState]);

  // Export W3C-VC
  const handleExportVC = useCallback(async () => {
    if (vcState === "exporting") return;
    setVcState("exporting");
    try {
      const result = await apiFetch<{ status: string } & VCResult>(
        "/api/v1/paper-trade/export-vc",
        {
          method: "POST",
          body: JSON.stringify({
            wallet_address: data.wallet_address,
            fico_score: data.fico_score ?? 0,
            fico_tier: data.fico_tier ?? "",
            credit_class: data.credit_class ?? "",
            credit_confidence: data.credit_confidence ?? 0,
            defi_veteran_score: data.defi_veteran_score,
            recommended_tier: data.recommended_tier,
            feature_hash: data.credit_feature_hash ?? "",
            model_hash: data.credit_model_hash ?? "",
            proof_hash: proofResult?.proof_hash ?? null,
            target_chain: "starknet",
          }),
          timeoutMs: 15_000,
        }
      );
      setVcResult(result);
      setVcState("done");
    } catch (err) {
      setVcState("error");
    }
  }, [data, proofResult, vcState]);

  // Copy VC to clipboard
  const handleCopyVC = useCallback(() => {
    if (!vcResult) return;
    navigator.clipboard.writeText(JSON.stringify(vcResult.envelope, null, 2));
    setVcCopied(true);
    setTimeout(() => setVcCopied(false), 2000);
  }, [vcResult]);

  // Browser-side ONNX scoring
  const handleBrowserScore = useCallback(async () => {
    if (browserState === "loading") return;
    setBrowserState("loading");
    try {
      const { scoreCreditInBrowser } = await import("@/lib/credit/browser-scorer");
      const result = await scoreCreditInBrowser({
        nonce: data.nonce,
        total_capital_usd: data.total_capital_usd,
        protocol_count: data.protocol_count,
        position_count: data.position_count,
        signals: data.signals,
        defi_veteran_score: data.defi_veteran_score,
        recommended_tier: data.recommended_tier,
        account_type: data.account_type,
        account_exists: data.account_exists,
      });
      setBrowserScore(result);
      setBrowserState("done");
    } catch (err) {
      console.error("Browser scoring failed:", err);
      setBrowserState("error");
    }
  }, [data, browserState]);

  // Sort signals by value descending, take top 6
  const topSignals = [...data.signals]
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* ── Header: Tier badge + account summary ── */}
      <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border ${tier.border} ${tier.bg} px-6 py-4`}>
        <div className="flex items-center gap-4">
          {/* Veteran score ring */}
          <div className="relative flex h-16 w-16 items-center justify-center">
            <svg className="absolute h-16 w-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3"
                className="text-zinc-800" />
              <circle cx="32" cy="32" r="28" fill="none" strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(data.defi_veteran_score / 100) * 175.9} 175.9`}
                className={scoreColor(data.defi_veteran_score)}
              />
            </svg>
            <span className={`text-lg font-bold ${scoreColor(data.defi_veteran_score)}`}>
              {data.defi_veteran_score}
            </span>
          </div>

          <div>
            <p className={`text-xs font-bold uppercase tracking-wider ${tier.color}`}>
              {tier.label}
            </p>
            <p className="text-[10px] text-zinc-500">{data.tier_reasoning}</p>
            <p className="mt-1 text-[10px] text-zinc-600">
              {accountLabel} · {data.nonce.toLocaleString()} txns
              {data.is_contract_deployer && (
                <span className="ml-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-400">
                  Deployer
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">DeFi Veteran Score</p>
          <p className={`mt-0.5 text-2xl font-bold ${scoreColor(data.defi_veteran_score)}`}>
            {data.defi_veteran_score}<span className="text-sm text-zinc-500">/100</span>
          </p>
        </div>
      </div>

      {/* ── FICO Credit Score + Circuit Status ── */}
      {hasFico && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* FICO Score */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">FICO Score</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${
                (data.fico_score ?? 0) >= 750 ? "text-emerald-400" :
                (data.fico_score ?? 0) >= 670 ? "text-cyan-400" :
                (data.fico_score ?? 0) >= 580 ? "text-amber-400" : "text-red-400"
              }`}>
                {data.fico_score}
              </span>
              <span className="text-xs text-zinc-500">/ 850</span>
            </div>
            <p className={`mt-1 text-[10px] font-medium uppercase tracking-wider ${
              data.fico_tier === "excellent" ? "text-emerald-400" :
              data.fico_tier === "good" ? "text-cyan-400" :
              data.fico_tier === "fair" ? "text-amber-400" : "text-red-400"
            }`}>
              {data.fico_tier}
            </p>
          </div>

          {/* Credit Class */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Credit Class</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${
                data.credit_class === "AAA" ? "text-emerald-400" :
                data.credit_class === "AA" ? "text-cyan-400" :
                data.credit_class === "A" ? "text-blue-400" :
                data.credit_class === "B" ? "text-amber-400" : "text-red-400"
              }`}>
                {data.credit_class}
              </span>
              <span className="text-xs text-zinc-500">
                {((data.credit_confidence ?? 0) * 100).toFixed(0)}% conf
              </span>
            </div>
            <p className="mt-1 text-[10px] text-zinc-600">
              MLP {data.credit_circuit_version?.replace("creditworthiness_", "")}
            </p>
          </div>

          {/* Circuit Status */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">ZK Circuit</p>
            <div className="mt-1 flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${data.ezkl_ready ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className={`text-sm font-bold ${data.ezkl_ready ? "text-emerald-400" : "text-amber-400"}`}>
                {data.ezkl_ready ? "Proof Ready" : "Inference Only"}
              </span>
            </div>
            <p className="mt-2 text-[10px] text-zinc-600">
              {data.ezkl_ready
                ? "EZKL Halo2 circuit compiled — can generate ZK proofs"
                : "MLP inference active — EZKL artifacts pending"}
            </p>
            {data.credit_feature_hash && (
              <p className="mt-1 font-mono text-[9px] text-zinc-700 truncate">
                feat: {data.credit_feature_hash.slice(0, 14)}…
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Actions: Generate Proof / Export VC / Browser Score ── */}
      {hasFico && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-5 py-4 space-y-4">
          {/* Action buttons row */}
          <div className="flex flex-wrap gap-3">
            {/* Generate ZK Proof */}
            {data.ezkl_ready && proofState !== "done" && (
              <button
                onClick={handleGenerateProof}
                disabled={proofState === "generating"}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {proofState === "generating" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                )}
                {proofState === "generating" ? "Generating ZK Proof…" : "Generate ZK Proof"}
              </button>
            )}

            {/* Export VC */}
            <button
              onClick={handleExportVC}
              disabled={vcState === "exporting"}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {vcState === "exporting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {vcState === "done" ? "Export Again" : vcState === "exporting" ? "Exporting…" : "Export Portable VC"}
            </button>

            {/* Browser-side scoring */}
            <button
              onClick={handleBrowserScore}
              disabled={browserState === "loading"}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-400 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
            >
              {browserState === "loading" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cpu className="h-3.5 w-3.5" />
              )}
              {browserState === "loading" ? "Scoring in browser…" : browserState === "done" ? "Re-score in Browser" : "Score in Browser"}
            </button>
          </div>

          {/* Proof generation error */}
          {proofState === "error" && proofError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-2 text-[10px] text-rose-400">
              Proof error: {proofError}
            </div>
          )}

          {/* Proof result */}
          {proofResult && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400">
                  ZK Proof {proofResult.verified ? "Verified" : "Generated"}
                </span>
                <span className="ml-auto text-[10px] text-zinc-500">
                  {proofResult.total_ms.toFixed(0)}ms total
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="text-center">
                  <p className="text-xs font-bold text-emerald-400">{proofResult.witness_ms.toFixed(0)}ms</p>
                  <p className="text-[9px] text-zinc-600">witness</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold text-emerald-400">{proofResult.prove_ms.toFixed(0)}ms</p>
                  <p className="text-[9px] text-zinc-600">prove</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold text-emerald-400">{proofResult.verify_ms.toFixed(0)}ms</p>
                  <p className="text-[9px] text-zinc-600">verify</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold text-zinc-400">{(proofResult.proof_size_bytes / 1024).toFixed(1)}KB</p>
                  <p className="text-[9px] text-zinc-600">proof size</p>
                </div>
              </div>
              <p className="font-mono text-[9px] text-zinc-600 truncate">
                proof: {proofResult.proof_hash.slice(0, 22)}…
              </p>
            </div>
          )}

          {/* VC export result */}
          {vcResult && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-cyan-400" />
                <span className="text-xs font-bold text-cyan-400">
                  W3C Verifiable Credential Issued
                </span>
                <button
                  onClick={handleCopyVC}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-white"
                >
                  <Copy className="h-3 w-3" />
                  {vcCopied ? "Copied!" : "Copy JSON"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                <div>
                  <span className="text-zinc-600">ID: </span>
                  <span className="font-mono text-zinc-400">{vcResult.credential_id}</span>
                </div>
                <div>
                  <span className="text-zinc-600">Chain: </span>
                  <span className="text-zinc-400">{vcResult.target_chain}</span>
                </div>
                <div>
                  <span className="text-zinc-600">Type: </span>
                  <span className="text-zinc-400">CreditScoreCredential</span>
                </div>
                <div>
                  <span className="text-zinc-600">Issuer: </span>
                  <span className="text-zinc-400">did:web:zkde.fi</span>
                </div>
              </div>
              <p className="font-mono text-[9px] text-zinc-600 truncate">
                integrity: {vcResult.integrity_hash.slice(0, 22)}…
              </p>
              {proofResult && (
                <p className="text-[9px] text-emerald-500/70 italic">
                  ✦ ZK proof hash embedded in credential
                </p>
              )}
            </div>
          )}

          {/* Browser score result */}
          {browserScore && (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-violet-400" />
                <span className="text-xs font-bold text-violet-400">
                  Browser-Side ONNX Score
                </span>
                <span className="ml-auto rounded-full bg-violet-500/20 px-2 py-0.5 text-[9px] font-bold text-violet-400">
                  {browserScore.inference_ms}ms
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className={`text-xl font-bold ${
                    browserScore.fico_score >= 750 ? "text-emerald-400" :
                    browserScore.fico_score >= 670 ? "text-cyan-400" :
                    browserScore.fico_score >= 580 ? "text-amber-400" : "text-red-400"
                  }`}>
                    {browserScore.fico_score}
                  </p>
                  <p className="text-[9px] text-zinc-600">FICO (browser)</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-violet-400">{browserScore.credit_class}</p>
                  <p className="text-[9px] text-zinc-600">Class (browser)</p>
                </div>
                <div className="text-center">
                  <p className={`text-lg font-bold ${
                    browserScore.fico_score === (data.fico_score ?? 0) ? "text-emerald-400" : "text-amber-400"
                  }`}>
                    {browserScore.fico_score === (data.fico_score ?? 0) ? "✓ Match" : `Δ${browserScore.fico_score - (data.fico_score ?? 0)}`}
                  </p>
                  <p className="text-[9px] text-zinc-600">vs server</p>
                </div>
              </div>
              <p className="text-[9px] text-zinc-600 italic">
                Model ran entirely in your browser via onnxruntime-web — no data left your device.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Score bars ── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-4 sm:grid-cols-5">
        <ScoreBar label="Activity" score={data.activity_score} />
        <ScoreBar label="Conviction" score={data.conviction_score} />
        <ScoreBar label="Diversity" score={data.diversity_score} />
        <ScoreBar label="Capital" score={data.capital_score} />
        <ScoreBar label="Resilience" score={data.resilience_score} />
      </div>

      {/* ── Behavioral signals ── */}
      {topSignals.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Behavioral Signals ({data.signals.length})
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topSignals.map((sig, i) => {
              const cat = CATEGORY_COLORS[sig.category] ?? CATEGORY_COLORS.experience;
              const Icon = SIGNAL_ICONS[sig.signal] ?? Shield;
              return (
                <div key={i} className={`rounded-lg border ${cat.border} ${cat.bg} px-4 py-3`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${cat.text}`} />
                    <span className={`text-xs font-bold ${cat.text}`}>{sig.label}</span>
                    <span className="ml-auto rounded-full bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                      {(sig.value * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                    {sig.evidence}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Capital by protocol ── */}
      {data.protocol_count > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-6 py-4">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Capital Distribution
          </h3>
          <div className="flex flex-wrap items-end gap-4">
            {Object.entries(data.capital_by_protocol)
              .sort(([, a], [, b]) => b - a)
              .map(([protocol, usd]) => {
                const pct = data.total_capital_usd > 0 ? (usd / data.total_capital_usd) * 100 : 0;
                return (
                  <div key={protocol} className="space-y-1 text-center">
                    <div className="mx-auto h-16 w-6 overflow-hidden rounded bg-zinc-800">
                      <div
                        className="w-full rounded bg-emerald-500/60 transition-all duration-500"
                        style={{ height: `${Math.max(pct, 4)}%`, marginTop: `${100 - Math.max(pct, 4)}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-medium capitalize text-zinc-300">{protocol}</p>
                    <p className="text-[10px] text-zinc-600">${(usd / 1000).toFixed(1)}k</p>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Profile hash (proof binding) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-2">
        <p className="text-[10px] text-zinc-600">
          Profile hash: <span className="font-mono text-zinc-500">{data.profile_hash?.slice(0, 18)}…</span>
        </p>
        {data.credit_model_hash && data.credit_model_hash !== "heuristic_fallback" && (
          <p className="text-[10px] text-zinc-600">
            Model: <span className="font-mono text-zinc-500">{data.credit_model_hash.slice(0, 12)}…</span>
          </p>
        )}
        <p className="text-[10px] text-zinc-600">
          Scanned in {data.scan_duration_ms.toFixed(0)}ms
        </p>
      </div>
    </div>
  );
}
