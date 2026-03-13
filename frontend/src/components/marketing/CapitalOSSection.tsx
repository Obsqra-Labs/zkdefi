"use client";

import { useState, useCallback } from "react";
import { Fingerprint, Loader2, ArrowRight } from "lucide-react";
import { CapitalBrain, DEFAULT_ENABLED, type BrainConfig } from "./CapitalBrain";
import { TrustDemo } from "./TrustDemo";
import { ReputationProfile, type ReputationData } from "./ReputationProfile";
import { apiFetch } from "@/lib/api/client";

/* ── demo identifiers ── */
const DEMO_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";
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

/**
 * CapitalOSSection — two clear sections:
 *
 *  1. Market Brain — AI-powered pool analysis (CapitalBrain + TrustDemo)
 *  2. Portable Reputation — onboard → L3 address → full reputation dashboard
 *     with FICO, credit class, ZK proof generation, VC export & behavioral signals
 */
export function CapitalOSSection() {
  /* ── brain state ── */
  const [config, setConfig] = useState<BrainConfig>({
    riskTolerance: 50,
    enabledSkills: DEFAULT_ENABLED,
    protocolWeights: { ekubo: 50, vesu: 30, lending: 20 },
  });
  const [triggerKey, setTriggerKey] = useState(0);
  const [loading, setLoading] = useState(false);

  /* ── reputation state ── */
  const [onboarded, setOnboarded] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [repLoading, setRepLoading] = useState(false);

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
    <div className="space-y-12">
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══  SECTION 1 — Market Brain                         ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="space-y-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-cyan-500">
            The System — Live Demo
          </p>
          <h2 className="text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
            Proof-gated execution
            <br className="hidden sm:block" /> across 5 Starknet protocols.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Real mainnet data from{" "}
            <strong className="text-cyan-400">Ekubo</strong>,{" "}
            <strong className="text-emerald-400">Vesu</strong>,{" "}
            <strong className="text-amber-400">Endur</strong>,{" "}
            <strong className="text-rose-400">Nostra</strong> &amp;{" "}
            <strong className="text-indigo-400">Troves</strong>. AI scores every
            pool. zkML proofs gate every action. No wallet needed.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          <div className="lg:sticky lg:top-4 lg:self-start">
            <CapitalBrain onAnalyze={handleAnalyze} loading={loading} />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-200">Capital OS</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Aggregated on-chain data · AI-scored · Verifiable execution
                </p>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-0.5 text-[10px] text-zinc-500">
                Walletless demo · No keys needed
              </span>
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
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══  SECTION 2 — Portable Reputation                  ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="border-t border-zinc-800 pt-12">
        <div className="mx-auto mb-8 max-w-3xl text-center">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-fuchsia-500">
            Portable Reputation
          </p>
          <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
            Your on-chain identity, proven.
          </h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-400">
            Onboard to receive a sovereign L3 address. Generate ZK proofs of your
            DeFi reputation — FICO score, credit class, behavioral signals —
            verifiable across any protocol, without revealing your positions.
          </p>
        </div>

        {!onboarded ? (
          <div className="flex justify-center">
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
                  Get Your Portable Identity
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
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
                This identity is portable across all zkDefi-compatible protocols.
              </p>
            </div>

            {/* Full reputation dashboard — no wrapper chrome, renders its own UI */}
            {reputation && <ReputationProfile data={reputation} />}
          </div>
        )}
      </div>
    </div>
  );
}
