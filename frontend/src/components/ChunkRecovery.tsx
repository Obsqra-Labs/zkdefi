"use client";

import { useEffect } from "react";

const RELOAD_STATE_KEY = "__zkdefi_chunk_reload_state__";
const RELOAD_WINDOW_MS = 2 * 60 * 1000;
const MAX_RELOAD_ATTEMPTS = 3;

function isChunkLikeErrorMessage(message: string): boolean {
  const text = (message || "").toLowerCase();
  return (
    text.includes("chunkloaderror") ||
    text.includes("loading chunk") ||
    /loading chunk \d+ failed/i.test(message || "") ||
    (text.includes("chunk") && text.includes("failed")) ||
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("older or newer deployment") ||
    (text.includes("/_next/static/chunks/") && text.includes("failed")) ||
    (text.includes("423") && text.includes("react.dev/errors")) ||
    text.includes("global-error")
  );
}

function isNextStaticAssetUrl(url: string): boolean {
  const text = (url || "").toLowerCase();
  return text.includes("/_next/static/") || text.includes("global-error");
}

function readReloadState(): { ts: number; attempts: number } | null {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; attempts?: number };
    if (typeof parsed.ts !== "number") return null;
    const attempts = typeof parsed.attempts === "number" ? parsed.attempts : 1;
    return { ts: parsed.ts, attempts };
  } catch {
    return null;
  }
}

function canReload(): boolean {
  const state = readReloadState();
  if (!state) return true;
  if (Date.now() - state.ts > RELOAD_WINDOW_MS) return true;
  return state.attempts < MAX_RELOAD_ATTEMPTS;
}

function markReload(): void {
  try {
    const prev = readReloadState();
    const now = Date.now();
    const withinWindow = prev ? now - prev.ts <= RELOAD_WINDOW_MS : false;
    const attempts = withinWindow ? Math.min(prev!.attempts + 1, MAX_RELOAD_ATTEMPTS) : 1;
    window.sessionStorage.setItem(RELOAD_STATE_KEY, JSON.stringify({ ts: now, attempts }));
  } catch {
    // ignore storage errors
  }
}

async function forceChunkRecoveryReload(): Promise<void> {
  if (!canReload()) return;
  markReload();

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // ignore cache purge failures
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_r", String(Date.now()));
  window.location.replace(url.toString());
}

export function ChunkRecovery() {
  useEffect(() => {
    (window as { __zkdefiChunkReload?: () => Promise<void> }).__zkdefiChunkReload = forceChunkRecoveryReload;

    const sharedReload = () => {
      const handler = (window as { __zkdefiChunkReload?: () => Promise<void> }).__zkdefiChunkReload;
      if (typeof handler === "function") {
        void handler();
        return true;
      }
      return false;
    };

    const onError = (event: ErrorEvent) => {
      const target = event.target as EventTarget & { tagName?: string; src?: string; href?: string };
      const tagName = target?.tagName?.toUpperCase();
      if (tagName === "SCRIPT" || tagName === "LINK") {
        const assetUrl = (target.src || target.href || "").toString();
        if (isNextStaticAssetUrl(assetUrl)) {
          if (!sharedReload()) {
            void forceChunkRecoveryReload();
          }
          return;
        }
      }

      if (isChunkLikeErrorMessage(event.message || "")) {
        if (!sharedReload()) {
          void forceChunkRecoveryReload();
        }
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      const message =
        (typeof reason === "string" && reason) ||
        (reason && typeof reason === "object" && "message" in reason && typeof (reason as { message?: unknown }).message === "string"
          ? ((reason as { message: string }).message)
          : String(reason || ""));

      if (isChunkLikeErrorMessage(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!sharedReload()) {
          void forceChunkRecoveryReload();
        }
      }
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection, true);

    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection, true);
      const chunkReload = (window as { __zkdefiChunkReload?: () => Promise<void> }).__zkdefiChunkReload;
      if (chunkReload === forceChunkRecoveryReload) {
        delete (window as { __zkdefiChunkReload?: () => Promise<void> }).__zkdefiChunkReload;
      }
    };
  }, []);

  return null;
}
