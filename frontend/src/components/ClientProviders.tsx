"use client";

import type { ReactNode } from "react";
import { StarknetProvider } from "@/components/zkdefi/StarknetProvider";
import { AppProvider } from "@/lib/AppContext";
import { ToastProvider } from "@/lib/toastContext";

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <StarknetProvider>
      <AppProvider>
        <ToastProvider>{children}</ToastProvider>
      </AppProvider>
    </StarknetProvider>
  );
}
