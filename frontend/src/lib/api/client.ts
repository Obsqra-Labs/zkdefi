export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003").replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;

  // Normalize duplicate `/api` prefix when API_BASE already targets `/api`.
  // Example:
  //   API_BASE=/api + path=/api/v1/zkdefi/...  -> /api/v1/zkdefi/...
  let normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (/\/api$/i.test(API_BASE) && /^\/api(\/|$)/i.test(normalizedPath)) {
    normalizedPath = normalizedPath.replace(/^\/api/i, "");
    if (!normalizedPath.startsWith("/")) normalizedPath = `/${normalizedPath}`;
    if (normalizedPath === "/") normalizedPath = "";
  }

  return `${API_BASE}${normalizedPath}`;
}

/** Default timeout for API calls (ms). Prevents indefinite hangs from slow/unreachable backends. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ApiFetchOptions extends RequestInit {
  /** Timeout in ms. Pass 0 to disable. Defaults to 10 s. */
  timeoutMs?: number;
}

/** Generic typed fetch wrapper for API calls */
export async function apiFetch<T = unknown>(path: string, init?: ApiFetchOptions): Promise<T> {
  const url = apiUrl(path);
  const { headers: initHeaders, timeoutMs, ...rest } = init ?? {};

  // Wire up an AbortController with timeout so slow requests can't block the UI
  const controller = new AbortController();
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

  // If caller passed their own signal, chain it so both can abort
  if (rest.signal) {
    const outer = rest.signal;
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...((initHeaders as Record<string, string>) ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.detail ?? `API error ${res.status}`);
    }
    return res.json() as Promise<T>;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Wallet-authenticated fetch — injects X-Wallet-Address header.
 * Use for all POST/PUT/DELETE mutations on user-owned resources.
 */
export async function apiFetchAuth<T = unknown>(
  path: string,
  walletAddress: string,
  init?: ApiFetchOptions,
): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "X-Wallet-Address": walletAddress,
    },
  });
}
