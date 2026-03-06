"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, FlaskConical } from "lucide-react";

import { ZkRagAgentConsole } from "@/components/zkdefi/ZkRagAgentConsole";

interface BrainSurfaceContainerProps {
  address?: string;
  initialSubTab?: "agent" | "models" | "pipeline" | "agents";
}

type BrainSubTab = "agent" | "models" | "pipeline" | "agents";

const SUB_TABS: BrainSubTab[] = ["agent", "models", "pipeline", "agents"];

export function BrainSurfaceContainer({
  address,
  initialSubTab = "agent",
}: BrainSurfaceContainerProps) {
  const [subTab, setSubTab] = useState<BrainSubTab>(initialSubTab);

  useEffect(() => {
    if (initialSubTab && SUB_TABS.includes(initialSubTab)) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {SUB_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSubTab(tab)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                subTab === tab
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Brain Surface</h3>
            <p className="mt-1 text-sm text-zinc-400">Active sub-tab: {subTab}</p>
          </div>
          <Bot className="h-5 w-5 text-cyan-300" />
        </div>

        {subTab === "agent" ? (
          <ZkRagAgentConsole userAddress={address} />
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
            {subTab} workspace placeholder is active. Integrate full controls here as needed.
          </div>
        )}

        <div className="mt-4">
          <Link
            href="/products/agent-studio#standalone"
            className="inline-flex items-center gap-2 text-sm text-emerald-300 hover:text-emerald-200"
          >
            <FlaskConical className="h-4 w-4" />
            Run standalone agent demo
          </Link>
        </div>
      </article>
    </section>
  );
}
