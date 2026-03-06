"use client";

import { useMemo } from "react";

type VaultRuntimeState =
  | "ACTIVE"
  | "PAUSED"
  | "COOLDOWN"
  | "PENDING_REBALANCE"
  | "EMERGENCY";

interface ProofsState {
  loaded: boolean;
  total: number;
}

interface VaultControllerSnapshot {
  proofsState: ProofsState;
  pendingProposal: boolean;
  cooldownRemaining: number;
  vaultState: VaultRuntimeState;
  loading: boolean;
}

export function useVaultController(address?: string): VaultControllerSnapshot {
  return useMemo(
    () => ({
      proofsState: {
        loaded: Boolean(address),
        total: 0,
      },
      pendingProposal: false,
      cooldownRemaining: 0,
      vaultState: "ACTIVE",
      loading: false,
    }),
    [address],
  );
}
