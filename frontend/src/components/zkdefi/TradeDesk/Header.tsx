import type { UserReputation } from "@/services/ReputationGatingService";

interface HeaderProps {
  mode: "manual" | "advisory" | "terminal";
  onModeChange: (mode: "manual" | "advisory" | "terminal") => void;
  userReputation: UserReputation | null;
  stats: {
    totalYield24h: number;
    totalYield7d: number;
    apy: number;
    riskScore: number;
    borrowingPower: number;
  };
}

export function Header({ mode, onModeChange, userReputation, stats }: HeaderProps) {
  return (
    <div className="bg-slate-900 border-b border-slate-700 px-6 py-4">
      <div className="flex justify-between items-center">
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Trade Desk</h1>
          <div className="flex gap-6 mt-3 text-sm">
            <div>
              <span className="text-slate-400">24h Yield:</span>
              <span className="ml-2 text-green-400 font-medium">{stats.totalYield24h.toFixed(2)}%</span>
            </div>
            <div>
              <span className="text-slate-400">7d Yield:</span>
              <span className="ml-2 text-green-400 font-medium">{stats.totalYield7d.toFixed(2)}%</span>
            </div>
            <div>
              <span className="text-slate-400">APY:</span>
              <span className="ml-2 text-green-400 font-medium">{stats.apy.toFixed(2)}%</span>
            </div>
            <div>
              <span className="text-slate-400">Risk:</span>
              <span className="ml-2 font-medium">{stats.riskScore.toFixed(0)}</span>
            </div>
            {userReputation && (
              <div>
                <span className="text-slate-400">Tier:</span>
                <span className="ml-2 font-medium">{userReputation.tier}</span>
              </div>
            )}
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2">
          {["manual", "advisory", "terminal"].map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m as any)}
              className={`px-3 py-1.5 rounded text-sm capitalize font-medium transition ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
