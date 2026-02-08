'use client';

import { useState, useEffect, ReactNode } from 'react';
import { StarknetProvider } from '@/components/zkdefi/StarknetProvider';
import { AppProvider } from '@/lib/AppContext';
import { ToastContainer } from '@/components/zkdefi/Toast';
import { CookieConsent } from '@/components/CookieConsent';
import { RiskDisclosure } from '@/components/RiskDisclosure';

export function ClientApp({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#09090b', color: '#f4f4f5' }}
      >
        <div className="text-center">
          <div
            className="w-8 h-8 border-2 border-zinc-500 border-t-zinc-200 rounded-full animate-spin mx-auto mb-4"
            aria-hidden
          />
          <p className="text-sm text-zinc-400 font-mono">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <StarknetProvider>
      <AppProvider>
        {children}
        <ToastContainer />
        <CookieConsent />
        <RiskDisclosure />
      </AppProvider>
    </StarknetProvider>
  );
}
