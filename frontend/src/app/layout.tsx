import type { Metadata } from "next";
import "@/app/globals.css";
import { ClientProviders } from "@/components/ClientProviders";
import { ChunkRecovery } from "@/components/ChunkRecovery";
import { EarlyChunkRecoveryScript } from "@/components/EarlyChunkRecoveryScript";

export const metadata: Metadata = {
  title: "zkde.fi — Obsqra Labs",
  description: "Private strategy. Provable execution. Reputation-tiered private DeFi on Starknet.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <EarlyChunkRecoveryScript />
        <ClientProviders>
          <ChunkRecovery />
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}
