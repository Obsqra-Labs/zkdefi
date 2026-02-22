"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, Dispatch, SetStateAction } from "react";

export type PoolSource = "full_privacy" | "shielded" | "pool_c" | "pool_d" | "stealth" | "compliance" | "system";

export interface ActivityEvent {
  id: string;
  type: "deposit" | "withdraw" | "transfer" | "disclosure" | "session" | "rebalance" | "proof" | "private";
  /** Which pool this event belongs to */
  pool?: PoolSource;
  text: string;
  txHash?: string;
  status?: "pending" | "confirmed" | "failed";
  details?: string;
  time: Date;
}

// Serializable version for localStorage (Date -> ISO string)
interface StoredActivityEvent {
  id: string;
  type: ActivityEvent["type"];
  pool?: PoolSource;
  text: string;
  txHash?: string;
  status?: "pending" | "confirmed" | "failed";
  details?: string;
  time: string; // ISO string
}

interface AppContextType {
  activityFeed: ActivityEvent[];
  setActivityFeed: Dispatch<SetStateAction<ActivityEvent[]>>;
  /** Call when wallet address changes so we load/save to the right key */
  syncActivityForAddress: (address: string | undefined) => void;
  onboardingCompleted: boolean;
  setOnboardingCompleted: (completed: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const ONBOARDING_KEY = "zkdefi-onboarding-completed";
const ACTIVITY_KEY_PREFIX = "zkdefi_activity_";
const MAX_PERSISTED_EVENTS = 100;

function activityStorageKey(address: string): string {
  return `${ACTIVITY_KEY_PREFIX}${address.toLowerCase()}`;
}

function loadActivityFromStorage(address: string): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(activityStorageKey(address));
    if (!raw) return [];
    const parsed: StoredActivityEvent[] = JSON.parse(raw);
    return parsed.map((e) => ({ ...e, time: new Date(e.time) }));
  } catch {
    return [];
  }
}

function saveActivityToStorage(address: string, events: ActivityEvent[]) {
  try {
    const serializable: StoredActivityEvent[] = events.slice(0, MAX_PERSISTED_EVENTS).map((e) => ({
      ...e,
      time: e.time instanceof Date ? e.time.toISOString() : String(e.time),
    }));
    localStorage.setItem(activityStorageKey(address), JSON.stringify(serializable));
  } catch {
    // storage full or unavailable — silently degrade
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [activityFeed, setActivityFeedRaw] = useState<ActivityEvent[]>([]);
  const [currentAddress, setCurrentAddress] = useState<string | undefined>(undefined);
  // Always start false so server and first client paint match (avoids React hydration #418/#423)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  useEffect(() => {
    try {
      const stored = typeof window !== "undefined" && localStorage.getItem(ONBOARDING_KEY) === "true";
      setOnboardingCompleted(!!stored);
    } catch {
      // ignore
    }
  }, []);

  // Persist to localStorage whenever activityFeed changes (and we have an address)
  useEffect(() => {
    if (currentAddress && activityFeed.length > 0) {
      saveActivityToStorage(currentAddress, activityFeed);
    }
  }, [activityFeed, currentAddress]);

  // Wrapped setter that also persists
  const setActivityFeed: Dispatch<SetStateAction<ActivityEvent[]>> = useCallback((action) => {
    setActivityFeedRaw(action);
  }, []);

  // Called by components when wallet address changes
  const syncActivityForAddress = useCallback((address: string | undefined) => {
    setCurrentAddress(address);
    if (!address) {
      // Don't wipe — just leave current in-memory (user might reconnect)
      return;
    }
    // Load persisted history for this address
    const stored = loadActivityFromStorage(address);
    setActivityFeedRaw((prev) => {
      if (prev.length === 0) return stored;
      // Merge: keep existing in-memory events, add stored ones that aren't already present
      const existingIds = new Set(prev.map((e) => e.id));
      const merged = [...prev];
      for (const e of stored) {
        if (!existingIds.has(e.id)) merged.push(e);
      }
      // Sort newest first, deduplicate by txHash for safety
      const seen = new Set<string>();
      const deduped = merged
        .sort((a, b) => b.time.getTime() - a.time.getTime())
        .filter((e) => {
          // Deduplicate by txHash if present, otherwise by id
          const key = e.txHash || e.id;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return deduped.slice(0, MAX_PERSISTED_EVENTS);
    });
  }, []);

  const handleSetOnboardingCompleted = (completed: boolean) => {
    setOnboardingCompleted(completed);
    try {
      if (typeof window !== "undefined") {
        if (completed) {
          localStorage.setItem(ONBOARDING_KEY, "true");
        } else {
          localStorage.removeItem(ONBOARDING_KEY);
        }
      }
    } catch {
      // ignore
    }
  };

  return (
    <AppContext.Provider
      value={{
        activityFeed,
        setActivityFeed,
        syncActivityForAddress,
        onboardingCompleted,
        setOnboardingCompleted: handleSetOnboardingCompleted,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
}
