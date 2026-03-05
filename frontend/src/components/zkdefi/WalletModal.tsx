"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X, FlaskConical, RefreshCw, ShieldCheck } from "lucide-react";
import { DynamicBridgeWidget } from "@dynamic-labs/sdk-react-core";
import { useConnect, useAccount, useSignTypedData } from "@starknet-react/core";
import {
  completeDualWalletSession,
  getDualWalletSession,
  revokeDualWalletSession,
  startDualWalletSession,
  type DualWalletSessionStatus,
} from "@/lib/api/authSession";
import {
  EVM_CHAIN_OPTIONS,
  discoverEvmWallets,
  firstEvmAccount,
  type DetectedEvmWallet,
  type EvmChain,
} from "@/lib/evm/injectedWallets";
import {
  buildWeb3AuthCredential,
  buildDualSessionTypedData,
  type DualAuthMethod,
} from "@/lib/evm/siwWeb3";
import { toastError, toastSuccess } from "@/lib/toast";

const CONNECT_TIMEOUT_MS = 15000;
const dynamicEnabled = Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID?.trim());

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function shortHex(value: string | undefined): string {
  if (!value) return "--";
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, connectors } = useConnect();
  const { isConnected, address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData({});
  const safeConnectors = useMemo(
    () => (Array.isArray(connectors) ? connectors.filter((connector) => connector && typeof connector.id === "string") : []),
    [connectors],
  );
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [dualSessionLoading, setDualSessionLoading] = useState(false);
  const [dualSessionBusy, setDualSessionBusy] = useState(false);
  const [dualSession, setDualSession] = useState<DualWalletSessionStatus | null>(null);
  const [evmWallets, setEvmWallets] = useState<DetectedEvmWallet[]>([]);
  const [evmWalletsLoading, setEvmWalletsLoading] = useState(false);
  const [selectedEvmWalletId, setSelectedEvmWalletId] = useState<string>("");
  const [selectedEvmChain, setSelectedEvmChain] = useState<EvmChain>("ethereum");
  const [authMethod, setAuthMethod] = useState<DualAuthMethod>("injected");

  const hasAccount = isConnected && !!address;
  const selectedEvmWallet = useMemo(
    () => evmWallets.find((wallet) => wallet.id === selectedEvmWalletId) ?? evmWallets[0] ?? null,
    [evmWallets, selectedEvmWalletId],
  );
  const detectedEvmLabels = useMemo(
    () => Array.from(new Set(evmWallets.map((wallet) => wallet.label))),
    [evmWallets],
  );

  // Keep modal open after Starknet connection so users can optionally bind an EVM wallet.
  useEffect(() => {
    if (connectingTo && hasAccount) {
      setConnectingTo(null);
      setTimedOut(false);
    }
  }, [connectingTo, hasAccount]);

  // Timeout: stop spinning and show message so user can close or retry
  useEffect(() => {
    if (!connectingTo) return;
    const t = setTimeout(() => {
      setTimedOut(true);
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [connectingTo]);

  const refreshDualSession = useCallback(async () => {
    if (!isOpen || !address) {
      setDualSession(null);
      setDualSessionLoading(false);
      return;
    }
    setDualSessionLoading(true);
    try {
      const payload = await getDualWalletSession(address);
      setDualSession(payload);
    } catch {
      setDualSession(null);
    } finally {
      setDualSessionLoading(false);
    }
  }, [address, isOpen]);

  useEffect(() => {
    if (!hasAccount) {
      setDualSession(null);
      setDualSessionLoading(false);
      return;
    }
    refreshDualSession();
  }, [hasAccount, refreshDualSession]);

  const refreshEvmWallets = useCallback(async () => {
    if (!isOpen) {
      setEvmWallets([]);
      setSelectedEvmWalletId("");
      setEvmWalletsLoading(false);
      return;
    }
    setEvmWalletsLoading(true);
    try {
      const wallets = await discoverEvmWallets();
      setEvmWallets(wallets);
      setSelectedEvmWalletId((prev) => {
        if (prev && wallets.some((wallet) => wallet.id === prev)) return prev;
        return wallets[0]?.id ?? "";
      });
    } finally {
      setEvmWalletsLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshEvmWallets();
  }, [isOpen, refreshEvmWallets]);

  const bindDualWalletSession = useCallback(async () => {
    if (!address) return;
    if (!selectedEvmWallet) {
      toastError("No EVM wallet detected. Install MetaMask, Rabby, or another injected wallet.");
      return;
    }

    setDualSessionBusy(true);
    try {
      const accounts = await selectedEvmWallet.provider.request({ method: "eth_requestAccounts" });
      const evmAddress = firstEvmAccount(accounts);
      if (!evmAddress) throw new Error("No EVM account selected.");

      const start = await startDualWalletSession(address, evmAddress, selectedEvmChain);
      let credentials: Record<string, unknown> | undefined;
      if (authMethod === "web3auth_siw") {
        const chainIdHex = chainId != null ? `0x${chainId.toString(16)}` : undefined;
        const typedData = buildDualSessionTypedData({
          nonceId: start.nonce_id,
          evmAddress,
          evmChain: selectedEvmChain,
          starknetChainIdHex: chainIdHex,
        });
        const starknetSignature = await signTypedDataAsync(typedData);
        credentials = await buildWeb3AuthCredential({
          provider: selectedEvmWallet.provider,
          selectedChain: selectedEvmChain,
          evmAddress,
          starknetAddress: address,
          nonceHint: start.nonce_id,
          starknetAuth: {
            chainIdHex: typedData.domain.chainId,
            typedData,
            signature: starknetSignature,
            signedAt: new Date().toISOString(),
          },
        });
      }
      let signature: unknown;
      try {
        signature = await selectedEvmWallet.provider.request({
          method: "personal_sign",
          params: [start.challenge, evmAddress],
        });
      } catch {
        // Some injected wallets still expect the legacy parameter order.
        signature = await selectedEvmWallet.provider.request({
          method: "personal_sign",
          params: [evmAddress, start.challenge],
        });
      }
      if (typeof signature !== "string" || !signature) {
        throw new Error("Wallet signature was not returned.");
      }

      const session = await completeDualWalletSession(
        address,
        evmAddress,
        start.nonce_id,
        signature,
        selectedEvmChain,
        {
          authProvider: authMethod,
          credentials,
        },
      );
      setDualSession(session);
      toastSuccess(
        `${selectedEvmWallet.label} linked (${authMethod === "web3auth_siw" ? "Web3Auth SIW" : "Injected challenge"}).`,
      );
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to link EVM wallet session.");
    } finally {
      setDualSessionBusy(false);
    }
  }, [address, authMethod, chainId, selectedEvmWallet, selectedEvmChain, signTypedDataAsync]);

  const revokeDualSession = useCallback(async () => {
    if (!address) return;
    setDualSessionBusy(true);
    try {
      const payload = await revokeDualWalletSession(address);
      setDualSession(payload);
      toastSuccess("Dual-wallet session revoked.");
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to revoke dual-wallet session.");
    } finally {
      setDualSessionBusy(false);
    }
  }, [address]);

  const handleClose = () => {
    setConnectingTo(null);
    setTimedOut(false);
    onClose();
  };

  const handleConnectorClick = (connector: (typeof connectors)[number]) => {
    if (!connector) return;
    setTimedOut(false);
    const connectorName =
      typeof connector.name === "string" && connector.name.trim().length > 0 ? connector.name : "Starknet wallet";
    setConnectingTo(connectorName);
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
                  {connectingTo
                    ? "Connecting…"
                    : hasAccount
                      ? "Finish Setup"
                      : "Choose your wallet"}
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
              ) : hasAccount ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <p className="text-sm font-medium text-emerald-200">Starknet Connected</p>
                    <p className="mt-1 text-xs text-zinc-300">{shortHex(address ?? undefined)}</p>
                  </div>

                  {dynamicEnabled ? (
                    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4">
                      <p className="text-sm font-medium text-cyan-100">Dual Wallet (Powered by Dynamic)</p>
                      <p className="mt-1 text-xs text-zinc-300">
                        StarkGate-style wallet bridge. Connect and manage EVM + Starknet in one modal.
                      </p>
                      <div className="mt-3">
                        <DynamicBridgeWidget variant="modal" iconVariant="wallet" />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-3">
                      <p className="text-[11px] text-zinc-400">
                        Dynamic bridge is unavailable in this deployment. Use the manual dual-login flow below
                        to link MetaMask/Rabby with your Starknet account.
                      </p>
                    </div>
                  )}

                  <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">Optional EVM Identity Link</p>
                      <button
                        type="button"
                        onClick={() => void refreshEvmWallets()}
                        className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-60"
                        disabled={evmWalletsLoading || dualSessionBusy}
                      >
                        <RefreshCw className={`h-3 w-3 ${evmWalletsLoading ? "animate-spin" : ""}`} />
                        Refresh
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      Bind an EVM wallet for unified identity, reputation, and trust context.
                    </p>

                    {dualSessionLoading ? (
                      <p className="mt-3 text-xs text-zinc-500">Loading session status...</p>
                    ) : dualSession?.active ? (
                      <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
                        <p className="text-xs text-emerald-300">
                          Linked: {shortHex(dualSession.evm_address)}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Chain: {dualSession.chain ?? "ethereum"}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Auth provider: {dualSession.auth_provider ?? "injected"}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Starknet proof: {dualSession.credential_summary?.starknet?.signature_type ?? "wallet_connected"}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Identity binding:{" "}
                          {dualSession.identity_binding?.bound
                            ? "bound (linked-address profile updated)"
                            : "pending"}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-zinc-500">
                        No linked EVM session yet. You can continue without this.
                      </p>
                    )}

                    <div className="mt-3 grid grid-cols-1 gap-2">
                      <select
                        value={authMethod}
                        onChange={(event) => setAuthMethod(event.target.value as DualAuthMethod)}
                        disabled={dualSessionBusy}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
                      >
                        <option value="injected">Injected challenge (default)</option>
                        <option value="web3auth_siw">Web3Auth SIW (CAIP-74 style)</option>
                      </select>
                      <select
                        value={selectedEvmWallet?.id ?? ""}
                        onChange={(event) => setSelectedEvmWalletId(event.target.value)}
                        disabled={dualSessionBusy || evmWallets.length === 0}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
                      >
                        {evmWallets.length === 0 ? (
                          <option value="">No injected EVM wallet detected</option>
                        ) : (
                          evmWallets.map((wallet) => (
                            <option key={wallet.id} value={wallet.id}>
                              {wallet.label}
                            </option>
                          ))
                        )}
                      </select>

                      <select
                        value={selectedEvmChain}
                        onChange={(event) => setSelectedEvmChain(event.target.value as EvmChain)}
                        disabled={dualSessionBusy}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60"
                      >
                        {EVM_CHAIN_OPTIONS.map((chain) => (
                          <option key={chain.value} value={chain.value}>
                            {chain.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        onClick={bindDualWalletSession}
                        disabled={dualSessionBusy || evmWallets.length === 0}
                        className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-500/50 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {dualSessionBusy
                          ? "Linking EVM Wallet..."
                          : dualSession?.active
                            ? "Re-link EVM Wallet"
                            : "Link EVM Wallet"}
                      </button>
                      <button
                        onClick={revokeDualSession}
                        disabled={dualSessionBusy || !dualSession?.active}
                        className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Revoke Link
                      </button>
                    </div>

                    <p className="mt-3 text-[11px] text-zinc-500">
                      Identity link is off-chain context only. Vault and agent execution still require explicit session-key authorization.
                    </p>
                    {authMethod === "web3auth_siw" && (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        SIW mode requests one EVM SIW signature plus one Starknet typed-data signature.
                      </p>
                    )}
                    <Link
                      href="/agent?v=brain"
                      onClick={handleClose}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      Grant vault/agent session key
                    </Link>
                  </div>

                  <p className="text-[11px] text-zinc-500">
                    Eligibility signal only. Not legal, tax, or financial advice.
                  </p>

                  <button
                    onClick={handleClose}
                    className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-medium"
                  >
                    Continue to app
                  </button>
                </div>
              ) : (
                <>
                  {dynamicEnabled ? (
                    <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
                      <p className="text-xs font-medium text-cyan-200">Connect EVM + Starknet (Dynamic)</p>
                      <p className="mt-1 text-[11px] text-zinc-300">
                        Opens the same dual-chain connect flow used by StarkGate.
                      </p>
                      <div className="mt-3">
                        <DynamicBridgeWidget variant="modal" iconVariant="wallet" />
                      </div>
                    </div>
                  ) : (
                    <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-900/40 p-3">
                      <p className="text-[11px] text-zinc-400">
                        Unified Dynamic bridge is temporarily unavailable. Connect Starknet below, then use
                        manual dual-login to bind MetaMask/Rabby.
                      </p>
                    </div>
                  )}

                  {(evmWalletsLoading || detectedEvmLabels.length > 0) && (
                    <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-cyan-200">
                          {evmWalletsLoading
                            ? "Scanning for MetaMask / EVM wallets..."
                            : `Detected: ${detectedEvmLabels.join(", ")}`}
                        </p>
                        <button
                          type="button"
                          onClick={() => void refreshEvmWallets()}
                          className="inline-flex items-center gap-1 rounded border border-cyan-500/40 px-2 py-1 text-[11px] text-cyan-100 hover:border-cyan-400"
                          disabled={evmWalletsLoading}
                        >
                          <RefreshCw className={`h-3 w-3 ${evmWalletsLoading ? "animate-spin" : ""}`} />
                          Refresh
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-300">
                        Dual login links Starknet + EVM. Connect Starknet first, then open{" "}
                        <span className="text-cyan-200">Wallet &amp; Dual Login</span> to bind MetaMask.
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {!safeConnectors.length ? (
                      <div className="py-6 px-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-center">
                        <p className="text-amber-200 text-sm font-medium mb-1">No wallet detected</p>
                        <p className="text-zinc-400 text-xs">
                          Install <a href="https://www.argent.xyz/argent-x/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Argent X</a> or <a href="https://braavos.app/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Braavos</a> browser extension, then refresh.
                        </p>
                      </div>
                    ) : (
                    safeConnectors.map((connector) => {
                      const connectorName =
                        typeof connector.name === "string" && connector.name.trim().length > 0
                          ? connector.name
                          : "Starknet wallet";
                      const isArgent = connectorName.toLowerCase().includes("argent");
                      return (
                      <button
                        key={connector.id}
                        onClick={() => handleConnectorClick(connector)}
                        className="w-full glass rounded-lg border border-zinc-700 hover:border-emerald-500/50 p-4 flex items-center gap-4 transition-all hover:bg-zinc-800/50"
                      >
                        <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center">
                          <span className="text-xl font-semibold">
                            {isArgent ? "A" : "B"}
                          </span>
                        </div>
                        <div className="flex-1 text-left">
                          <div className="font-medium text-white">{connectorName}</div>
                          <div className="text-sm text-zinc-400">
                            {isArgent
                              ? "Secure smart contract wallet"
                              : "Non-custodial wallet"}
                          </div>
                        </div>
                      </button>
                      );
                    })
                    )}
                  </div>

                  <Link
                    href="/agent?mode=demo"
                    onClick={handleClose}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-cyan-600/50 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 hover:border-cyan-500/60 transition-colors text-sm font-medium"
                  >
                    <FlaskConical className="w-4 h-4" />
                    Try paper mode (no wallet)
                  </Link>
                  <p className="mt-3 text-xs text-zinc-500 text-center">
                    Paper mode uses our internal ledger only. No chain transactions, no wallet needed.
                  </p>

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
