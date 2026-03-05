"use client";

import { RefreshCw, AlertTriangle } from "lucide-react";

/* ── Spinner ────────────────────────────────────────────────────────── */

interface SpinnerProps {
  /** Tailwind size class, e.g. "w-5 h-5" */
  size?: string;
  /** Tailwind colour class, e.g. "text-emerald-400" */
  color?: string;
  /** Optional label displayed beside the spinner */
  label?: string;
}

/**
 * Re-usable loading spinner.
 *
 * Usage:
 * ```tsx
 * <Spinner />                         // default 5×5 emerald
 * <Spinner size="w-8 h-8" label="Loading positions…" />
 * ```
 */
export function Spinner({ size = "w-5 h-5", color = "text-emerald-400", label }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <RefreshCw className={`${size} ${color} animate-spin`} />
      {label && <span className="text-xs text-zinc-400">{label}</span>}
    </span>
  );
}

/* ── ErrorAlert ─────────────────────────────────────────────────────── */

interface ErrorAlertProps {
  /** The error message to display */
  message: string;
  /** Optional callback; if provided an "Retry" button is rendered */
  onRetry?: () => void;
  /** Additional class names */
  className?: string;
}

/**
 * Inline error banner with optional retry action.
 *
 * Usage:
 * ```tsx
 * {error && <ErrorAlert message={error} onRetry={refresh} />}
 * ```
 */
export function ErrorAlert({ message, onRetry, className = "" }: ErrorAlertProps) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 ${className}`}
    >
      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-2 rounded border border-red-500/40 px-2 py-0.5 text-red-300 hover:bg-red-500/20 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
