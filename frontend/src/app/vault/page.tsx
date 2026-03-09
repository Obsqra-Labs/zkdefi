"use client";

import { useAccount } from "@starknet-react/core";
import { Shield } from "lucide-react";
import { VaultSurface } from "@/components/zkdefi/vault/VaultSurface";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { AppNavbar } from "@/components/zkdefi/AppNavbar";

export default function VaultPage() {
  const { address, isConnected } = useAccount();

  if (!isConnected) {
    return (
      <>
        <AppNavbar />
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4">
          <Shield className="w-16 h-16 text-zinc-600" />
          <h2 className="text-2xl font-bold text-white">Connect Wallet</h2>
          <p className="text-zinc-400">Connect your wallet to access the Privacy Vault</p>
          <ConnectButton />
        </div>
      </>
    );
  }

  return (
    <>
      <AppNavbar />
      <div className="min-h-screen bg-zinc-950">
        <VaultSurface address={address} />
      </div>
    </>
  );
}
