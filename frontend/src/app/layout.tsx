import type { Metadata } from "next";
import { Source_Serif_4, JetBrains_Mono, Inter } from "next/font/google";
import "./globals.css";
import { StarknetProvider } from "@/components/zkdefi/StarknetProvider";
import { AppProvider } from "@/lib/AppContext";
import { ToastContainer } from "@/components/zkdefi/Toast";
import { CookieConsent } from "@/components/CookieConsent";
import { RiskDisclosure } from "@/components/RiskDisclosure";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "600", "700", "900"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://zkde.fi"),
  title: "zkde.fi — Hide everything. Prove anything.",
  description: "Zero-knowledge DeFi on Starknet. Build an anonymous reputation anchored by ZK receipts. Your strategy stays hidden. Your AI agents prove they behaved.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  alternates: {
    canonical: "https://zkde.fi",
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
  const criticalCSS = "*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#09090b;color:#f4f4f5;-webkit-font-smoothing:antialiased}.min-h-screen{min-height:100vh}.bg-zinc-950{background:#09090b}.text-zinc-100{color:#f4f4f5}";
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable} ${sans.variable} antialiased`} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: criticalCSS }} />
      </head>
      <body
        className="min-h-screen bg-zinc-950 text-zinc-100 font-sans"
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
