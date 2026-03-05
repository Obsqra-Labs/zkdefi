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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!address) return;
    const key = `zkdefi_ai_insight_dismissed_${address}`;
    const isDismissed = localStorage.getItem(key) === "true";
    setDismissed(isDismissed);
  }, [address]);

  // Entrance animation
  useEffect(() => {
    if (!dismissed && message) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [dismissed, message]);

  const handleDismiss = () => {
    setVisible(false);
    // Wait for exit animation before removing from DOM
    setTimeout(() => {
      if (address) {
        localStorage.setItem(`zkdefi_ai_insight_dismissed_${address}`, "true");
      }
      setDismissed(true);
      onDismiss?.();
    }, 200);
  };

  if (dismissed || !message) return null;

  return (
    <div
      className={`rounded-lg border border-blue-700/30 bg-blue-900/20 p-3 sm:p-4 transition-all duration-200 ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`}
      role="status"
      aria-label="AI insight recommendation"
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Brain className="w-5 h-5 text-blue-400 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-blue-200">AI Insight</h3>
            </div>
            <p className="text-sm font-medium text-blue-100 break-words">{message}</p>
            {reasoning && (
              <p className="text-xs text-blue-400/80 mt-1 break-words">{reasoning}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 hover:bg-blue-800/40 rounded transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Dismiss insight"
        >
          <X className="w-4 h-4 text-blue-400/70" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
