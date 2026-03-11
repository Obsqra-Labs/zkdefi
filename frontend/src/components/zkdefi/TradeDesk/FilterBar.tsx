"use client";

import {
  ArrowLeftRight,
  Droplets,
  Landmark,
  Layers,
  Target,
  RefreshCw,
  EyeOff,
  LayoutGrid,
} from "lucide-react";

/** Section tab: one active at a time — where you browse that category. */
export type OpportunitySectionTab =
  | "all"
  | "swap"
  | "lp"
  | "lending"
  | "staking"
  | "limit"
  | "dca"
  | "privacy";

export const SECTION_TABS: {
  key: OpportunitySectionTab;
  label: string;
  icon: React.ElementType;
  color: string;
}[] = [
  { key: "all", label: "All", icon: LayoutGrid, color: "bg-slate-600" },
  { key: "swap", label: "Swap", icon: ArrowLeftRight, color: "bg-cyan-600" },
  { key: "lp", label: "LP", icon: Droplets, color: "bg-emerald-600" },
  { key: "lending", label: "Lend", icon: Landmark, color: "bg-amber-600" },
  { key: "staking", label: "Stake", icon: Layers, color: "bg-purple-600" },
  { key: "limit", label: "Limit", icon: Target, color: "bg-blue-600" },
  { key: "dca", label: "DCA", icon: RefreshCw, color: "bg-orange-600" },
  { key: "privacy", label: "Private", icon: EyeOff, color: "bg-violet-600" },
];

export interface SectionTabBarProps {
  activeTab: OpportunitySectionTab;
  onTabChange: (tab: OpportunitySectionTab) => void;
  /** Count per type (swap, lp, lending, ...). "all" uses total. */
  typeCounts: Record<string, number>;
  totalCount: number;
}

export function SectionTabBar({
  activeTab,
  onTabChange,
  typeCounts,
  totalCount,
}: SectionTabBarProps) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-2 bg-slate-900 rounded-lg border border-slate-700 overflow-x-auto scrollbar-thin"
      role="tablist"
      aria-label="Opportunity sections"
    >
      {SECTION_TABS.map(({ key, label, icon: Icon, color }) => {
        const count = key === "all" ? totalCount : typeCounts[key] ?? 0;
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              isActive
                ? `${color} text-white`
                : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
            }`}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{label}</span>
            <span
              className={`tabular-nums ${isActive ? "text-white/80" : "text-slate-500"}`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
