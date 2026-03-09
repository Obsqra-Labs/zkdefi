"use client";

import { useAccount } from "@starknet-react/core";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { TradeDesk } from "@/components/zkdefi/TradeDesk";
import { Wallet } from "lucide-react";

export default function TradePage() {
  const { address, isConnected } = useAccount();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 gap-6">
        <div className="flex flex-col items-center gap-3">
          <Wallet className="w-10 h-10 text-cyan-400" />
          <h1 className="text-2xl font-bold">Trade Desk</h1>
          <p className="text-slate-400 text-sm">Connect your wallet to access the Trade Desk</p>
        </div>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <AppNavbar />
      <TradeDesk userAddress={address} autoRefresh showMemoryLane />
    </div>
  );
}
