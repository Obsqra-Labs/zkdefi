"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useConnect, useAccount } from "@starknet-react/core";

const CONNECT_TIMEOUT_MS = 15000;

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, connectors } = useConnect();
  const { isConnected, address } = useAccount();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const hasAccount = isConnected && !!address;

  // Close when connection succeeds
  useEffect(() => {
    if (connectingTo && hasAccount) {
      setConnectingTo(null);
      setTimedOut(false);
      onClose();
    }
  }, [connectingTo, hasAccount, onClose]);

  // Timeout: stop spinning and show message so user can close or retry
  useEffect(() => {
    if (!connectingTo) return;
    const t = setTimeout(() => {
      setTimedOut(true);
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [connectingTo]);

  const handleClose = () => {
    setConnectingTo(null);
    setTimedOut(false);
    onClose();
  };

  const handleConnectorClick = (connector: (typeof connectors)[number]) => {
    setTimedOut(false);
    setConnectingTo(connector.name);
    connect({ connector });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={connectingTo && !timedOut ? undefined : handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glass rounded-2xl border border-zinc-800 p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                  {connectingTo ? "Connecting…" : "Choose your wallet"}
                </h2>
                <button
                  onClick={handleClose}
                  className="text-zinc-400 hover:text-zinc-200 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {connectingTo ? (
                <div className="py-8 flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-zinc-400 text-center">
                    {timedOut
                      ? "Connection took too long. Approve in your wallet or try again."
                      : `Connecting to ${connectingTo}… Approve in your wallet.`}
                  </p>
                  {timedOut && (
                    <button
                      onClick={() => {
                        setConnectingTo(null);
                        setTimedOut(false);
                      }}
                      className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
                    >
                      Choose another wallet
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {!connectors?.length ? (
                      <div className="py-6 px-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-center">
                        <p className="text-amber-200 text-sm font-medium mb-1">No wallet detected</p>
                        <p className="text-zinc-400 text-xs">
                          Install <a href="https://www.argent.xyz/argent-x/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Argent X</a> or <a href="https://braavos.app/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Braavos</a> browser extension, then refresh.
                        </p>
                      </div>
                    ) : (
                    connectors.map((connector) => (
                      <button
                        key={connector.id}
                        onClick={() => handleConnectorClick(connector)}
                        className="w-full glass rounded-lg border border-zinc-700 hover:border-emerald-500/50 p-4 flex items-center gap-4 transition-all hover:bg-zinc-800/50"
                      >
                        <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center">
                          <span className="text-xl font-semibold">
                            {connector.name === "Argent" ? "A" : "B"}
                          </span>
                        </div>
                        <div className="flex-1 text-left">
                          <div className="font-medium text-white">{connector.name}</div>
                          <div className="text-sm text-zinc-400">
                            {connector.name === "Argent"
                              ? "Secure smart contract wallet"
                              : "Non-custodial wallet"}
                          </div>
                        </div>
                      </button>
                    ))
                    )}
                  </div>

                  <p className="mt-4 text-xs text-zinc-500 text-center">
                    <span className="text-amber-400/90">Argent X not opening?</span> Disconnect this site in Argent X (Settings → Connected sites), refresh the page, then connect again. Or use Braavos.
                  </p>
                  <p className="mt-2 text-xs text-zinc-500 text-center">
                    New to Starknet?{" "}
                    <a
                      href="https://www.starknet.io/en/ecosystem/wallets"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      Learn about wallets
                    </a>
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
