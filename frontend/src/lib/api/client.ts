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

export class ApiError extends Error {
  status: number;
  detail: unknown;
  body: unknown;

  constructor(message: string, status: number, detail: unknown, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

export interface TrustGateErrorDetail {
  error?: string;
  gate?: string;
  decision?: {
    mode?: string;
    reason_codes?: string[];
    reason_hints?: string[];
  };
  source?: string;
}

export function getTrustGateErrorDetail(error: unknown): TrustGateErrorDetail | null {
  if (!(error instanceof ApiError)) return null;
  const detail = error.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const record = detail as Record<string, unknown>;
  if (typeof record.error !== "string" && typeof record.gate !== "string") return null;
  return record as unknown as TrustGateErrorDetail;
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function extractErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)) {
      const detailRecord = record.detail as Record<string, unknown>;
      if (typeof detailRecord.error === "string") return detailRecord.error;
    }
    if (typeof record.message === "string") return record.message;
  }
  return `API error ${status}`;
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
      const detail = body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).detail
        : undefined;
      throw new ApiError(extractErrorMessage(res.status, body), res.status, detail, body);
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
