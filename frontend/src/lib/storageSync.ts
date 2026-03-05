/**
 * storageSync.ts – Utility for cross-tab localStorage synchronisation.
 *
 * Instead of polling localStorage every N seconds, components should use
 * `onStorageKey()` which reacts to the native `storage` event (fires when
 * another tab writes to the same key).
 *
 * For same-tab writes, callers should use `writeAndNotify()` which also
 * dispatches a local CustomEvent so the current tab's listeners fire too.
 */

const LOCAL_STORAGE_EVENT = "zkdefi:storage-sync";

/** Write a key and notify all tabs (including current). */
export function writeAndNotify(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage full or disabled – ignore.
  }
  // Dispatch a local event so same-tab listeners fire immediately.
  window.dispatchEvent(
    new CustomEvent(LOCAL_STORAGE_EVENT, { detail: { key, newValue: value } }),
  );
}

/** Remove a key and notify all tabs (including current). */
export function removeAndNotify(key: string): void {
  window.localStorage.removeItem(key);
  window.dispatchEvent(
    new CustomEvent(LOCAL_STORAGE_EVENT, { detail: { key, newValue: null } }),
  );
}

/**
 * Subscribe to changes for a specific localStorage key.
 * Works across tabs (native StorageEvent) *and* within the same tab
 * (via the custom event dispatched by `writeAndNotify`).
 *
 * Returns an unsubscribe function.
 */
export function onStorageKey(
  key: string,
  callback: (newValue: string | null) => void,
): () => void {
  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === key) callback(e.newValue);
  };

  const handleLocalEvent = (e: Event) => {
    const detail = (e as CustomEvent).detail as { key: string; newValue: string | null } | undefined;
    if (detail?.key === key) callback(detail.newValue);
  };

  window.addEventListener("storage", handleStorageEvent);
  window.addEventListener(LOCAL_STORAGE_EVENT, handleLocalEvent);

  return () => {
    window.removeEventListener("storage", handleStorageEvent);
    window.removeEventListener(LOCAL_STORAGE_EVENT, handleLocalEvent);
  };
}
