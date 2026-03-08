"use client";

import { useCallback } from "react";
import {
  ArrowLeftRight,
  Droplets,
  Landmark,
  Layers,
  Target,
  RefreshCw,
  EyeOff,
  BookLock,
} from "lucide-react";
import type { OpportunityFilters } from "@/services/TradeDeskApiService";

interface FilterBarProps {
  filters: OpportunityFilters;
  onChange: (filters: OpportunityFilters) => void;
}

const TYPE_BUTTONS: {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
}[] = [
  { key: "swap", label: "Swap", icon: ArrowLeftRight, color: "bg-cyan-600" },
  { key: "lp", label: "LP", icon: Droplets, color: "bg-emerald-600" },
  { key: "lending", label: "Lend", icon: Landmark, color: "bg-amber-600" },
  { key: "staking", label: "Stake", icon: Layers, color: "bg-purple-600" },
  { key: "limit", label: "Limit", icon: Target, color: "bg-blue-600" },
  { key: "dca", label: "DCA", icon: RefreshCw, color: "bg-orange-600" },
  { key: "privacy", label: "Privacy", icon: EyeOff, color: "bg-violet-600" },
  { key: "dark_ledger", label: "Dark", icon: BookLock, color: "bg-slate-600" },
];

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const activeTypes = filters.type ? filters.type.split(",") : [];
  const allActive = activeTypes.length === 0;

  const toggleType = useCallback(
    (key: string) => {
      let next: string[];
      if (allActive) {
        next = TYPE_BUTTONS.map((b) => b.key).filter((k) => k !== key);
      } else if (activeTypes.includes(key)) {
        next = activeTypes.filter((t) => t !== key);
      } else {
        next = [...activeTypes, key];
      }
      if (next.length === 0 || next.length === TYPE_BUTTONS.length) {
        onChange({ ...filters, type: undefined });
      } else {
        onChange({ ...filters, type: next.join(",") });
      }
    },
    [filters, onChange, activeTypes, allActive],
  );

  return (
    <div className="flex items-center gap-1.5 px-2 py-2 bg-slate-900 rounded-lg border border-slate-700 overflow-x-auto">
      {TYPE_BUTTONS.map(({ key, label, icon: Icon, color }) => {
        const active = allActive || activeTypes.includes(key);
        return (
          <button
            key={key}
            onClick={() => toggleType(key)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
              active
                ? `${color} text-white`
                : "bg-slate-800 text-slate-500 hover:text-slate-300"
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
