export function EarlyChunkRecoveryScript() {
  // Runs before React hydration to recover from missing Next.js chunk assets after deploy.
  const script = `
(() => {
  const KEY = "__zkdefi_early_chunk_reload__";
  const WINDOW_MS = 120000;
  const MAX = 2;

  function readState() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (typeof v.ts !== "number" || typeof v.attempts !== "number") return null;
      return v;
    } catch {
      return null;
    }
  }

  function canReload() {
    const s = readState();
    if (!s) return true;
    if (Date.now() - s.ts > WINDOW_MS) return true;
    return s.attempts < MAX;
  }

  function markReload() {
    try {
      const s = readState();
      const now = Date.now();
      const attempts = s && now - s.ts <= WINDOW_MS ? Math.min(s.attempts + 1, MAX) : 1;
      sessionStorage.setItem(KEY, JSON.stringify({ ts: now, attempts }));
    } catch {}
  }

  function triggerReload() {
    if (!canReload()) return;
    markReload();
    const url = new URL(window.location.href);
    url.searchParams.set("_cr", String(Date.now()));
    window.location.replace(url.toString());
  }

  function isChunkErrorText(text) {
    const t = String(text || "").toLowerCase();
    return (
      t.includes("chunkloaderror") ||
      t.includes("loading chunk") ||
      (t.includes("chunk") && t.includes("failed")) ||
      t.includes("failed to fetch dynamically imported module")
    );
  }

  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      const url = String(target.src || target.href || "");
      if (url.includes("/_next/static/")) {
        triggerReload();
        return;
      }
    }
    if (isChunkErrorText(event.message)) {
      triggerReload();
    }
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg =
      typeof reason === "string"
        ? reason
        : reason && typeof reason.message === "string"
          ? reason.message
          : String(reason || "");
    if (isChunkErrorText(msg)) {
      event.preventDefault();
      triggerReload();
    }
  }, true);
})();
`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
