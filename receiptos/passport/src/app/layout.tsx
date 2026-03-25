import type { Metadata } from "next";
import { StarknetProvider } from "@/components/StarknetProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReceiptOS Passport",
  description: "View your on-chain reputation vector and claim receipts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <StarknetProvider>{children}</StarknetProvider>
      </body>
    </html>
  );
}
