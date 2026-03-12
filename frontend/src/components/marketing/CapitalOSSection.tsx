"use client";

import { useState, useCallback } from "react";
import { CapitalBrain, DEFAULT_ENABLED, type BrainConfig } from "./CapitalBrain";
import { TrustDemo } from "./TrustDemo";

/**
 * CapitalOSSection — client component wrapper that manages shared state
 * between the AI Brain control panel (left) and TrustDemo results (right).
 *
 * Mounted inside the landing page's server component via import.
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
      {/* Integrations headline */}
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-cyan-500">
          Protocol Integrations
        </p>
        <h2 className="text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
          AI pipeline. On-chain data.<br className="hidden sm:block" /> Your favorite protocols.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Live data from <strong className="text-cyan-400">Ekubo</strong>,{" "}
          <strong className="text-emerald-400">Vesu</strong>,{" "}
          <strong className="text-amber-400">Endur</strong>,{" "}
          <strong className="text-rose-400">Nostra</strong> &amp;{" "}
          <strong className="text-indigo-400">Troves</strong> — 80+ pools, $75 M TVL.
          Capital OS ingests it. The app gives you privacy and gated execution rails
          to trade permissionless <em>and</em> anonymous — at the same time.
        </p>
      </div>

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
          <p className="mt-3 text-center text-[10px] text-zinc-600">
            Full Capital OS with portfolio management, auto-rebalancing &amp; LP orchestration →{" "}
            <span className="text-zinc-500">Phase 5</span>
          </p>
        </div>
      </div>
    </div>
  );
}
