"use client";

import { useState, useCallback } from "react";
import {
  Fingerprint,
  Loader2,
  ArrowRight,
  Activity,
  Key,
  Lock,
  ShieldCheck,
  CheckCircle2,
  Eye,
  Zap,
} from "lucide-react";
import { CapitalBrain, DEFAULT_ENABLED, type BrainConfig } from "./CapitalBrain";
import { TrustDemo } from "./TrustDemo";
import { TerminalPanel } from "./TerminalPanel";
import { SessionWallet } from "./SessionWallet";
import { IntelligentStream } from "./IntelligentStream";
import { DarkVaultPanel } from "./DarkVaultPanel";
import { ProofOfPerformance } from "./ProofOfPerformance";
import { ReputationProfile, type ReputationData } from "./ReputationProfile";
import { apiFetch } from "@/lib/api/client";

/* ── demo identifiers ── */
const DEMO_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";
const DEMO_SESSION_ID = "demo-mainnet-session-001";
const DEMO_L3_ADDRESS = "0x0474b940f499ca60d2aebce5c6b0b0c4e8b0947e";

/* ── seeded reputation for guest mode ── */
const GUEST_REPUTATION: ReputationData = {
  wallet_address: DEMO_ADDRESS,
  scanned_at: new Date().toISOString(),
  account_type: "argent",
  nonce: 42,
  account_exists: true,
  is_contract_deployer: false,
  total_capital_usd: 14_820,
  capital_by_protocol: { ekubo: 8200, vesu: 4100, nostra: 2520 },
  protocol_count: 3,
  position_count: 7,
  signals: [
    { signal: "multi_protocol_lp", value: 0.91, label: "Multi-protocol LP", evidence: "Active across 3 DEXs", category: "diversity" },
    { signal: "consistent_rebalancer", value: 0.85, label: "Consistent Rebalancer", evidence: "Regular position adjustments", category: "activity" },
    { signal: "capital_efficient", value: 0.78, label: "Capital Efficient", evidence: "High utilization ratio", category: "capital" },
    { signal: "early_adopter", value: 0.72, label: "Early Adopter", evidence: "Onboarded in first 90 days", category: "conviction" },
    { signal: "risk_aware", value: 0.68, label: "Risk Aware", evidence: "Diversified across risk tiers", category: "resilience" },
    { signal: "stable_farmer", value: 0.64, label: "Stable Farmer", evidence: "Consistent yield strategy", category: "activity" },
  ],
  defi_veteran_score: 72,
  conviction_score: 0.65,
  activity_score: 0.81,
  diversity_score: 0.58,
  capital_score: 0.69,
  resilience_score: 0.74,
  recommended_tier: 3,
  tier_reasoning: "Active operator across multiple Starknet protocols",
  profile_hash: "0x7a4f…e91c",
  scan_duration_ms: 340,
  errors: [],
  fico_score: 714,
  fico_tier: "Good",
  credit_class: "A",
  credit_confidence: 0.82,
  ezkl_ready: true,
  credit_circuit_version: "creditworthiness_v3",
  credit_feature_hash: "0xab3f19e7c2d6",
  credit_model_hash: "0x91cf4e20d8a1",
  credit_features: {
    nonce_norm: 0.42,
    capital_norm: 0.58,
    protocol_norm: 0.60,
    position_norm: 0.70,
    veteran_norm: 0.72,
    tier_norm: 0.60,
  },
};

/* ── step config ── */
const STEPS = [
  { num: 1, label: "Reputation Passport", icon: Fingerprint, color: "fuchsia" },
  { num: 2, label: "ZK Oracle",           icon: Eye,         color: "cyan" },
  { num: 3, label: "Gated Execution",     icon: Zap,         color: "emerald" },
] as const;

type StepColor = "fuchsia" | "cyan" | "emerald";

const COLOR_MAP: Record<StepColor, { text: string; border: string; bg: string; glow: string }> = {
  fuchsia: { text: "text-fuchsia-400", border: "border-fuchsia-500/30", bg: "bg-fuchsia-500/10", glow: "shadow-fuchsia-500/20" },
  cyan:    { text: "text-cyan-400",    border: "border-cyan-500/30",    bg: "bg-cyan-500/10",    glow: "shadow-cyan-500/20" },
  emerald: { text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10", glow: "shadow-emerald-500/20" },
};

/**
 * CapitalOSSection — 3-step sequential demo
 *
 *  Step 1: Reputation Passport — private but compliant identity
 *  Step 2: ZK Oracle — verified data intelligence for agents
 *  Step 3: Gated Execution — proof-gated actions, verifiable receipts
 */
export function CapitalOSSection() {
  const [activeStep, setActiveStep] = useState(1);

  /* ── Step 1: reputation ── */
  const [onboarded, setOnboarded] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  /* ── Step 2: oracle ── */
  const [config, setConfig] = useState<BrainConfig>({
    riskTolerance: 50,
    enabledSkills: DEFAULT_ENABLED,
    protocolWeights: { ekubo: 50, vesu: 30, lending: 20 },
  });
  const [triggerKey, setTriggerKey] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = useCallback((cfg: BrainConfig) => {
    setConfig(cfg);
    setTriggerKey((k) => k + 1);
  }, []);

  const handleOnboard = useCallback(async () => {
    setRepLoading(true);
    try {
      const rep = await apiFetch<ReputationData>(
        `/api/v1/paper-trade/reputation/${DEMO_ADDRESS}`,
      );
      setReputation(rep);
    } catch {
      setReputation(GUEST_REPUTATION);
    } finally {
      setRepLoading(false);
      setOnboarded(true);
    }
  }, []);

  return (
    <div className="space-y-10">
      {/* ═══ Hero headline ═══ */}
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-cyan-500">
          The System — Live Demo
        </p>
        <h2 className="text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
          Private identity. Verified intelligence.
          <br className="hidden sm:block" /> Proof-gated execution.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Three layers, one prover pipeline. Your identity stays private but
          compliant. The oracle validates data for AI agents. Execution happens
          only when proofs pass. Every action produces a receipt that builds
          your reputation.
        </p>
      </div>

      {/* ═══ Step navigation ═══ */}
      <div className="mx-auto flex max-w-2xl items-center justify-center">
        {STEPS.map((step, i) => {
          const c = COLOR_MAP[step.color];
          const isActive = activeStep === step.num;
          const isDone = activeStep > step.num || (step.num === 1 && onboarded && activeStep >= 1);
          const Icon = step.icon;

          return (
            <div key={step.num} className="flex items-center">
              {i > 0 && (
                <div className={`mx-2 h-px w-8 sm:w-14 transition-colors ${
                  isDone ? "bg-zinc-600" : "bg-zinc-800"
                }`} />
              )}
              <button
                onClick={() => setActiveStep(step.num)}
                className={`group flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                  isActive
                    ? `${c.bg} ${c.border} border ${c.text} shadow-lg ${c.glow}`
                    : isDone
                      ? "border border-zinc-700 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200"
                      : "border border-zinc-800/50 text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {isDone && !isActive ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Icon className={`h-3.5 w-3.5 ${isActive ? c.text : ""}`} />
                )}
                <span className="hidden sm:inline">{step.label}</span>
                <span className="sm:hidden">{step.num}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ═══ Step content ═══ */}
      <div className="min-h-[400px]">
        {/* ─────────────────────────────────────────────────────── */}
        {/* STEP 1 — Reputation Passport                          */}
        {/* ─────────────────────────────────────────────────────── */}
        {activeStep === 1 && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div className="mx-auto max-w-3xl text-center">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-1">
                <Fingerprint className="h-3.5 w-3.5 text-fuchsia-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-400">
                  Step 1
                </span>
              </div>
              <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
                Private but compliant.
              </h3>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
                Your on-chain footprint is scanned and compressed into a
                ZK identity proof using an{" "}
                <strong className="text-fuchsia-300">ERC-compatible Verifiable Credential</strong>.
                Your identity takes actions and earns reputation through receipts —
                without ever revealing your positions, balances, or strategy.
              </p>
            </div>

            {/* Explainer cards */}
            <div className="mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-500/10">
                  <Fingerprint className="h-4 w-4 text-fuchsia-400" />
                </div>
                <p className="text-xs font-semibold text-zinc-200">Identity Proof</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  EZKL Halo2 circuit proves your credit score without revealing inputs.
                  Verifiable on any chain.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                  <Lock className="h-4 w-4 text-violet-400" />
                </div>
                <p className="text-xs font-semibold text-zinc-200">Private Compliance</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  Protocols verify your tier without seeing your wallet.
                  W3C Verifiable Credential standard.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10">
                  <Activity className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="text-xs font-semibold text-zinc-200">Reputation Receipts</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  Every action produces a nullified receipt.
                  Your reputation grows with each verified execution.
                </p>
              </div>
            </div>

            {/* Onboard CTA or reputation dashboard */}
            {!onboarded ? (
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={handleOnboard}
                  disabled={repLoading}
                  className="group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-7 py-3.5 font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition-all hover:from-fuchsia-500 hover:to-violet-500 hover:shadow-fuchsia-500/30 disabled:opacity-50"
                >
                  {repLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Scanning on-chain identity…
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-5 w-5" />
                      Generate Identity Proof
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
                <p className="text-[10px] text-zinc-600">
                  No wallet needed · Uses demo address · Mainnet data
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* L3 address */}
                <div className="mx-auto max-w-lg rounded-xl border border-emerald-500/20 bg-emerald-950/10 px-5 py-4 text-center">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-500">
                    Your Sovereign L3 Address
                  </p>
                  <code className="break-all font-mono text-sm font-medium text-emerald-300">
                    {DEMO_L3_ADDRESS}
                  </code>
                  <p className="mt-2 text-[10px] text-zinc-600">
                    Portable across all zkDefi-compatible protocols.
                  </p>
                </div>

                {/* Full reputation dashboard */}
                {reputation && <ReputationProfile data={reputation} />}

                {/* Continue to Step 2 */}
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => setActiveStep(2)}
                    className="group inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-5 py-2.5 text-sm font-semibold text-cyan-400 transition-all hover:bg-cyan-500/10"
                  >
                    Continue to ZK Oracle
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────── */}
        {/* STEP 2 — ZK Oracle                                    */}
        {/* ─────────────────────────────────────────────────────── */}
        {activeStep === 2 && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div className="mx-auto max-w-3xl text-center">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-3 py-1">
                <Eye className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                  Step 2
                </span>
              </div>
              <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
                Verified data for agents.
              </h3>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
                The same prover pipeline validates the data that our AI oracle
                and other agents ingest. Real-time pool data from{" "}
                <strong className="text-cyan-300">5 Starknet protocols</strong>,
                AI-scored and zkML-attested — alongside your reputation passport.
              </p>
            </div>

            {/* Brain + Analysis */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
              <div className="lg:sticky lg:top-4 lg:self-start">
                <CapitalBrain onAnalyze={handleAnalyze} loading={loading} />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-200">ZK Oracle</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Aggregated on-chain data · AI-scored · zkML-attested
                    </p>
                  </div>
                  {onboarded && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/5 px-2.5 py-0.5 text-[10px] text-fuchsia-400">
                      <Fingerprint className="h-3 w-3" />
                      Passport attached
                    </span>
                  )}
                </div>

                <TrustDemo
                  riskTolerance={config.riskTolerance}
                  enabledSkills={config.enabledSkills}
                  protocolWeights={config.protocolWeights}
                  triggerKey={triggerKey}
                  onLoadingChange={setLoading}
                />
              </div>
            </div>

            {/* Continue to Step 3 */}
            <div className="flex justify-center pt-2">
              <button
                onClick={() => setActiveStep(3)}
                className="group inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-5 py-2.5 text-sm font-semibold text-emerald-400 transition-all hover:bg-emerald-500/10"
              >
                Continue to Gated Execution
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────── */}
        {/* STEP 3 — Gated Execution                              */}
        {/* ─────────────────────────────────────────────────────── */}
        {activeStep === 3 && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div className="mx-auto max-w-3xl text-center">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1">
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                  Step 3
                </span>
              </div>
              <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
                Execute only when proofs pass.
              </h3>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
                Identity verified. Data attested. Now execution is gated —
                session keys delegate action without exposing your main wallet.
                Every trade produces a ZK receipt that feeds back into your
                reputation passport.
              </p>
            </div>

            {/* Execution pipeline diagram */}
            <div className="mx-auto max-w-2xl">
              <div className="flex items-center justify-center gap-0 text-[10px] font-semibold">
                <span className="rounded-l-lg border border-fuchsia-500/30 bg-fuchsia-500/5 px-3 py-2 text-fuchsia-400">
                  Identity Proof
                </span>
                <span className="border-y border-zinc-700 bg-zinc-900 px-2 py-2 text-zinc-600">→</span>
                <span className="border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-cyan-400">
                  Oracle Data
                </span>
                <span className="border-y border-zinc-700 bg-zinc-900 px-2 py-2 text-zinc-600">→</span>
                <span className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-emerald-400">
                  Policy Gate
                </span>
                <span className="border-y border-zinc-700 bg-zinc-900 px-2 py-2 text-zinc-600">→</span>
                <span className="rounded-r-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-400">
                  Receipt ↻
                </span>
              </div>
            </div>

            {/* Execution panels */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <TerminalPanel
                id="session-key"
                title="Session Key"
                accent="text-amber-400"
                icon={<Key className="h-3 w-3 text-amber-400" />}
              >
                <SessionWallet
                  walletAddress={DEMO_ADDRESS}
                  sessionId={DEMO_SESSION_ID}
                  l3Address={DEMO_L3_ADDRESS}
                />
              </TerminalPanel>

              <TerminalPanel
                id="dark-vault"
                title="Dark Vault"
                accent="text-violet-400"
                icon={<Lock className="h-3 w-3 text-violet-400" />}
              >
                <DarkVaultPanel
                  walletAddress={DEMO_ADDRESS}
                  sessionId={DEMO_SESSION_ID}
                />
              </TerminalPanel>

              <TerminalPanel
                id="proof"
                title="ZK Proof of Performance"
                accent="text-fuchsia-400"
                icon={<ShieldCheck className="h-3 w-3 text-fuchsia-400" />}
              >
                <ProofOfPerformance
                  walletAddress={DEMO_ADDRESS}
                  sessionId={DEMO_SESSION_ID}
                />
              </TerminalPanel>

              <TerminalPanel
                id="stream"
                title="Reputation Receipts"
                accent="text-cyan-400"
                icon={<Activity className="h-3 w-3 text-cyan-400" />}
              >
                <IntelligentStream
                  walletAddress={DEMO_ADDRESS}
                  pollIntervalMs={10000}
                />
              </TerminalPanel>
            </div>

            {/* Back to start */}
            <div className="flex justify-center pt-2">
              <button
                onClick={() => setActiveStep(1)}
                className="inline-flex items-center gap-2 text-xs text-zinc-600 transition-colors hover:text-zinc-400"
              >
                <Activity className="h-3 w-3" />
                Receipts feed back into Step 1 — the loop closes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
