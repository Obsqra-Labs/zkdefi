"use client";

import { useState, useCallback } from "react";
import {
  Activity,
  Key,
  Lock,
  ShieldCheck,
  Fingerprint,
  Layers,
} from "lucide-react";
import { CapitalBrain, DEFAULT_ENABLED, type BrainConfig } from "./CapitalBrain";
import { TrustDemo } from "./TrustDemo";
import { MultiPanelLayout, type PanelDef } from "./MultiPanelLayout";
import { SessionWallet } from "./SessionWallet";
import { IntelligentStream } from "./IntelligentStream";
import { DarkVaultPanel } from "./DarkVaultPanel";
import { ProofOfPerformance } from "./ProofOfPerformance";

/* ── demo identifiers for walletless mode ── */
const DEMO_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";
const DEMO_SESSION_ID = "demo-mainnet-session-001";
const DEMO_L3_ADDRESS = "0x0474b940f499ca60d2aebce5c6b0b0c4e8b0947e";

/**
 * CapitalOSSection — the main proof-attested intelligence layer.
 *
 * Layout:
 *  1. Headline
 *  2. AI Brain (left) + TrustDemo pool analysis (right)
 *  3. Dashboard terminal panels — Session Keys, Dark Vault, ZK Proofs,
 *     Activity Stream — controls & data feeds for the analysis above
 */
export function CapitalOSSection() {
  const [config, setConfig] = useState<BrainConfig>({
    riskTolerance: 50,
    enabledSkills: DEFAULT_ENABLED,
    protocolWeights: { ekubo: 50, vesu: 30, lending: 20 },
  });
  const [triggerKey, setTriggerKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const handleAnalyze = useCallback((cfg: BrainConfig) => {
    setConfig(cfg);
    setTriggerKey((k) => k + 1);
    setHasAnalyzed(true);
  }, []);

  /* ── Dashboard panels ── */
  const dashboardPanels: PanelDef[] = [
    {
      id: "session-key",
      title: "Session Key",
      accent: "text-amber-400",
      icon: <Key className="h-3 w-3 text-amber-400" />,
      content: (
        <SessionWallet
          walletAddress={DEMO_ADDRESS}
          sessionId={DEMO_SESSION_ID}
          l3Address={DEMO_L3_ADDRESS}
        />
      ),
    },
    {
      id: "dark-vault",
      title: "Dark Vault",
      accent: "text-violet-400",
      icon: <Lock className="h-3 w-3 text-violet-400" />,
      content: (
        <DarkVaultPanel
          walletAddress={DEMO_ADDRESS}
          sessionId={DEMO_SESSION_ID}
        />
      ),
    },
    {
      id: "proof",
      title: "ZK Proof of Performance",
      accent: "text-fuchsia-400",
      icon: <ShieldCheck className="h-3 w-3 text-fuchsia-400" />,
      content: (
        <ProofOfPerformance
          walletAddress={DEMO_ADDRESS}
          sessionId={DEMO_SESSION_ID}
        />
      ),
    },
    {
      id: "stream",
      title: "Activity Stream",
      accent: "text-cyan-400",
      icon: <Activity className="h-3 w-3 text-cyan-400" />,
      content: (
        <IntelligentStream walletAddress={DEMO_ADDRESS} pollIntervalMs={10000} />
      ),
    },
  ];

  return (
    <div className="space-y-8">
      {/* ── Headline ── */}
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-cyan-500">
          The System — Live Demo
        </p>
        <h2 className="text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
          Proof-gated execution<br className="hidden sm:block" /> across 5 Starknet protocols.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Real mainnet data from{" "}
          <strong className="text-cyan-400">Ekubo</strong>,{" "}
          <strong className="text-emerald-400">Vesu</strong>,{" "}
          <strong className="text-amber-400">Endur</strong>,{" "}
          <strong className="text-rose-400">Nostra</strong> &amp;{" "}
          <strong className="text-indigo-400">Troves</strong>.
          AI scores every pool. zkML proofs gate every action. No wallet needed.
        </p>
      </div>

      {/* ── AI Brain + Pool Analysis ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        {/* Left: AI Brain control panel */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <CapitalBrain onAnalyze={handleAnalyze} loading={loading} />
        </div>

        {/* Right: Analysis results */}
        <div>
          <div className="mb-4 flex items-center justify-between">
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

      {/* ── Dashboard: Terminal Panels ── */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-200">Dashboard</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Session management · Private vaults · ZK attestations · Activity feed
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-0.5 text-[10px] text-zinc-500">
            All proof-attested · Demo mode
          </span>
        </div>
        <MultiPanelLayout panels={dashboardPanels} defaultLayout="grid" />
      </div>
    </div>
  );
}
