"use client";
import { CreditOverviewPanel } from "./credit/CreditOverviewPanel";
import { FicoPackProofPanel } from "./credit/FicoPackProofPanel";
import { ExplainabilityPanel } from "./credit/ExplainabilityPanel";
import { SystemPerksPanel } from "./credit/SystemPerksPanel";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api/client";

interface CreditReputationHubProps {
  address: string;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "proofs", label: "FICO Pack Proofs" },
  { id: "explainability", label: "Explainability" },
  { id: "perks", label: "System Perks" },
];

export function CreditReputationHub({ address }: CreditReputationHubProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [creditData, setCreditData] = useState<{ credit_line?: any; reputation?: { tier: number } } | null>(null);
  const [completedProofs, setCompletedProofs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        // Canonical source for profile + decisions.
        const creditRes = await fetch(apiUrl(`/api/v1/zkdefi/risk_profile/v2/${address}`));
        if (creditRes.ok) {
          const data = await creditRes.json();
          const lendingLimits = data?.decisions?.lending?.limits ?? data?.predictive_credit ?? null;
          const tier = Number(data?.reputation?.tier ?? 0);
          setCreditData({
            credit_line: lendingLimits,
            reputation: { tier: Number.isFinite(tier) ? tier : 0 },
          });

          const byType = data?.passport?.receipt_summary?.by_type;
          if (byType && typeof byType === "object") {
            const completed = Object.entries(byType)
              .filter(([, count]) => Number(count) > 0)
              .map(([proofType]) => proofType);
            setCompletedProofs(completed);
          } else {
            setCompletedProofs([]);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id ? "border-blue-500 text-blue-400" : "border-transparent text-zinc-400 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <CreditOverviewPanel address={address} />}
      {activeTab === "proofs" && <FicoPackProofPanel address={address} />}
      {activeTab === "explainability" && creditData?.credit_line && (
        <ExplainabilityPanel creditLine={creditData.credit_line} />
      )}
      {activeTab === "perks" && (
        <SystemPerksPanel
          completedProofs={completedProofs}
          tier={creditData?.reputation?.tier ?? 0}
        />
      )}
    </div>
  );
}
