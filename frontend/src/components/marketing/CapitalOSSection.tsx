"use client";

import { useState, useCallback, lazy, Suspense } from "react";
import {
  Fingerprint,
  Loader2,
  ArrowRight,
  Activity,
  Lock,
  Eye,
  Zap,
} from "lucide-react";
import { ReputationProfile, type ReputationData } from "./ReputationProfile";
import { apiFetch } from "@/lib/api/client";

/* ── lazy-load heavy components ── */
const CapitalBrainLazy = lazy(() =>
  import("./CapitalBrain").then((m) => ({ default: m.CapitalBrain }))
);
const TrustDemoLazy = lazy(() =>
  import("./TrustDemo").then((m) => ({ default: m.TrustDemo }))
);
const AgentExecutionLoopLazy = lazy(() =>
  import("./AgentExecutionLoop").then((m) => ({ default: m.AgentExecutionLoop }))
);

import { DEFAULT_ENABLED, type BrainConfig } from "./CapitalBrain";
import type { AnalysisResult } from "./TrustDemo";

/* ── demo identifiers ── */
const DEMO_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";
const DEMO_L3_ADDRESS = "0x0474b940f499ca60d2aebce5c6b0b0c4e8b0947e";

/* ── seeded reputation ── */
const GUEST_REPUTATION: ReputationData = {
  wallet_address: DEMO_ADDRESS,
  scanned_at: "2026-03-14T00:00:00.000Z",
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

/* ── loading skeleton ── */
function StepSkeleton() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
    </div>
  );
}

/* ── step badge ── */
function StepBadge({ num, label, icon: Icon, color }: {
  num: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="mb-3 inline-flex items-center gap-2">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
        Step {num}
      </span>
      <span className="text-zinc-700">—</span>
      <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-${color}-400`}>
        {label}
      </span>
    </div>
  );
}

/**
 * CapitalOSSection — 3 stacked sections, all always visible:
 *
 *  1. Reputation Passport — private but compliant identity
 *  2. ZK Oracle — verified data intelligence (always visible, no gate)
 *  3. Gated Execution — proof-gated actions, verifiable receipts
 */
export function CapitalOSSection() {
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

  /* ── Step 3: oracle result for execution loop ── */
  const [oracleResult, setOracleResult] = useState<AnalysisResult | null>(null);

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
    <div className="space-y-20">
      {/* ═══ Hero headline ═══ */}
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
          Interactive Demo
        </p>
        <h2 className="font-serif text-2xl font-bold leading-tight tracking-tight text-zinc-100 sm:text-3xl">
          Your reputation. Your oracle.
          <br className="hidden sm:block" /> Your proof.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-zinc-500">
          Build a private identity that compounds over time.
          Get verified data your agents can trust.
          Execute with proof — never expose your strategy.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STEP 1 — Reputation Passport                             */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="space-y-8">
        <div className="mx-auto max-w-3xl text-center">
          <StepBadge num={1} label="Reputation Passport" icon={Fingerprint} color="fuchsia" />
          <h3 className="font-serif text-xl font-bold text-zinc-100 sm:text-2xl">
            Private but compliant.
          </h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
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
            <p className="font-serif text-xs font-semibold text-zinc-200">Identity Proof</p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-zinc-500">
              EZKL Halo2 circuit proves your reputation tier without revealing inputs.
              Verifiable on any chain.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
              <Lock className="h-4 w-4 text-violet-400" />
            </div>
            <p className="font-serif text-xs font-semibold text-zinc-200">Private Compliance</p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-zinc-500">
              Protocols verify your tier without seeing your wallet.
              W3C Verifiable Credential standard.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10">
              <Activity className="h-4 w-4 text-cyan-400" />
            </div>
            <p className="font-serif text-xs font-semibold text-zinc-200">Reputation Receipts</p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-zinc-500">
              Every action produces a nullified receipt.
              Your reputation grows with each verified execution.
            </p>
          </div>
        </div>

        {/* Selective disclosure callout */}
        <div className="mx-auto max-w-3xl rounded-lg border border-violet-500/10 bg-violet-950/5 px-5 py-3 text-center">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            <strong className="text-violet-300">Selective disclosure on demand.</strong>{" "}
            Protocols verify your tier without seeing your wallet. Regulators can request disclosure. You control the key.
          </p>
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
            {reputation && <ReputationProfile data={reputation} />}
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STEP 2 — ZK Oracle (always visible)                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="space-y-8 border-t border-zinc-800 pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <StepBadge num={2} label="Verified Intelligence" icon={Eye} color="cyan" />
          <h3 className="font-serif text-xl font-bold text-zinc-100 sm:text-2xl">
            Verified data for your agents.
          </h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
            Real-time pool data from{" "}
            <strong className="text-cyan-300">5 Starknet protocols</strong>,
            AI-scored and zkML-attested. Your agents can prove they saw legitimate
            data, ran the right model, and made a correct decision.
          </p>
        </div>

        <Suspense fallback={<StepSkeleton />}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <CapitalBrainLazy onAnalyze={handleAnalyze} loading={loading} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-semibold text-zinc-200">Verified Intelligence</h3>
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

              <TrustDemoLazy
                riskTolerance={config.riskTolerance}
                enabledSkills={config.enabledSkills}
                protocolWeights={config.protocolWeights}
                triggerKey={triggerKey}
                onLoadingChange={setLoading}
                onResult={setOracleResult}
              />
            </div>
          </div>
        </Suspense>
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STEP 3 — Gated Execution                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="space-y-8 border-t border-zinc-800 pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <StepBadge num={3} label="Gated Execution" icon={Zap} color="emerald" />
          <h3 className="font-serif text-xl font-bold text-zinc-100 sm:text-2xl">
            The AI acts. The loop closes.
          </h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
            The agent picks the best opportunity, simulates a trade, and
            generates a ZK receipt — all in one click. No valid proof means
            no execution. Every receipt feeds back into your reputation passport.
          </p>
        </div>

        {/* Agent execution loop */}
        <Suspense fallback={<StepSkeleton />}>
          <AgentExecutionLoopLazy
            oracleResult={oracleResult}
            walletAddress={DEMO_ADDRESS}
          />
        </Suspense>
      </section>
    </div>
  );
}
