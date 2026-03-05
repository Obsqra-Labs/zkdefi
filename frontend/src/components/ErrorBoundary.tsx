"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const CHUNK_RELOAD_KEY = "__zkdefi_chunk_reload_state__";
const CHUNK_RELOAD_WINDOW_MS = 2 * 60 * 1000;
const CHUNK_RELOAD_MAX_ATTEMPTS = 3;

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  private static isChunkLoadError(error: Error): boolean {
    const s = String(error?.message ?? "");
    const lower = s.toLowerCase();
    return (
      s.includes("ChunkLoadError") ||
      s.includes("Loading chunk") ||
      /chunk\s+\d+\s+failed/i.test(s) ||
      (s.includes("/_next/static/chunks/") && s.includes("failed")) ||
      (s.includes("423") && s.includes("react.dev/errors")) ||
      lower.includes("older or newer deployment")
    );
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    if (ErrorBoundary.isChunkLoadError(error)) {
      this.tryAutoRecoverChunkError();
      return;
    }
  }

  private readChunkReloadState(): { ts: number; attempts: number } | null {
    try {
      const raw = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { ts?: number; attempts?: number };
      if (typeof parsed.ts !== "number") return null;
      return {
        ts: parsed.ts,
        attempts: typeof parsed.attempts === "number" ? parsed.attempts : 1,
      };
    } catch {
      return null;
    }
  }

  private canAutoReloadChunkError(): boolean {
    const state = this.readChunkReloadState();
    if (!state) return true;
    if (Date.now() - state.ts > CHUNK_RELOAD_WINDOW_MS) return true;
    return state.attempts < CHUNK_RELOAD_MAX_ATTEMPTS;
  }

  private markChunkReload(): void {
    try {
      const prev = this.readChunkReloadState();
      const now = Date.now();
      const withinWindow = prev ? now - prev.ts <= CHUNK_RELOAD_WINDOW_MS : false;
      const attempts = withinWindow ? Math.min(prev!.attempts + 1, CHUNK_RELOAD_MAX_ATTEMPTS) : 1;
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ ts: now, attempts }));
    } catch {
      // ignore storage errors
    }
  }

  private tryAutoRecoverChunkError = async () => {
    if (!this.canAutoReloadChunkError()) return;
    this.markChunkReload();
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // ignore cache purge failures
    }
    const q = window.location.search ? "&" : "?";
    const u = `${window.location.pathname}${window.location.search}${q}_r=${Date.now()}${window.location.hash}`;
    window.location.replace(u);
  };

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    const q = window.location.search ? "&" : "?";
    const u = `${window.location.pathname}${window.location.search}${q}_r=${Date.now()}${window.location.hash}`;
    window.location.replace(u);
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-4">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-zinc-400 mb-6 text-sm">
              An unexpected error occurred. This might be due to a network issue or a temporary problem.
            </p>
            <div className="space-y-3">
              <button
                onClick={this.handleRetry}
                className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
              >
                Reload Page
              </button>
              <a
                href="/"
                className="block w-full px-6 py-3 border border-zinc-700 hover:bg-zinc-800 rounded-lg font-medium transition-colors"
              >
                Go to Home
              </a>
            </div>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-xs text-zinc-500 cursor-pointer">Error details</summary>
                <pre className="mt-2 p-3 bg-zinc-900 rounded text-xs text-red-400 overflow-auto max-h-40">
                  {this.state.error.message}
                  {"\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
