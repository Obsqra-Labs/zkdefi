import type { Metadata } from "next";
import "./globals.css";
import { StarknetProvider } from "@/components/zkdefi/StarknetProvider";
import { AppProvider } from "@/lib/AppContext";
import { ToastContainer } from "@/components/zkdefi/Toast";
import { CookieConsent } from "@/components/CookieConsent";
import { RiskDisclosure } from "@/components/RiskDisclosure";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "zkde.fi by Obsqra Labs | zkDE + GATE",
  description: "zkde.fi — First GATE-compatible app. Zero-Knowledge Deterministic Engine (zkDE) + Governed Autonomous Trustless Execution (GATE). Trustless AI execution on Starknet. Proof-gated autonomous agent for private DeFi. Starknet Re{define} Hackathon (Privacy track). Open source.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <body
        className="min-h-screen bg-zinc-950 text-zinc-100"
        style={{
          backgroundColor: "#09090b",
          color: "#f4f4f5",
          minHeight: "100vh",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <ErrorBoundary>
          <StarknetProvider>
            <AppProvider>
              {children}
              <ToastContainer />
              <CookieConsent />
              <RiskDisclosure />
            </AppProvider>
          </StarknetProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
