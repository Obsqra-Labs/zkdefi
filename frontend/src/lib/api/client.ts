/**
 * Unified API client for the zkde.fi backend.
 *
 * - Single source of truth for API_BASE and the fetch wrapper.
 * - Every component / lib file should import from here instead of
 *   redeclaring `const API_BASE = ...` locally.
 */

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003"
).replace(/\/api\/v[0-9]+\/?$/, "");

/**
 * Merge headers and optionally attach wallet-owner auth header required by
 * protected backend mutations (require_wallet_owner).
 */
export function walletAuthHeaders(
  address?: string,
  headers?: RequestInit["headers"],
): Record<string, string> {
  const merged: Record<string, string> = {};

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      merged[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      merged[key] = value;
    }
  } else if (headers && typeof headers === "object") {
    Object.assign(merged, headers as Record<string, string>);
  }

  if (address) {
    merged["X-Wallet-Address"] = address;
  }

  return merged;
}

/**
 * Options for the unified fetch wrapper.
 */
export interface ApiFetchOptions {
  /** Send X-Demo-Mode header for paper-mode backend handling. */
  demoMode?: boolean;
  /** Timeout in milliseconds (default: 10 000). Set 0 to disable. */
  timeoutMs?: number;
  /** External AbortSignal — merged with the internal timeout signal. */
  signal?: AbortSignal;
  /** Retries for 5xx server errors (default: 1). */
  retries?: number;
}

/**
 * Typed fetch helper.  Prepends `API_BASE`, sets JSON content-type,
 * and throws a descriptive error on non-2xx responses.
 *
 * Includes:
 *  - Configurable timeout (default 10 s) via AbortController.
 *  - One automatic retry on 5xx server errors.
 *  - Optional external AbortSignal forwarding.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const maxRetries = options?.retries ?? 1;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers && typeof init.headers === "object" && !(init.headers instanceof Headers)
      ? (init.headers as Record<string, string>)
      : {}),
  };
  if (options?.demoMode) {
    headers["X-Demo-Mode"] = "true";
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Wire timeout
    if (timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    // Forward external signal
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    // Also forward any signal on init (backward compat)
    if (init?.signal) {
      if (init.signal.aborted) {
        controller.abort();
      } else {
        init.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (timer) clearTimeout(timer);

      if (response.ok) {
        return (await response.json()) as T;
      }

      // Retry on 5xx
      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Server error (${response.status})`);
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); // brief back-off
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === "string"
          ? payload.detail
          : typeof payload?.detail?.message === "string"
            ? payload.detail.message
          : `Request failed (${response.status})`;
      throw new Error(detail);
    } catch (e) {
      if (timer) clearTimeout(timer);

      // Timeout → descriptive error
      if (e instanceof DOMException && e.name === "AbortError") {
        if (options?.signal?.aborted || init?.signal?.aborted) {
          throw new Error("Request aborted");
        }
        throw new Error(`Request to ${path} timed out after ${timeoutMs}ms`);
      }

      // Retry network errors
      if (attempt < maxRetries && e instanceof TypeError) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }

      throw e;
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}
