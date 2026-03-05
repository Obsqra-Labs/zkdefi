type AgentStatus = "idle" | "monitoring" | "executing";

interface ExecutionLoopCardProps {
  hasAccount: boolean;
  hasOnboarded: boolean;
  agentStatus: AgentStatus;
}

const STEPS = ["Vault", "AI Brain", "Gate", "Execute", "Receipt"];

export function ExecutionLoopCard({ hasAccount, hasOnboarded, agentStatus }: ExecutionLoopCardProps) {
  let activeStep = 0;
  let statusLabel = "Ready";
  let statusTone = "text-emerald-400";

  if (!hasAccount) {
    activeStep = 0;
    statusLabel = "Connect wallet";
    statusTone = "text-zinc-400";
  } else if (!hasOnboarded) {
    activeStep = 0;
    statusLabel = "Complete onboarding";
    statusTone = "text-amber-400";
  } else if (agentStatus === "monitoring") {
    activeStep = 2;
    statusLabel = "Evaluating policy";
    statusTone = "text-cyan-400";
  } else if (agentStatus === "executing") {
    activeStep = 3;
    statusLabel = "Executing";
    statusTone = "text-orange-400";
  }

  return (
    <div className="glass rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-semibold text-zinc-100">Automated Yield Loop</h3>
        <span className={`text-xs font-medium ${statusTone}`}>{statusLabel}</span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">Vault is the source of truth. AI Pool is optional allocation. Capital only moves after gate checks pass.</p>
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((step, idx) => {
          const isActive = idx === activeStep;
          const isPast = idx < activeStep;
          return (
            <div key={step} className="flex items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded-md text-xs border ${isActive ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : isPast ? "border-zinc-700 bg-zinc-800/80 text-zinc-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-500"}`}
              >
                {step}
              </span>
              {idx < STEPS.length - 1 && <span className="text-zinc-600 text-xs">→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
