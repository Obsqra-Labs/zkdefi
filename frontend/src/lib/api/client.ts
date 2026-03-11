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

/** Generic typed fetch wrapper for API calls */
export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  // Extract headers separately so ...rest doesn't overwrite the merged headers
  const { headers: initHeaders, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
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
}

/**
 * Wallet-authenticated fetch — injects X-Wallet-Address header.
 * Use for all POST/PUT/DELETE mutations on user-owned resources.
 */
export async function apiFetchAuth<T = unknown>(
  path: string,
  walletAddress: string,
  init?: RequestInit,
): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "X-Wallet-Address": walletAddress,
    },
  });
}
