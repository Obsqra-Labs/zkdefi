"use client";

import { useAccount, useConnect, useDisconnect } from "@starknet-react/core";
import { Wallet, LogOut, Loader2 } from "lucide-react";

export function WalletBar() {
  const { address, status } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (status === "connected" && address) {
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    return (
      <div className="flex items-center gap-3">
        <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-xs text-zinc-300">
          {short}
        </span>
        <button
          onClick={() => disconnect()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
        >
          <LogOut className="h-3 w-3" />
          Disconnect
        </button>
      </div>
    );
  }

  if (status === "connecting" || status === "reconnecting") {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Connecting…
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {connectors.map((connector) => (
        <button
          key={connector.id}
          onClick={() => connect({ connector })}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-400 transition-colors hover:bg-cyan-500/20"
        >
          <Wallet className="h-3.5 w-3.5" />
          {connector.name}
        </button>
      ))}
    </div>
  );
}
