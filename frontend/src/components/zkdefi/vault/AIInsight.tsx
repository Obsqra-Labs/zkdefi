"use client";

/**
 * AIInsight — Contextual LLM recommendation card for Portfolio tab.
 * Dismissable and persists dismissed state in localStorage.
 */

import { useState, useEffect } from "react";
import { Brain, X } from "lucide-react";

export interface AIInsightProps {
  address?: string;
  message: string;
  reasoning?: string;
  onDismiss?: () => void;
}

export function AIInsight({ address, message, reasoning, onDismiss }: AIInsightProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!address) return;
    const key = `zkdefi_ai_insight_dismissed_${address}`;
    const isDismissed = localStorage.getItem(key) === "true";
    setDismissed(isDismissed);
  }, [address]);

  const handleDismiss = () => {
    if (address) {
      localStorage.setItem(`zkdefi_ai_insight_dismissed_${address}`, "true");
    }
    setDismissed(true);
    onDismiss?.();
  };

  if (dismissed) return null;

  return (
    <div className="rounded-lg border border-blue-700/30 bg-blue-900/20 p-4 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Brain className="w-5 h-5 text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-blue-200">AI Insight</h3>
            </div>
            <p className="text-sm font-medium text-blue-100">{message}</p>
            {reasoning && (
              <p className="text-xs text-blue-400/80 mt-1">{reasoning}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 hover:bg-blue-800/40 rounded transition-colors shrink-0"
          aria-label="Dismiss insight"
        >
          <X className="w-4 h-4 text-blue-400/70" />
        </button>
      </div>
    </div>
  );
}
