"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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
              Configure risk · Select circuits · Run verifiable analysis
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-0.5 text-[10px] text-zinc-500">
            Trade privately on your favorite protocols
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
  );
}
