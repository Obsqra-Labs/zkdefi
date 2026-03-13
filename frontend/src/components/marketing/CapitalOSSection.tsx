"use client";

import { useState, useCallback } from "react";
import { Activity, Key, Lock, ShieldCheck } from "lucide-react";
import { CapitalBrain, DEFAULT_ENABLED, type BrainConfig } from "./CapitalBrain";
import { TrustDemo } from "./TrustDemo";
import { TerminalPanel } from "./TerminalPanel";
import { SessionWallet } from "./SessionWallet";
import { IntelligentStream } from "./IntelligentStream";
import { DarkVaultPanel } from "./DarkVaultPanel";
import { ProofOfPerformance } from "./ProofOfPerformance";

/* ── demo identifiers for walletless mode ── */
const DEMO_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";
const DEMO_SESSION_ID = "demo-mainnet-session-001";
const DEMO_L3_ADDRESS = "0x0474b940f499ca60d2aebce5c6b0b0c4e8b0947e";

/**
 * CapitalOSSection — the main proof-attested intelligence layer.
 *
 * Layout:
 *  1. Headline
 *  2. AI Brain (left) + Analysis & dashboard (right)
 *     — TrustDemo pool analysis flows directly into
 *       Session Key / Dark Vault / ZK Proof / Activity panels
 *       as a single unified surface.
 */
export function CapitalOSSection() {
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

  return (
    <div className="space-y-8">
      {/* ── Headline ── */}
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

      {/* ── AI Brain + Analysis + Inline Dashboard ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        {/* Left: AI Brain control panel */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <CapitalBrain onAnalyze={handleAnalyze} loading={loading} />
        </div>

        {/* Right: Analysis + integrated dashboard panels */}
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

          {/* Pool intelligence & proof pipeline */}
          <TrustDemo
            riskTolerance={config.riskTolerance}
            enabledSkills={config.enabledSkills}
            protocolWeights={config.protocolWeights}
            triggerKey={triggerKey}
            onLoadingChange={setLoading}
          />

          {/* Session · Vault · Proofs · Feed — inline in analysis flow */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TerminalPanel
              id="session-key"
              title="Embedded Session Wallet"
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
              title="Activity Stream"
              accent="text-cyan-400"
              icon={<Activity className="h-3 w-3 text-cyan-400" />}
            >
              <IntelligentStream
                walletAddress={DEMO_ADDRESS}
                pollIntervalMs={10000}
              />
            </TerminalPanel>
          </div>
        </div>
      </div>
    </div>
  );
}
