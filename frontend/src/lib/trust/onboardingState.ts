const TRUST_ONBOARDING_VERSION = "2";
const ONBOARDING_KEY_PREFIX = "zkdefi_trust_onboarding_v2";

export interface OnboardingCompletionState {
  completed: boolean;
  completedAt: string;
  version: string;
  source: string;
}

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function getOnboardingStorageKey(address: string): string {
  return `${ONBOARDING_KEY_PREFIX}_${normalizeAddress(address)}`;
}

function readLegacyMarkers(address: string): Array<{ key: string; value: string }> {
  if (!hasWindowStorage()) {
    return [];
  }

  const normalized = normalizeAddress(address);
  const keys = [
    `zkdefi_onboarded_${normalized}`,
    `zkdefi_agent_${normalized}`,
    "onboarding-complete",
    "zkdefi-onboarding-completed",
  ];

  return keys
    .map((key) => ({ key, value: window.localStorage.getItem(key) ?? "" }))
    .filter((entry) => entry.value.length > 0);
}

export function readOnboardingCompletion(address: string | null | undefined): OnboardingCompletionState | null {
  if (!address || !hasWindowStorage()) {
    return null;
  }

  const key = getOnboardingStorageKey(address);
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingCompletionState>;
    if (parsed.completed !== true) {
      return null;
    }

    return {
      completed: true,
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : new Date(0).toISOString(),
      version: typeof parsed.version === "string" ? parsed.version : TRUST_ONBOARDING_VERSION,
      source: typeof parsed.source === "string" ? parsed.source : "unknown",
    };
  } catch {
    if (raw === "true") {
      return {
        completed: true,
        completedAt: new Date(0).toISOString(),
        version: TRUST_ONBOARDING_VERSION,
        source: "legacy_boolean",
      };
    }
    return null;
  }
}

export function isOnboardingComplete(address: string | null | undefined): boolean {
  return Boolean(readOnboardingCompletion(address));
}

export function markOnboardingComplete(
  address: string | null | undefined,
  source = "trust_flow"
): OnboardingCompletionState | null {
  if (!address || !hasWindowStorage()) {
    return null;
  }

  const state: OnboardingCompletionState = {
    completed: true,
    completedAt: new Date().toISOString(),
    version: TRUST_ONBOARDING_VERSION,
    source,
  };

  window.localStorage.setItem(getOnboardingStorageKey(address), JSON.stringify(state));
  return state;
}

export function clearOnboardingCompletion(address: string | null | undefined): void {
  if (!address || !hasWindowStorage()) {
    return;
  }
  window.localStorage.removeItem(getOnboardingStorageKey(address));
}

export function migrateLegacyOnboardingState(address: string | null | undefined): boolean {
  if (!address || !hasWindowStorage()) {
    return false;
  }

  if (isOnboardingComplete(address)) {
    return false;
  }

  const markers = readLegacyMarkers(address);
  if (!markers.length) {
    return false;
  }

  markOnboardingComplete(address, `legacy:${markers.map((entry) => entry.key).join(",")}`);
  return true;
}
