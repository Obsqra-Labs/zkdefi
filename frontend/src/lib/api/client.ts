export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "/api").replace(/\/$/, "");
const CANONICAL_API_ORIGIN = "https://zkde.fi";

export function apiUrl(path: string): string {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  
  if (API_BASE === "/api") {
    if (normalizedPath.startsWith("/api/")) {
      return normalizedPath;
    }
    return `${API_BASE}${normalizedPath}`;
  }
  
  return `${API_BASE}${normalizedPath}`;
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const resolvedUrl = apiUrl(path);
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string" && ["POST", "PUT", "PATCH"].includes(init.method ?? "")) {
    headers.set("Content-Type", "application/json");
  }
  const mergedInit: RequestInit = { ...init, headers };
  let response = await fetch(resolvedUrl, mergedInit);

  // Some hosts (e.g. zke.fi) do not proxy /api/* to this backend.
  // Retry once against canonical API origin for zkdefi routes on 404.
  const shouldRetryCanonical =
    response.status === 404 &&
    path.startsWith("/api/v1/") &&
    !resolvedUrl.startsWith(CANONICAL_API_ORIGIN);

  if (shouldRetryCanonical) {
    const canonicalUrl = `${CANONICAL_API_ORIGIN}${path}`;
    response = await fetch(canonicalUrl, mergedInit);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : `Request failed (${response.status})`;
    throw new Error(detail);
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}
