"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Fingerprint,
  Loader2,
  ArrowRight,
  Activity,
  Lock,
  Wallet,
} from "lucide-react";
import { type ReputationData } from "./ReputationProfile";
import { IdentityCard } from "./IdentityCard";
import { RiskPicker } from "./RiskPicker";
import { OracleResults } from "./OracleResults";
import { ExecutionBlock } from "./ExecutionBlock";
import { IntelligentStream } from "./IntelligentStream";
import { useOracleAnalysis } from "@/hooks/useOracleAnalysis";
import { apiFetch } from "@/lib/api/client";
import { DEFAULT_ENABLED } from "./CapitalBrain";
import type { AnalysisResult } from "./TrustDemo";

/* ── demo identifiers ── */
const DEMO_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";

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

/* ── step badge ── */
function StepBadge({ label, color }: { label: string; color: string }) {
  return (
    <div className="mb-3 inline-flex items-center gap-2">
      <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-${color}-400`}>
        ◆ {label}
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
  /* ── identity ── */
  const [identityAddress, setIdentityAddress] = useState<string | null>(null);
  const [identitySource, setIdentitySource] = useState<"connected" | "demo" | null>(null);

  /* ── Step 1: reputation ── */
  const [onboarded, setOnboarded] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  /* ── Step 2: oracle (via hook) ── */
  const [riskTolerance, setRiskTolerance] = useState(50);
  const oracle = useOracleAnalysis({
    riskTolerance,
    enabledSkills: DEFAULT_ENABLED,
    protocolWeights: { ekubo: 50, vesu: 30, lending: 20 },
  });

  /* ── auto-analyze on identity resolve ── */
  const hasAutoAnalyzed = useRef(false);
  useEffect(() => {
    if (onboarded && !hasAutoAnalyzed.current) {
      hasAutoAnalyzed.current = true;
      oracle.analyze();
    }
  }, [onboarded]);

  /* ── re-analyze when risk changes (debounced) ── */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRiskChange = useCallback(
    (value: number) => {
      setRiskTolerance(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        oracle.analyze();
      }, 300);
    },
    [oracle.analyze],
  );

  /* ── lift oracle result for Step 3 ── */
  const [oracleResult, setOracleResult] = useState<AnalysisResult | null>(null);
  useEffect(() => {
    if (oracle.result) setOracleResult(oracle.result);
  }, [oracle.result]);

  /* ── Step 3: execution complete flag (for stream + teaser) ── */
  const [executionDone, setExecutionDone] = useState(false);

  const handleGuestOnboard = useCallback(async () => {
    setRepLoading(true);
    setIdentitySource("demo");
    setIdentityAddress(DEMO_ADDRESS);
    try {
      const rep = await apiFetch<ReputationData>(
        `/api/v1/demo/reputation/${DEMO_ADDRESS}`,
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
    <div className="space-y-16">
      {/* ═══ Hero headline ═══ */}
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
          Interactive Demo
        </p>
        <h2 className="font-serif text-2xl font-bold leading-tight tracking-tight text-zinc-100 sm:text-3xl">
          The loop that makes
          <br className="hidden sm:block" /> private DeFi work.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-zinc-500">
          How does a trader execute privately without losing their track record?
          <br className="hidden sm:block" />
          Three answers. One loop.
        </p>

        {/* Semantic progress dots */}
        <div className="mt-6 flex items-center justify-center gap-6" role="list" aria-label="Demo progress">
          {[
            { label: "Identity", done: onboarded, color: "bg-fuchsia-500" },
            { label: "Oracle", done: !!oracleResult, color: "bg-cyan-500" },
            { label: "Execution", done: executionDone, color: "bg-emerald-500" },
          ].map((step) => (
            <div
              key={step.label}
              role="listitem"
              className="flex items-center gap-1.5"
              aria-label={`${step.label}: ${step.done ? "complete" : "pending"}`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full border transition-colors duration-500 ${
                  step.done
                    ? `${step.color} border-transparent`
                    : "border-zinc-700 bg-transparent"
                }`}
              />
              <span
                className={`font-mono text-[10px] transition-colors duration-500 ${
                  step.done ? "text-zinc-300" : "text-zinc-600"
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STEP 1 — Reputation Passport                             */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="space-y-8">
        <div className="mx-auto max-w-3xl text-center">
          <StepBadge label="Reputation" color="fuchsia" />
          <h3 className="font-serif text-xl font-bold text-zinc-100 sm:text-2xl">
            Your reputation, proven privately.
          </h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
            Your DeFi history — positions, protocols, capital — is compressed into a
            single{" "}
            <strong className="text-fuchsia-300">ZK identity proof</strong>.
            Protocols see your tier and credit class. They never see your wallet,
            your balances, or your strategy. The proof travels with you.
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

        {/* Two CTAs or identity card */}
        {!onboarded ? (
          <div className="mx-auto flex max-w-md flex-col items-stretch gap-3">
            {/* Primary — Try as guest (full width, dominant) */}
            <button
              onClick={handleGuestOnboard}
              disabled={repLoading}
              className="group inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-7 py-4 text-base font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition-all hover:from-fuchsia-500 hover:to-violet-500 hover:shadow-fuchsia-500/30 disabled:opacity-50"
            >
              {repLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Discovering identity…
                </>
              ) : (
                <>
                  <Fingerprint className="h-5 w-5" />
                  Try the loop as guest
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>

            {/* Secondary — Connect wallet (smaller, stubbed) */}
            <button
              disabled
              className="group inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
              title="Wallet connect coming soon"
            >
              <Wallet className="h-4 w-4" />
              Connect wallet
              <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                soon
              </span>
            </button>

            <p className="text-center text-[10px] text-zinc-600">
              Try the loop in one click · No wallet needed
            </p>
          </div>
        ) : (
          reputation && <IdentityCard data={reputation} />
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STEP 2 — ZK Oracle (always visible)                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="space-y-8">
        <div className="mx-auto max-w-3xl text-center">
          <StepBadge label="Oracle" color="cyan" />
          <h3 className="font-serif text-xl font-bold text-zinc-100 sm:text-2xl">
            Verified data for your agent.
          </h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
            <strong className="text-cyan-300">62+ pools</strong> from 5 Starknet protocols,
            AI-scored across 13 circuit checks and zkML-attested. Your agent picks the
            best opportunity — and can prove it saw legitimate data, ran the right model,
            and made a correct decision.
          </p>
        </div>

        {/* Risk picker — vertical, single column */}
        <RiskPicker
          value={riskTolerance}
          onChange={handleRiskChange}
          loading={oracle.loading}
        />

        {/* Oracle results — directly below */}
        <OracleResults
          result={oracle.result}
          loading={oracle.loading}
          error={oracle.error}
          profile={oracle.profile}
          narration={oracle.narration}
          narrationLoading={oracle.narrationLoading}
          batchResults={oracle.batchResults}
          batchLoading={oracle.batchLoading}
          status={oracle.status}
          onRetry={oracle.analyze}
        />
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STEP 3 — Gated Execution                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <section className="space-y-8">
        <div className="mx-auto max-w-3xl text-center">
          <StepBadge label="Execution" color="emerald" />
          <h3 className="font-serif text-xl font-bold text-zinc-100 sm:text-2xl">
            The trade fires. The loop closes.
          </h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
            The oracle result pre-fills the execution path. The agent simulates,
            executes, and generates a{" "}
            <strong className="text-emerald-300">ZK receipt</strong> — all in one click.
            No valid proof means no execution. Every receipt feeds back into your
            reputation passport. The loop closes.
          </p>
        </div>

        {/* Execution block */}
        <ExecutionBlock
          oracleResult={oracleResult}
          walletAddress={identityAddress ?? DEMO_ADDRESS}
          riskTolerance={riskTolerance}
          onExecutionComplete={() => setExecutionDone(true)}
        />
      </section>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* POST-RECEIPT — Stream + Capital OS teaser                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {executionDone && (
        <section className="space-y-8">
          {/* Intro line */}
          <p className="text-center font-mono text-sm text-zinc-500">
            Your agent, running.
          </p>

          {/* IntelligentStream — live event feed */}
          <IntelligentStream
            walletAddress={identityAddress ?? DEMO_ADDRESS}
            pollIntervalMs={8000}
            maxVisible={10}
          />

          {/* Capital OS teaser */}
          <div className="mx-auto max-w-md text-center">
            <p className="text-xs leading-relaxed text-zinc-500">
              This is what you&apos;d see in{" "}
              <strong className="text-zinc-300">Capital OS</strong> —
              a live dashboard for your agent, positions, and proof receipts.
            </p>
            <a
              href="/zkdefi"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-emerald-400 underline underline-offset-2 transition-colors hover:text-emerald-300"
            >
              Open Capital OS →
            </a>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Builder callout                                           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="mx-auto max-w-3xl border-t border-zinc-800 pt-8 text-center">
        <p className="font-mono text-[11px] text-zinc-500">
          Building an agent? The same proof pipeline is available as an API.{" "}
          <a
            href="/docs"
            className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
          >
            Start at zkde.fi/docs →
          </a>
        </p>
      </div>
    </div>
  );
}
