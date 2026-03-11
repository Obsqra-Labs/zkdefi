"use client";

interface MemoryLaneAnalyticsProps {
  totalExecutions: number;
  totalYield: string;
  successRate: number;
  avgReputation: string;
}

export function MemoryLaneAnalytics({
  totalExecutions,
  totalYield,
  successRate,
  avgReputation,
}: MemoryLaneAnalyticsProps) {
  return (
    <div className="border-t border-slate-700 pt-3 text-xs text-slate-400 grid grid-cols-4 gap-2">
      <div>
        <span className="text-slate-400">Total Trades:</span>
        <p className="text-white font-medium">{totalExecutions}</p>
      </div>
      <div>
        <span className="text-slate-400">Total Yield:</span>
        <p className="text-green-400 font-medium">+{totalYield}%</p>
      </div>
      <div>
        <span className="text-slate-400">Success Rate:</span>
        <p className="text-white font-medium">{successRate}%</p>
      </div>
      <div>
        <span className="text-slate-400">Avg Reputation:</span>
        <p className="text-blue-400 font-medium">+{avgReputation}</p>
      </div>
    </div>
  );
}
