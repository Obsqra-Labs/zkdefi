"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useConnect } from "@starknet-react/core";

/* Inline SVG wallet icons — no external deps needed */
function ArgentIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="h-8 w-8">
      <rect width="32" height="32" rx="8" fill="#FF875B" />
      <path
        d="M18.316 8h-4.63a.476.476 0 00-.46.361l-3.18 12.376a.232.232 0 00.225.288h2.86a.476.476 0 00.46-.36l.76-2.958h5.3l.76 2.957a.476.476 0 00.46.361h2.86a.232.232 0 00.225-.288L20.776 8.36A.476.476 0 0018.316 8zm-2.89 7.28l1.574-6.123 1.574 6.124h-3.148z"
        fill="#FFF"
      />
    </svg>
  );
}

function BraavosIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="h-8 w-8">
      <rect width="32" height="32" rx="8" fill="#F5C341" />
      <path
        d="M16 7l-6.928 4v8L16 23l6.928-4v-8L16 7zm0 2.311l4.619 2.667v5.333L16 19.978l-4.619-2.667v-5.333L16 9.311z"
        fill="#1A1A2E"
      />
      <path d="M16 12.5l2.5 1.5v3L16 18.5l-2.5-1.5v-3L16 12.5z" fill="#1A1A2E" />
    </svg>
  );
}

function WalletIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("argent")) return <ArgentIcon />;
  if (lower.includes("braavos")) return <BraavosIcon />;
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-700 text-sm font-bold text-white">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

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
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-xl font-semibold text-white">Connect wallet</h2>
                  <p className="text-sm text-zinc-500">Choose your Starknet wallet to continue</p>
                </div>
                <button
                  onClick={onClose}
                  className="text-zinc-400 hover:text-zinc-200 transition-colors rounded-lg p-1 hover:bg-zinc-800"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {connectors.map((connector) => (
                  <button
                    key={connector.id}
                    onClick={() => {
                      connect({ connector });
                      onClose();
                    }}
                    className="w-full rounded-xl border border-zinc-800 hover:border-cyan-500/40 p-4 flex items-center gap-4 transition-all hover:bg-zinc-900/80 group"
                  >
                    <WalletIcon name={connector.name} />
                    <div className="flex-1 text-left">
                      <div className="font-medium text-white group-hover:text-cyan-50">{connector.name}</div>
                      <div className="text-xs text-zinc-500">
                        {connector.name.toLowerCase().includes("argent")
                          ? "Smart contract wallet with security features"
                          : connector.name.toLowerCase().includes("braavos")
                            ? "Hardware signer wallet for Starknet"
                            : "Starknet wallet"}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600 group-hover:text-zinc-400">Connect</span>
                  </button>
                ))}
              </div>

              <p className="mt-5 text-xs text-zinc-600 text-center">
                New to Starknet?{" "}
                <a
                  href="https://www.starknet.io/en/ecosystem/wallets"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300"
                >
                  Get a wallet →
                </a>
              </p>
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-zinc-600">
                <span>Powered by</span>
                <a href="https://starkzap.io" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-200 font-medium">Starkzap</a>
                <span>·</span>
                <a href="https://www.starknet.io" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-200 font-medium">Starknet</a>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
