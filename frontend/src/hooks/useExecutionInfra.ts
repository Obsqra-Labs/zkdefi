"use client";

import { useMemo } from "react";
import { useExecutionContextProviderOptional } from "@/contexts/ExecutionContext";
import { ExecutionInfraStatus } from "@/types/ekubo";

const DEFAULT_STATUS: ExecutionInfraStatus = {
  walletProvider: "starknet-react",
  paymasterAvailable: false,
  gasMode: "auto",
  controllerSession: "wallet",
  fallbackUsed: false,
};

/**
 * Execution infra (gas mode, paymaster, fallback). Prefer ExecutionContextProvider at root;
 * this hook reads from context when available, otherwise returns a safe default.
 */
export function useExecutionInfra() {
  const ctx = useExecutionContextProviderOptional();
  return useMemo(
    () =>
      ctx
        ? {
            status: ctx.status,
            loading: ctx.loading,
            setGasMode: ctx.setGasMode,
            refresh: ctx.refresh,
            markFallback: ctx.markFallback,
          }
        : {
            status: DEFAULT_STATUS,
            loading: false,
            setGasMode: () => {},
            refresh: async () => {},
            markFallback: () => {},
          },
    [ctx],
  );
}
