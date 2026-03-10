import { beforeEach, describe, expect, it } from "vitest";

import {
  clearOnboardingCompletion,
  getOnboardingStorageKey,
  isOnboardingComplete,
  markOnboardingComplete,
  migrateLegacyOnboardingState,
  readOnboardingCompletion,
} from "@/lib/trust/onboardingState";

const ADDRESS = "0xABCDEF";

describe("onboardingState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes and reads canonical onboarding completion", () => {
    const result = markOnboardingComplete(ADDRESS, "test_case");
    expect(result?.completed).toBe(true);
    expect(isOnboardingComplete(ADDRESS)).toBe(true);

    const stored = readOnboardingCompletion(ADDRESS);
    expect(stored?.source).toBe("test_case");
    expect(stored?.version).toBe("2");
  });

  it("migrates legacy onboarding keys", () => {
    window.localStorage.setItem(`zkdefi_onboarded_${ADDRESS.toLowerCase()}`, "true");

    const migrated = migrateLegacyOnboardingState(ADDRESS);
    expect(migrated).toBe(true);
    expect(isOnboardingComplete(ADDRESS)).toBe(true);

    const key = getOnboardingStorageKey(ADDRESS);
    expect(window.localStorage.getItem(key)).toContain("legacy:");
  });

  it("clears onboarding completion", () => {
    markOnboardingComplete(ADDRESS, "clear_case");
    clearOnboardingCompletion(ADDRESS);
    expect(isOnboardingComplete(ADDRESS)).toBe(false);
  });
});
