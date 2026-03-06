"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useConnect } from "@starknet-react/core";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, connectors } = useConnect();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glass rounded-2xl border border-zinc-800 p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Choose your wallet</h2>
                <button
                  onClick={onClose}
                  className="text-zinc-400 hover:text-zinc-200 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {connectors.map((connector) => (
                  <button
                    key={connector.id}
                    onClick={() => {
                      connect({ connector });
                      onClose();
                    }}
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
                ))}
              </div>

              <p className="mt-6 text-xs text-zinc-500 text-center">
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
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
