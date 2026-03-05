"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getRiskPassport, listSessionKeys } from "@/lib/api/gating";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";

export interface GateConfig {
  gateMode: "balanced" | "stress";
  sessionId: string | undefined;
  passportScore: number | null;
  manualWalletOverrideEnabled: boolean;
  manualOverrideMinPassportScore: number;
}

export function useGateContext(
  userAddress: string | undefined,
  gateMode: "balanced" | "stress" = "balanced",
) {
  const [passportScore, setPassportScore] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);

  const loadGateContext = useCallback(async () => {
    if (!userAddress) return;
    try {
      const [passport, sessions] = await Promise.all([
        getRiskPassport(userAddress),
        listSessionKeys(userAddress),
      ]);
      setPassportScore(
        typeof passport?.composite_score === "number" ? passport.composite_score : null,
      );
      const active = (sessions?.sessions || []).find(
        (r: any) => r.is_active && !r.is_expired,
      );
      setActiveSessionId(active?.session_id);
    } catch {
      setActiveSessionId(undefined);
    }
  }, [userAddress]);

  useEffect(() => {
    void loadGateContext();
  }, [loadGateContext]);

  useVisibilityPolling(() => void loadGateContext(), 30_000, [loadGateContext]);

  const gateConfig: GateConfig = useMemo(
    () => ({
      gateMode,
      sessionId: activeSessionId,
      passportScore,
      manualWalletOverrideEnabled: true,
      manualOverrideMinPassportScore: 20,
    }),
    [gateMode, activeSessionId, passportScore],
  );

  return { passportScore, activeSessionId, gateConfig, refresh: loadGateContext };
}
