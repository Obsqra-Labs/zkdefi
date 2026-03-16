import type { Metadata } from "next";
import "./globals.css";
import { StarknetProvider } from "@/components/zkdefi/StarknetProvider";
import { AppProvider } from "@/lib/AppContext";
import { ToastContainer } from "@/components/zkdefi/Toast";
import { CookieConsent } from "@/components/CookieConsent";
import { RiskDisclosure } from "@/components/RiskDisclosure";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "zkde.fi — Hide everything. Prove anything.",
  description: "Zero-knowledge DeFi on Starknet. Build an anonymous reputation anchored by ZK receipts. Your strategy stays hidden. Your AI agents prove they behaved.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "zkde.fi — Hide everything. Prove anything.",
    description: "Anonymous reputation. Proof-gated AI agents. Verifiable receipts. Zero-knowledge DeFi on Starknet.",
    images: [{ url: "/og-banner.png", width: 928, height: 474, alt: "zkdefi — Zero Knowledge Decentralized Finance" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "zkde.fi — Hide everything. Prove anything.",
    description: "Anonymous reputation. Proof-gated AI agents. Verifiable receipts on Starknet.",
    images: ["/og-banner.png"],
  },
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
