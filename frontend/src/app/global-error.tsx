"use client";

import { useEffect, useRef } from "react";

const CHUNK_RELOAD_KEY = "__zkdefi_chunk_reload_state__";
const CHUNK_RELOAD_WINDOW_MS = 2 * 60 * 1000;
const CHUNK_RELOAD_MAX_ATTEMPTS = 3;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = typeof error?.message === "string" ? error.message : "";
  const lower = message.toLowerCase();
  const isChunkError =
    error?.name === "ChunkLoadError" ||
    (typeof message === "string" &&
      (message.includes("Loading chunk") ||
        message.includes("ChunkLoadError") ||
        /chunk\s+\d+\s+failed/i.test(message) ||
        (message.includes("423") && message.includes("react.dev/errors")) ||
        lower.includes("older or newer deployment")));

  const forceReloadForChunkError = async () => {
    const sharedReload = (window as { __zkdefiChunkReload?: () => Promise<void> }).__zkdefiChunkReload;
    if (typeof sharedReload === "function") {
      await sharedReload();
      return;
    }
    try {
      const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      const parsed = raw ? (JSON.parse(raw) as { ts?: number; attempts?: number }) : null;
      const now = Date.now();
      const ts = typeof parsed?.ts === "number" ? parsed.ts : 0;
      const attempts = typeof parsed?.attempts === "number" ? parsed.attempts : 0;
      const withinWindow = now - ts <= CHUNK_RELOAD_WINDOW_MS;
      if (withinWindow && attempts >= CHUNK_RELOAD_MAX_ATTEMPTS) return;
      const nextAttempts = withinWindow ? attempts + 1 : 1;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ ts: now, attempts: nextAttempts }));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // ignore
    }
    const q = window.location.search ? "&" : "?";
    const next = `${window.location.pathname}${window.location.search}${q}_r=${Date.now()}${window.location.hash}`;
    window.location.replace(next);
  };

  const autoReloadAttempted = useRef(false);
  useEffect(() => {
    if (isChunkError && !autoReloadAttempted.current) {
      autoReloadAttempted.current = true;
      void forceReloadForChunkError();
    }
  }, [isChunkError]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui", background: "#18181b", color: "#fafafa", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
        <div style={{ textAlign: "center", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            {isChunkError ? "Update required" : "Something went wrong"}
          </h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.875rem", marginBottom: "1rem" }}>
            {isChunkError
              ? "A new version of the app is available. Reload the page to get the latest version."
              : "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => {
              if (isChunkError) {
                void forceReloadForChunkError();
              } else {
                reset();
              }
            }}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              background: "#3f3f46",
              color: "#fafafa",
              border: "1px solid #52525b",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            {isChunkError ? "Reload page" : "Try again"}
          </button>
        </div>
      </body>
    </html>
  );
}
