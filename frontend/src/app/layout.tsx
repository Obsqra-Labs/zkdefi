import type { Metadata } from "next";
import "@/app/globals.css";
import { StarknetProvider } from "@/components/zkdefi/StarknetProvider";
import { AppProvider } from "@/lib/AppContext";

export const metadata: Metadata = {
  title: "zkde.fi — Obsqra Labs",
  description: "Private strategy. Provable execution. Reputation-tiered private DeFi on Starknet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <StarknetProvider>
          <AppProvider>{children}</AppProvider>
        </StarknetProvider>
      </body>
    </html>
  );
}
