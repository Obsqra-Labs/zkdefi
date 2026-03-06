"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

interface SpinnerProps {
  label?: string;
}

interface ErrorAlertProps {
  message: string;
  onRetry?: () => void;
}

export function Spinner({ label = "Loading..." }: SpinnerProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorAlert({ message, onRetry }: ErrorAlertProps) {
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{message}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
