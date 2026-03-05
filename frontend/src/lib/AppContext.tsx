"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
  Dispatch,
  SetStateAction,
} from "react";

export type PoolSource = "full_privacy" | "shielded" | "pool_c" | "pool_d" | "stealth" | "compliance" | "system" | "ekubo" | "dark_ledger";

export interface ActivityEvent {
  id: string;
  type: "deposit" | "withdraw" | "transfer" | "disclosure" | "session" | "rebalance" | "proof" | "private" | "trade" | "lp";
  pool?: PoolSource;
  text: string;
  txHash?: string;
  status?: "pending" | "confirmed" | "failed";
  details?: string;
  time: Date;
}

interface AppContextType {
  activityFeed: ActivityEvent[];
  setActivityFeed: Dispatch<SetStateAction<ActivityEvent[]>>;
  syncActivityForAddress: (address: string | undefined) => void;
  invalidateKey: number;
  invalidateTabs: () => void;
  onboardingCompleted: boolean;
  setOnboardingCompleted: (completed: boolean) => void;
  hasOnboarded: boolean | null;
  setHasOnboarded: (v: boolean | null) => void;
  /** Paper/demo mode from ?mode=demo — no real chain txs; backend uses ledger only. */
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [activeAddress, setActiveAddress] = useState<string | undefined>(undefined);
  const [invalidateKey, setInvalidateKey] = useState(0);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  /** Backend onboarding (has_agent). Set by agent page from GET onboarding/status/{address}. null = unknown/no address. */
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);
  /** Paper/demo mode when URL has ?mode=demo. Set by agent page from search params. */
  const [demoMode, setDemoMode] = useState(false);

  const invalidateTabs = useCallback(() => {
    setInvalidateKey((k) => k + 1);
  }, []);

  const syncActivityForAddress = useCallback(
    (address: string | undefined) => {
      const next = address?.toLowerCase();
      if (!next) return;
      if (activeAddress && activeAddress !== next) {
        // Reset optimistic-only feed on wallet switch.
        setActivityFeed([]);
      }
      setActiveAddress(next);
    },
    [activeAddress],
  );

  const value = useMemo<AppContextType>(
    () => ({
      activityFeed,
      setActivityFeed,
      syncActivityForAddress,
      invalidateKey,
      invalidateTabs,
      onboardingCompleted,
      setOnboardingCompleted,
      hasOnboarded,
      setHasOnboarded,
      demoMode,
      setDemoMode,
    }),
    [activityFeed, syncActivityForAddress, invalidateKey, invalidateTabs, onboardingCompleted, hasOnboarded, demoMode],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
}
