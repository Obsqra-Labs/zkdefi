"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Brain, RefreshCw } from "lucide-react";
import {
  ModelComposer,
  type AgentDecisionLogic,
  type ComposerDraft,
  type ComposedAgent,
} from "@/components/zkdefi/ModelComposer";
import { MyAgents } from "@/components/zkdefi/MyAgents";

export type { AgentDecisionLogic };

export interface AgentBuilderDraft extends ComposerDraft {
  decisionLogic?: AgentDecisionLogic;
}

interface ActivityEntry {
  id: number;
  level: "info" | "success" | "error";
  message: string;
}

interface AgentBuilderDrawerProps {
  userAddress: string;
  draft?: AgentBuilderDraft | null;
}

export function AgentBuilderDrawer({ userAddress, draft }: AgentBuilderDrawerProps) {
  const [activeTab, setActiveTab] = useState<"compose" | "agents">("compose");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [highlightAgentId, setHighlightAgentId] = useState<string | null>(null);
  const activityIdRef = useRef(0);

  const addActivity = useCallback((level: ActivityEntry["level"], message: string) => {
    activityIdRef.current += 1;
    const entryId = activityIdRef.current;
    setActivity((prev) => [{ id: entryId, level, message }, ...prev].slice(0, 10));
  }, []);

  useEffect(() => {
    if (!draft) return;
    setActiveTab("compose");
    setHighlightAgentId(null);
    const count = draft.processors?.length || 0;
    addActivity("info", `Loaded circuit draft (${count} model${count === 1 ? "" : "s"})`);
  }, [addActivity, draft]);

  const handleAgentCreated = useCallback(
    (agent: ComposedAgent) => {
      addActivity("success", `Created ${agent.name}`);
      setHighlightAgentId(agent.id);
      setRefreshTrigger((prev) => prev + 1);
      setActiveTab("agents");
    },
    [addActivity]
  );

  const handleComposerLog = useCallback(
    (level: "info" | "success" | "error", message: string) => {
      addActivity(level, message);
    },
    [addActivity]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Agent Builder</h3>
            <p className="text-xs text-zinc-500">Recovered from the historical agents subtab flow.</p>
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-1">
          <button
            onClick={() => setActiveTab("compose")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "compose" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Compose Agent
          </button>
          <button
            onClick={() => {
              setActiveTab("agents");
              setRefreshTrigger((prev) => prev + 1);
              addActivity("info", "Refreshed agent list");
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "agents" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            My Agents
          </button>
        </div>
      </div>

      {activeTab === "compose" && (
        <ModelComposer
          userAddress={userAddress}
          draft={draft}
          onAgentCreated={handleAgentCreated}
          onLog={handleComposerLog}
        />
      )}

      {activeTab === "agents" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Brain className="w-3.5 h-3.5" />
              Active Agent Registry
            </span>
            <button
              onClick={() => setRefreshTrigger((prev) => prev + 1)}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
          <MyAgents
            userAddress={userAddress}
            refreshTrigger={refreshTrigger}
            highlightAgentId={highlightAgentId}
          />
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
        <p className="mb-2 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          <Activity className="h-3 w-3" />
          Builder Activity
        </p>
        {activity.length === 0 ? (
          <p className="text-xs text-zinc-600">No activity yet.</p>
        ) : (
          <div className="space-y-1.5">
            {activity.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    entry.level === "success"
                      ? "bg-emerald-400"
                      : entry.level === "error"
                        ? "bg-red-400"
                        : "bg-cyan-400"
                  }`}
                />
                <span className="text-zinc-300">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
