"use client";

/**
 * ClientProviders — wraps all client-side context providers that
 * need to be available app-wide.
 *
 * Because layout.tsx is a React Server Component, client providers
 * must be isolated here.
 */

import type { ReactNode } from "react";
import { DynamicProvider } from "@/components/DynamicProvider";
import { StarknetProvider } from "@/components/zkdefi/StarknetProvider";
import { AppProvider } from "@/lib/AppContext";
import { ExecutionContextProvider } from "@/contexts/ExecutionContext";
import { VaultStoreProvider } from "@/contexts/VaultStore";
import { ToastContainer } from "@/components/zkdefi/Toast";

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <DynamicProvider>
      <StarknetProvider>
        <AppProvider>
          <ExecutionContextProvider>
            <VaultStoreProvider>
              {children}
              <ToastContainer />
            </VaultStoreProvider>
          </ExecutionContextProvider>
        </AppProvider>
      </StarknetProvider>
    </DynamicProvider>
  );
}
