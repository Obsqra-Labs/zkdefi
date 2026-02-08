import type { Metadata } from "next";
import "./globals.css";
import { ClientApp } from "@/components/ClientApp";
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
          <ClientApp>{children}</ClientApp>
        </ErrorBoundary>
      </body>
    </html>
  );
}
