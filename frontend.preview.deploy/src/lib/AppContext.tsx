"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, Dispatch, SetStateAction } from "react";

export interface ActivityEvent {
  id: string;
  type: "deposit" | "withdraw" | "transfer" | "disclosure" | "session" | "rebalance" | "proof" | "private";
  text: string;
  txHash?: string;
  status?: "pending" | "confirmed" | "failed";
  details?: string;
  time: Date;
}

interface AppContextType {
  activityFeed: ActivityEvent[];
  setActivityFeed: Dispatch<SetStateAction<ActivityEvent[]>>;
  onboardingCompleted: boolean;
  setOnboardingCompleted: (completed: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const ONBOARDING_KEY = "zkdefi-onboarding-completed";

export function AppProvider({ children }: { children: ReactNode }) {
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
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
