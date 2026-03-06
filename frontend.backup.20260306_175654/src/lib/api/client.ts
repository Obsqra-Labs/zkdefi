export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003").replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
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
