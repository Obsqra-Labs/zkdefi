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
  const criticalCSS = "*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#09090b;color:#f4f4f5;font-family:ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}.min-h-screen{min-height:100vh}.bg-zinc-950{background:#09090b}.text-zinc-100{color:#f4f4f5}";
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: criticalCSS }} />
      </head>
      <body
        className="min-h-screen bg-zinc-950 text-zinc-100"
        style={{
          backgroundColor: "#09090b",
          color: "#f4f4f5",
          minHeight: "100vh",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: criticalCSS }} />
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
