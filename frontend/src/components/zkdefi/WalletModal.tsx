"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAccount, useConnect } from "@starknet-react/core";
import { toastError } from "@/lib/toast";

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

const CONNECT_SLOW_NOTICE_MS = 15000;
const CONNECT_HARD_TIMEOUT_MS = 60000;

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { address } = useAccount();
  const { connect, connectors, pendingConnector, error: connectHookError } = useConnect();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectNotice, setConnectNotice] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const slowNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAttemptIdRef = useRef(0);
  // Treat "connected" as having a concrete address; status flags can be stale.
  const accountConnected = Boolean(address);
  const accountConnectedRef = useRef(accountConnected);

  useEffect(() => {
    accountConnectedRef.current = accountConnected;
  }, [accountConnected]);

  const clearConnectTimers = () => {
    if (slowNoticeTimerRef.current) {
      clearTimeout(slowNoticeTimerRef.current);
      slowNoticeTimerRef.current = null;
    }
    if (hardTimeoutTimerRef.current) {
      clearTimeout(hardTimeoutTimerRef.current);
      hardTimeoutTimerRef.current = null;
    }
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      clearConnectTimers();
      setConnectError(null);
      setConnectNotice(null);
      setConnectingId(null);
    }
  }, [isOpen]);

  // Some wallet connectors resolve `connectAsync` late even after account state is connected.
  // Close the modal as soon as account state confirms connection.
  useEffect(() => {
    if (!isOpen || !accountConnected) return;
    clearConnectTimers();
    onClose();
  }, [isOpen, accountConnected, onClose]);

  useEffect(() => {
    if (!isOpen || !connectingId || !connectHookError || accountConnectedRef.current) return;
    const message =
      connectHookError instanceof Error && connectHookError.message
        ? connectHookError.message
        : "Wallet connection failed.";
    clearConnectTimers();
    setConnectNotice(null);
    setConnectError(message);
    setConnectingId(null);
  }, [isOpen, connectingId, connectHookError]);

  const handleConnect = async (connectorId: string) => {
    const connector = connectors.find((item) => item.id === connectorId);
    if (!connector) return;

    const attemptId = connectAttemptIdRef.current + 1;
    connectAttemptIdRef.current = attemptId;

    setConnectError(null);
    setConnectNotice(null);
    setConnectingId(connector.id);
    clearConnectTimers();
    try {
      if (!connector.available()) {
        throw new Error(`${connector.name} was not detected in this browser.`);
      }
      slowNoticeTimerRef.current = setTimeout(() => {
        if (connectAttemptIdRef.current !== attemptId || accountConnectedRef.current) return;
        setConnectNotice("Still waiting for wallet approval. Unlock/approve the wallet extension to continue.");
      }, CONNECT_SLOW_NOTICE_MS);
      hardTimeoutTimerRef.current = setTimeout(() => {
        if (connectAttemptIdRef.current !== attemptId || accountConnectedRef.current) return;
        const message = "Wallet extension did not respond. Unlock/approve the wallet and try again.";
        setConnectNotice(null);
        setConnectError(message);
        setConnectingId(null);
      }, CONNECT_HARD_TIMEOUT_MS);
      connect({ connector });
    } catch (error) {
      if (accountConnectedRef.current) {
        return;
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Wallet connection failed.";
      setConnectError(message);
      toastError(message);
    }
  };

  if (!isMounted) {
    return null;
  }

  const modal = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[140]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4"
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
                {connectors.length === 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    No Starknet wallet detected. Install Argent X, Braavos, or another Starknet extension and refresh.
                  </div>
                )}
                {connectors.map((connector) => (
                  <button
                    key={connector.id}
                    type="button"
                    onClick={() => void handleConnect(connector.id)}
                    disabled={Boolean(connectingId) && connectingId !== connector.id}
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
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600 group-hover:text-zinc-400">
                      {connectingId === connector.id || pendingConnector?.id === connector.id ? "Connecting…" : "Connect"}
                    </span>
                  </button>
                ))}
              </div>

              {connectError ? (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {connectError}
                </p>
              ) : null}
              {!connectError && connectNotice ? (
                <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {connectNotice}
                </p>
              ) : null}

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

  return createPortal(modal, document.body);
}
