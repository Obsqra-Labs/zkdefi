"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, Shield, ArrowRight } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";

interface Position {
  protocol: string;
  value: number;
  color: string;
}

interface AggregatedPosition {
  total_value: string;
  public_positions_count: number;
  private_commitments_count: number;
}

const PROTOCOL_COLORS: Record<string, string> = {
  pools: "#10b981", // emerald
  ekubo: "#3b82f6", // blue
  jediswap: "#8b5cf6", // violet
};

export function PositionChart() {
  const { address, isConnected } = useAccount();
  const [positions, setPositions] = useState<Position[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [hoveredProtocol, setHoveredProtocol] = useState<string | null>(null);
  
  // Privacy toggle
  const [privacyMode, setPrivacyMode] = useState(false);
  const [aggregatedPosition, setAggregatedPosition] = useState<AggregatedPosition | null>(null);
  const [loadingAggregated, setLoadingAggregated] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setPositions([]);
      setTotalValue(0);
      setAggregatedPosition(null);
      return;
    }

    const fetchPositions = async () => {
      try {
        const protocols = [
          { id: 0, name: "pools" },
          { id: 1, name: "ekubo" },
          { id: 2, name: "jediswap" },
        ];

        const results = await Promise.all(
          protocols.map(async (p) => {
            try {
              const res = await fetch(`${API_BASE}/api/v1/zkdefi/position/${address}?protocol_id=${p.id}`);
              const data = await res.json();
              const value = parseFloat(data.position || "0");
              return { protocol: p.name, value, color: PROTOCOL_COLORS[p.name] || "#6b7280" };
            } catch {
              return { protocol: p.name, value: 0, color: PROTOCOL_COLORS[p.name] || "#6b7280" };
            }
          })
        );

        const validPositions = results.filter((p) => p.value > 0);
        setPositions(validPositions);
        setTotalValue(validPositions.reduce((sum, p) => sum + p.value, 0));
      } catch (e) {
        console.error("Failed to fetch positions:", e);
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [isConnected, address]);

  // Fetch aggregated position when privacy mode is enabled
  useEffect(() => {
    if (!privacyMode || !isConnected || !address) {
      return;
    }

    const fetchAggregated = async () => {
      setLoadingAggregated(true);
      try {
        const res = await fetch(`${API_BASE}/api/v1/zkdefi/position/aggregate/${address}`);
        const data = await res.json();
        setAggregatedPosition(data);
      } catch (e) {
        console.error("Failed to fetch aggregated position:", e);
        setAggregatedPosition(null);
      }
      setLoadingAggregated(false);
    };

    fetchAggregated();
    const interval = setInterval(fetchAggregated, 10000);
    return () => clearInterval(interval);
  }, [privacyMode, isConnected, address]);

  if (!isConnected) {
    return (
      <div className="glass rounded-2xl border border-zinc-800 p-6">
        <h3 className="text-lg font-semibold mb-4">Portfolio</h3>
        <div className="text-center py-12">
          <p className="text-zinc-400 text-sm">Connect wallet to see positions</p>
        </div>
      </div>
    );
  }

  if (positions.length === 0 && !privacyMode) {
    return (
      <div className="glass rounded-2xl border border-zinc-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Portfolio</h3>
          <PrivacyToggle enabled={privacyMode} onToggle={setPrivacyMode} />
        </div>
        <div className="text-center py-12">
          <p className="text-zinc-400 text-sm mb-2">No positions yet</p>
          <p className="text-xs text-zinc-500">Make your first deposit to see allocation</p>
        </div>
      </div>
    );
  }

  // Calculate angles for pie chart
  let currentAngle = 0;
  const segments = positions.map((pos) => {
    const percentage = totalValue > 0 ? (pos.value / totalValue) * 100 : 0;
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    currentAngle += angle;
    return {
      ...pos,
      percentage,
      startAngle,
      angle,
    };
  });

  const radius = 80;
  const centerX = 100;
  const centerY = 100;

  const createPath = (startAngle: number, angle: number) => {
    const start = polarToCartesian(centerX, centerY, radius, startAngle);
    const end = polarToCartesian(centerX, centerY, radius, startAngle + angle);
    const largeArcFlag = angle > 180 ? 1 : 0;
    return `M ${centerX} ${centerY} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
  };

  // Privacy Mode View
  if (privacyMode) {
    const aggTotal = aggregatedPosition ? parseFloat(aggregatedPosition.total_value) / 1e18 : 0;
    
    return (
      <div className="glass rounded-2xl border border-violet-800/50 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-violet-400" />
            <h3 className="text-lg font-semibold">Portfolio</h3>
            <span className="px-2 py-0.5 text-xs rounded bg-violet-600/20 text-violet-300 border border-violet-600/30">
              Private
            </span>
          </div>
          <PrivacyToggle enabled={privacyMode} onToggle={setPrivacyMode} />
        </div>

        {loadingAggregated ? (
          <div className="text-center py-12">
            <p className="text-zinc-400 text-sm">Loading aggregated position...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Aggregated Value */}
            <div className="text-center py-8">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative inline-block"
              >
                <div className="w-32 h-32 rounded-full bg-violet-500/10 border-2 border-violet-500/30 flex items-center justify-center">
                  <div>
                    <p className="text-3xl font-bold text-white">{aggTotal.toFixed(2)}</p>
                    <p className="text-xs text-zinc-400">Total Value</p>
                  </div>
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center">
                  <Lock className="w-4 h-4 text-white" />
                </div>
              </motion.div>
            </div>

            {/* Counts (no amounts revealed) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-700 text-center">
                <p className="text-2xl font-bold text-white">
                  {aggregatedPosition?.public_positions_count || 0}
                </p>
                <p className="text-xs text-zinc-400">Public Positions</p>
              </div>
              <div className="p-4 rounded-lg bg-violet-950/30 border border-violet-700/50 text-center">
                <p className="text-2xl font-bold text-violet-300">
                  {aggregatedPosition?.private_commitments_count || 0}
                </p>
                <p className="text-xs text-zinc-400">Private Commitments</p>
              </div>
            </div>

            {/* Privacy Notice */}
            <div className="p-3 rounded-lg bg-violet-950/20 border border-violet-500/30">
              <p className="text-xs text-violet-300 mb-1 font-medium">Privacy Mode Enabled</p>
              <p className="text-xs text-zinc-400">
                Individual protocol amounts are hidden. Only aggregated total is shown.
              </p>
            </div>

            {/* Generate Proof Button */}
            <button
              onClick={() => {
                // Scroll to compliance panel
                document.querySelector('[data-panel="compliance"]')?.scrollIntoView({ behavior: "smooth" });
              }}
              className="w-full px-4 py-3 border border-violet-600/50 hover:bg-violet-600/10 rounded-lg font-medium text-violet-300 transition-all flex items-center justify-center gap-2"
            >
              <Shield className="w-4 h-4" />
              Generate Aggregation Proof
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Public Mode View (Original Pie Chart)
  return (
    <div className="glass rounded-2xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Portfolio</h3>
        <PrivacyToggle enabled={privacyMode} onToggle={setPrivacyMode} />
      </div>

      <div className="flex flex-col items-center gap-6">
        {/* Pie Chart */}
        <div className="relative">
          <svg width="200" height="200" viewBox="0 0 200 200">
            {segments.map((segment, i) => (
              <motion.path
                key={segment.protocol}
                d={createPath(segment.startAngle, segment.angle)}
                fill={segment.color}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                onMouseEnter={() => setHoveredProtocol(segment.protocol)}
                onMouseLeave={() => setHoveredProtocol(null)}
                className="cursor-pointer transition-opacity"
                style={{
                  opacity: hoveredProtocol && hoveredProtocol !== segment.protocol ? 0.3 : 1,
                }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-2xl font-bold">{totalValue.toFixed(2)}</p>
              <p className="text-xs text-zinc-400">Total Value</p>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="w-full space-y-2">
          {segments.map((segment) => (
            <div
              key={segment.protocol}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-zinc-800/50 transition-colors cursor-pointer"
              onMouseEnter={() => setHoveredProtocol(segment.protocol)}
              onMouseLeave={() => setHoveredProtocol(null)}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="text-sm font-medium capitalize">{segment.protocol}</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{segment.value.toFixed(2)}</p>
                <p className="text-xs text-zinc-400">{segment.percentage.toFixed(1)}%</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Privacy Toggle Component
function PrivacyToggle({ enabled, onToggle }: { enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        enabled
          ? "bg-violet-600/20 text-violet-300 border border-violet-600/30"
          : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
      }`}
    >
      {enabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      {enabled ? "Private" : "Public"}
    </button>
  );
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}
