export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003").replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}
