const DEFAULT_SALT = "agent-builder-v2";

function normalizeAddress(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function clampPercent(raw: string | undefined, fallback = 100): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.trunc(parsed)));
}

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const entry of raw.split(",")) {
    const normalized = normalizeAddress(entry);
    if (normalized) out.add(normalized);
  }
  return out;
}

function cohortBucket(identity: string, salt: string): number {
  // FNV-1a (32-bit) to match backend rollout bucketing.
  const payload = new TextEncoder().encode(`${salt}:${identity}`);
  let state = 0x811c9dc5;
  for (const byte of payload) {
    state ^= byte;
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return state % 100;
}

export function isAgentBuilderV2EnabledForUser(
  userAddress: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NEXT_PUBLIC_AGENT_BUILDER_V2 === "0") {
    return false;
  }

  const normalizedUser = normalizeAddress(userAddress);
  const allowlist = parseAllowlist(env.NEXT_PUBLIC_AGENT_BUILDER_V2_INTERNAL_ALLOWLIST);
  if (normalizedUser && allowlist.has(normalizedUser)) {
    return true;
  }

  const rolloutPercent = clampPercent(env.NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_PERCENT, 100);
  if (rolloutPercent >= 100) {
    return true;
  }
  if (rolloutPercent <= 0) {
    return false;
  }
  if (!normalizedUser) {
    return false;
  }

  const salt = String(env.NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_SALT || DEFAULT_SALT).trim() || DEFAULT_SALT;
  return cohortBucket(normalizedUser, salt) < rolloutPercent;
}
