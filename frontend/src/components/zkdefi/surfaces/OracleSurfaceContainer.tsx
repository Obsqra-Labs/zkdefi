"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, Radio, Dna } from "lucide-react";
import { OracleSignalsTab } from "@/components/zkdefi/oracle/OracleSignalsTab";
import { OracleRadarTab } from "@/components/zkdefi/oracle/OracleRadarTab";
import { OracleGenomeTab } from "@/components/zkdefi/oracle/OracleGenomeTab";

export type OracleSubTab = "signals" | "radar" | "genome";

export interface OracleSurfaceContainerProps {
  address: string | undefined;
  initialSubTab?: OracleSubTab;
  onNavigateToVault?: (sub: string) => void;
}

const SUB_TABS: { id: OracleSubTab; label: string; icon: React.ReactNode }[] = [
  { id: "signals", label: "Signals", icon: <Radio className="w-4 h-4" /> },
  { id: "radar", label: "Radar", icon: <Activity className="w-4 h-4" /> },
  { id: "genome", label: "Genome", icon: <Dna className="w-4 h-4" /> },
];

export function OracleSurfaceContainer({
  address,
  initialSubTab = "signals",
  onNavigateToVault,
}: OracleSurfaceContainerProps) {
  const [subTab, setSubTab] = useState<OracleSubTab>(initialSubTab);

  useEffect(() => {
    if (initialSubTab && initialSubTab !== subTab) {
      setSubTab(initialSubTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync from URL/parent, not when user clicks tab
  }, [initialSubTab]);

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-zinc-800 pb-3 overflow-x-auto min-w-0">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`shrink-0 px-5 py-2.5 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${
              subTab === t.id
                ? "bg-emerald-600 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "signals" && (
        <OracleSignalsTab address={address} />
      )}
      {subTab === "radar" && (
        <OracleRadarTab address={address} onNavigateToVault={onNavigateToVault} />
      )}
      {subTab === "genome" && (
        <OracleGenomeTab address={address} />
      )}
    </div>
  );
}
