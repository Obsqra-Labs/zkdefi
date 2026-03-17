"use client";

import { useState, useCallback } from "react";

/* ── Risk presets ── */
const PRESETS = [
  { label: "Conservative", value: 20, color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
  { label: "Balanced", value: 50, color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5" },
  { label: "Aggressive", value: 80, color: "text-amber-400 border-amber-500/30 bg-amber-500/5" },
] as const;

interface RiskPickerProps {
  value: number;
  onChange: (value: number) => void;
  loading?: boolean;
}

/**
 * Compact risk picker: three preset buttons + fine-tune slider.
 * Replaces the full CapitalBrain sidebar for the Loop demo vertical layout.
 */
export function RiskPicker({ value, onChange, loading }: RiskPickerProps) {
  const [showSlider, setShowSlider] = useState(false);

  const activePreset = PRESETS.find((p) => Math.abs(p.value - value) <= 10);

  return (
    <div className="mx-auto max-w-lg space-y-3">
      {/* Preset buttons */}
      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((preset) => {
          const isActive = activePreset?.value === preset.value;
          return (
            <button
              key={preset.label}
              onClick={() => onChange(preset.value)}
              disabled={loading}
              className={`rounded-lg border px-3 py-2.5 text-center font-mono text-xs font-semibold transition-all disabled:opacity-40 ${
                isActive
                  ? preset.color
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Fine-tune toggle */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-zinc-600">
          Risk tolerance: <strong className="text-zinc-400">{value}%</strong>
        </span>
        <button
          onClick={() => setShowSlider((v) => !v)}
          className="font-mono text-[10px] text-zinc-600 underline underline-offset-2 hover:text-zinc-400"
        >
          {showSlider ? "Hide" : "Fine-tune"}
        </button>
      </div>

      {/* Slider (hidden by default) */}
      {showSlider && (
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
        />
      )}
    </div>
  );
}
