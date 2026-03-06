"use client";

import { useState, useEffect } from "react";
import { useAccount, useDisconnect } from "@starknet-react/core";
import { Wallet, ChevronDown, ExternalLink, Copy, LogOut } from "lucide-react";
import { WalletModal } from "./WalletModal";
import { toastSuccess } from "@/lib/toast";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Match server/first paint: don't show wallet state until after hydration (avoids React #418)
  const showConnected = mounted && isConnected && address;

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      toastSuccess("Address copied to clipboard");
      setIsDropdownOpen(false);
    }
  };

  const viewOnExplorer = () => {
    if (address) {
      window.open(`https://sepolia.starkscan.co/contract/${address}`, "_blank");
      setIsDropdownOpen(false);
    }
  };

  if (showConnected) {
    return (
      <div className="relative">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 px-3 sm:px-4 py-2 glass rounded-lg border border-zinc-700 hover:border-emerald-500/50 transition-all text-sm"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-xs sm:text-sm font-medium">
            {address.slice(0, 4)}...{address.slice(-4)}
          </span>
          <span className="px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded">
            Sepolia
          </span>
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        </button>

        {isDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsDropdownOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-56 glass rounded-lg border border-zinc-700 shadow-lg z-20">
              <div className="p-2">
                <button
                  onClick={copyAddress}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-sm"
                >
                  <Copy className="w-4 h-4 text-zinc-400" />
                  <span>Copy address</span>
                </button>
                <button
                  onClick={viewOnExplorer}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-sm"
                >
                  <ExternalLink className="w-4 h-4 text-zinc-400" />
                  <span>View on explorer</span>
                </button>
                <div className="h-px bg-zinc-700 my-1" />
                <button
                  onClick={() => {
                    disconnect();
                    setIsDropdownOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Disconnect</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-emerald-500/20"
      >
        <Wallet className="w-5 h-5" />
        <span>Connect Wallet</span>
      </button>
      <WalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
