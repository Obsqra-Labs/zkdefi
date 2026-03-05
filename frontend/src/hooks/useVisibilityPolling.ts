"use client";

import { useEffect, useRef } from "react";

/**
 * Visibility-aware polling hook.
 *
 * Runs `callback` every `intervalMs` milliseconds, but **only when the tab
 * is visible**.  Also fires immediately when the tab becomes visible again
 * (so data is fresh when the user switches back).
 *
 * Drop-in replacement for the common `useEffect + setInterval` pattern.
 */
export function useVisibilityPolling(
  callback: () => void,
  intervalMs: number,
  /** Extra deps that should restart the interval when they change. */
  deps: readonly unknown[] = [],
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) cbRef.current();
    };

    const id = setInterval(tick, intervalMs);

    const onVisibilityChange = () => {
      if (!document.hidden) cbRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
