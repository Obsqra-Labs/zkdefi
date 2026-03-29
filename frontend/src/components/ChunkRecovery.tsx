"use client";

import { useEffect } from "react";

const RELOAD_MARKER_KEY = "zkdefi_chunk_recovery_once";

function isChunkErrorMessage(message: string): boolean {
  const value = message.toLowerCase();
  return value.includes("chunkloaderror") || value.includes("loading chunk");
}

function reloadForChunkRecovery() {
  if (typeof window === "undefined") return;
  if (window.sessionStorage.getItem(RELOAD_MARKER_KEY) === "1") return;
  window.sessionStorage.setItem(RELOAD_MARKER_KEY, "1");
  const url = new URL(window.location.href);
  url.searchParams.set("_r", Date.now().toString());
  window.location.replace(url.toString());
}

export function ChunkRecovery() {
  useEffect(() => {
    const clearMarker = () => {
      window.sessionStorage.removeItem(RELOAD_MARKER_KEY);
    };

    const handleError = (event: ErrorEvent) => {
      const message =
        event.message ||
        (event.error instanceof Error ? event.error.message : "");
      if (message && isChunkErrorMessage(message)) {
        reloadForChunkRecovery();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        typeof reason === "string"
          ? reason
          : reason instanceof Error
            ? reason.message
            : typeof reason?.message === "string"
              ? reason.message
              : "";
      if (message && isChunkErrorMessage(message)) {
        reloadForChunkRecovery();
      }
    };

    window.addEventListener("load", clearMarker, { once: true });
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("load", clearMarker);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
