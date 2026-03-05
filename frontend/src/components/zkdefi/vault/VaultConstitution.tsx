"use client";

import { useState, useCallback } from "react";
import { Shield, ChevronDown, ChevronUp, Check } from "lucide-react";

export interface VaultConstitutionRules {
  maxSingleAdapterPct: number;
  allowedProtocols: string[];
  minCooldownMinutes: number;
  maxDrawdownPct: number;
  requireMevProtection: boolean;
  allowCommunityAdapters: boolean;
}

const DEFAULT_RULES: VaultConstitutionRules = {
  maxSingleAdapterPct: 40,
  allowedProtocols: ["ekubo", "lending", "staking"],
  minCooldownMinutes: 60,
  maxDrawdownPct: 10,
  requireMevProtection: true,
  allowCommunityAdapters: false,
};

const PROTOCOL_OPTIONS = [
  { id: "ekubo", label: "Ekubo LP" },
  { id: "lending", label: "Lending (Vesu)" },
  { id: "staking", label: "Staking" },
];

export interface VaultConstitutionProps {
  mode?: "edit" | "view";
  initialRules?: Partial<VaultConstitutionRules>;
  onChange?: (rules: VaultConstitutionRules) => void;
}

export function VaultConstitution({
  mode = "edit",
  initialRules,
  onChange,
}: VaultConstitutionProps) {
  const [rules, setRules] = useState<VaultConstitutionRules>({
    ...DEFAULT_RULES,
    ...initialRules,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = useCallback(
    (patch: Partial<VaultConstitutionRules>) => {
      setRules((prev) => {
        const next = { ...prev, ...patch };
        onChange?.(next);
        return next;
      });
    },
    [onChange],
  );

  const toggleProtocol = useCallback(
    (id: string) => {
      setRules((prev) => {
        const has = prev.allowedProtocols.includes(id);
        const next = {
          ...prev,
          allowedProtocols: has
            ? prev.allowedProtocols.filter((p) => p !== id)
            : [...prev.allowedProtocols, id],
        };
        onChange?.(next);
        return next;
      });
    },
    [onChange],
  );

  const isEditing = mode === "edit";

  return (
    <div className="space-y-5">
      {/* Max single adapter allocation */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Max Allocation per Strategy
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={80}
            step={5}
            value={rules.maxSingleAdapterPct}
            onChange={(e) =>
              update({ maxSingleAdapterPct: Number(e.target.value) })
            }
            disabled={!isEditing}
            className="flex-1 accent-emerald-500"
          />
          <span className="text-sm font-mono w-12 text-right text-emerald-400">
            {rules.maxSingleAdapterPct}%
          </span>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          No single adapter can hold more than this share of your vault
        </p>
      </div>

      {/* Allowed protocols */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Allowed Protocols
        </label>
        <div className="grid grid-cols-3 gap-2">
          {PROTOCOL_OPTIONS.map((p) => {
            const active = rules.allowedProtocols.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={!isEditing}
                onClick={() => toggleProtocol(p.id)}
                className={`p-2.5 rounded-lg border text-sm transition-all ${
                  active
                    ? "bg-emerald-600/20 border-emerald-500 text-emerald-400"
                    : "bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                } disabled:cursor-not-allowed`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  {active && <Check className="w-3 h-3" />}
                  {p.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Max drawdown */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Max Drawdown Limit
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={2}
            max={30}
            step={1}
            value={rules.maxDrawdownPct}
            onChange={(e) =>
              update({ maxDrawdownPct: Number(e.target.value) })
            }
            disabled={!isEditing}
            className="flex-1 accent-emerald-500"
          />
          <span className="text-sm font-mono w-12 text-right text-emerald-400">
            {rules.maxDrawdownPct}%
          </span>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          Agent pauses if portfolio drops beyond this threshold
        </p>
      </div>

      {/* MEV protection */}
      <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50 cursor-pointer">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            MEV Protection
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Require commit-reveal for all rebalances
          </p>
        </div>
        <input
          type="checkbox"
          checked={rules.requireMevProtection}
          onChange={(e) =>
            update({ requireMevProtection: e.target.checked })
          }
          disabled={!isEditing}
          className="w-4 h-4 accent-emerald-500"
        />
      </label>

      {/* Advanced section */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {showAdvanced ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
        Advanced Rules
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-2 border-l-2 border-zinc-800">
          {/* Min cooldown */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Minimum Cooldown Between Rebalances
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={1440}
                value={rules.minCooldownMinutes}
                onChange={(e) =>
                  update({
                    minCooldownMinutes: Math.max(
                      5,
                      parseInt(e.target.value) || 60,
                    ),
                  })
                }
                disabled={!isEditing}
                className="w-24 p-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500 outline-none text-sm"
              />
              <span className="text-sm text-zinc-400">minutes</span>
            </div>
          </div>

          {/* Community adapters */}
          <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50 cursor-pointer">
            <div>
              <div className="text-sm font-medium">Community Adapters</div>
              <p className="text-xs text-zinc-500 mt-0.5">
                Allow third-party strategies (higher risk)
              </p>
            </div>
            <input
              type="checkbox"
              checked={rules.allowCommunityAdapters}
              onChange={(e) =>
                update({ allowCommunityAdapters: e.target.checked })
              }
              disabled={!isEditing}
              className="w-4 h-4 accent-emerald-500"
            />
          </label>
        </div>
      )}
    </div>
  );
}
