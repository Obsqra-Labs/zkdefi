"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { ProofVisualizer } from "./ProofVisualizer";
import { ConnectButton } from "./ConnectButton";
import { toastSuccess, toastError } from "@/lib/toast";
import {
  Lock, Shield, Eye, ArrowDownToLine, ArrowUpFromLine, Key, Download,
  FileCheck, AlertTriangle, Fingerprint, CheckCircle2, Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";
const FULLY_SHIELDED_POOL_ADDRESS = process.env.NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS || "";
const EXPLORER_STARKSCAN = "https://sepolia.starkscan.co";
const EXPLORER_VOYAGER = "https://sepolia.voyager.online";
// Token for Full Privacy Pool must implement ERC20 (approve + transfer_from). Must NOT be the pool address.
const SEPOLIA_ETH = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const _rawToken = process.env.NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS || SEPOLIA_ETH;
// Safeguard: if token was set to pool address (copy-paste), pool has no "approve" -> ENTRYPOINT_NOT_FOUND. Use Sepolia ETH.
const FULL_PRIVACY_TOKEN_ADDRESS =
  _rawToken.toLowerCase() === FULLY_SHIELDED_POOL_ADDRESS.toLowerCase() ? SEPOLIA_ETH : _rawToken;
const USE_FELT_DEPOSIT = process.env.NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT === "true";
const USE_FELT_WITHDRAW = process.env.NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_WITHDRAW !== "false";
const STARK_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");

type PoolType = 0 | 1 | 2;
type Mode = "deposit" | "withdraw" | "disclose";

interface CommitmentData {
  commitment: string;
  user_secret: string;
  amount: number | string;  // String to preserve precision for large amounts
  pool_type: PoolType;
  nonce: string;
  blinding: string;
  leaf_index?: number;
  merkle_root?: string;
  /** Stored merkle proof from register_commitment — required for reliable withdraw (backend uses this to bypass get_merkle_proof bug) */
  path_elements?: string[];
  path_indices?: number[];
  // Withdraw proof data (populated after proof generation)
  nullifier?: string;
  root?: string;
  recipient?: string;
  proof_calldata?: string[];
}

const POOL_INFO: Record<PoolType, { name: string; allocation: string }> = {
  0: { name: "Conservative", allocation: "80% JediSwap / 20% Ekubo" },
  1: { name: "Neutral", allocation: "50% JediSwap / 50% Ekubo" },
  2: { name: "Aggressive", allocation: "20% JediSwap / 80% Ekubo" },
};

// Helper to convert amount (string or number) to ETH for display
const amountToEth = (amount: string | number): number => {
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : BigInt(Math.floor(amount));
  return Number(amountBigInt) / 1e18;
};

// Helper to convert ETH amount (as string) to wei (as string) using pure BigInt math
// This avoids JavaScript floating-point precision issues for amounts > 9 quadrillion wei (~9 ETH)
const ethToWei = (ethAmount: string): string => {
  // Parse the decimal amount properly
  const parts = ethAmount.split('.');
  const integerPart = parts[0] || '0';
  const decimalPart = (parts[1] || '').padEnd(18, '0').slice(0, 18);
  
  // Combine into wei: integer * 1e18 + decimal (padded to 18 digits)
  const integerWei = BigInt(integerPart) * BigInt(10 ** 18);
  const decimalWei = BigInt(decimalPart);
  
  return (integerWei + decimalWei).toString();
};

export function FullPrivacyPoolPanel() {
  const { address, account, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("deposit");
  const [selectedPool, setSelectedPool] = useState<PoolType>(1);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState(1);
  const [commitmentData, setCommitmentData] = useState<CommitmentData | null>(null);
  const [savedCommitments, setSavedCommitments] = useState<CommitmentData[]>([]);
  const [selectedCommitment, setSelectedCommitment] = useState<CommitmentData | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [merkleRoot, setMerkleRoot] = useState<string | null>(null);
  const [disclosureType, setDisclosureType] = useState<"balance" | "pool">("balance");
  const [disclosureThreshold, setDisclosureThreshold] = useState("");
  const [disclosureResult, setDisclosureResult] = useState<string | null>(null);
  const [useRelayer, setUseRelayer] = useState(false);
  const [relayerDestination, setRelayerDestination] = useState("");
  const [depositSubmitting, setDepositSubmitting] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && address) {
      // Version check: Clear old commitments from before Feb 4, 2026 merkle tree reset
      const MERKLE_TREE_RESET_DATE = "2026-02-04";
      const versionKey = `zkdefi_fullprivacy_version`;
      const currentVersion = localStorage.getItem(versionKey);
      
      if (currentVersion !== MERKLE_TREE_RESET_DATE) {
        console.log("Clearing old Full Privacy Pool commitments (merkle tree was reset)");
        localStorage.removeItem(`zkdefi_fullprivacy_${address}`);
        localStorage.setItem(versionKey, MERKLE_TREE_RESET_DATE);
        setSavedCommitments([]);
      } else {
        const stored = localStorage.getItem(`zkdefi_fullprivacy_${address}`);
        if (stored) setSavedCommitments(JSON.parse(stored));
      }
      
      fetch(`${API_BASE}/api/v1/zkdefi/full_privacy/merkle/root`).then(r => r.json()).then(d => setMerkleRoot(d.root)).catch(() => {});
    }
  }, [mounted, address]);

  const saveCommitment = (data: CommitmentData) => {
    if (!address) return;
    setSavedCommitments((prev) => {
      const updated = [...prev, data];
      localStorage.setItem(`zkdefi_fullprivacy_${address}`, JSON.stringify(updated));
      return updated;
    });
  };

  const resetFlow = () => { setStep(1); setCommitmentData(null); setTxHash(null); setAmount(""); setSelectedCommitment(null); setDisclosureResult(null); setUseRelayer(false); setRelayerDestination(""); };

  const handleGenerateCommitment = async () => {
    if (!address || !amount) return;
    setStep(2);
    try {
      // Convert ETH to wei using pure BigInt math to avoid precision loss
      // Important: parseFloat * 1e18 CORRUPTS values > 9 ETH due to JavaScript float limits
      const amountWei = ethToWei(amount);
      console.log(`[FullPrivacy] Converting ${amount} ETH to ${amountWei} wei`);
      
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/full_privacy/deposit/generate_commitment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Send amount as string to preserve precision
        body: JSON.stringify({ user_address: address, amount: amountWei, pool_type: selectedPool }),
      });
      const data = await res.json();
      if (data.commitment) { 
        // Backend now returns amount as string to preserve precision
        // Store the data as-is (no need to override amount)
        setCommitmentData(data); 
        setStep(3); 
        toastSuccess("Commitment generated!"); 
      }
      else { toastError(data.detail || "Failed"); setStep(1); }
    } catch (e) { toastError(`Error: ${e}`); setStep(1); }
  };

  const handleDeposit = async () => {
    if (!account) {
      toastError("Wallet not connected");
      return;
    }
    if (!commitmentData) {
      toastError("No commitment data");
      return;
    }
    if (!FULLY_SHIELDED_POOL_ADDRESS) {
      toastError("Full Privacy Pool not configured. Check NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS");
      return;
    }
    if (depositSubmitting) return;
    setDepositSubmitting(true);

    console.log("=== FULL PRIVACY POOL DEPOSIT ===");
    console.log("About to call account.execute - wallet signature should appear...");
    console.log("Pool address:", FULLY_SHIELDED_POOL_ADDRESS);
    console.log("Commitment:", commitmentData.commitment);
    console.log("Account:", account);
    
    try {
      // Convert amount to u256 (low, high)
      const amountWei = BigInt(commitmentData.amount);
      const amountLow = amountWei % BigInt(2 ** 128);
      const amountHigh = amountWei / BigInt(2 ** 128);
      
      // Parse commitment as u256 (low, high) for BN254 Poseidon compatibility
      const commitmentBigInt = commitmentData.commitment.startsWith("0x")
        ? BigInt(commitmentData.commitment)
        : BigInt("0x" + commitmentData.commitment);
      const commitmentLow = commitmentBigInt % BigInt(2 ** 128);
      const commitmentHigh = commitmentBigInt / BigInt(2 ** 128);

      // Felt252 max: commitment must fit for deposit(commitment: felt252, amount: u256)
      const FELT252_MAX = BigInt(2) ** BigInt(252);
      const useFeltDeposit = USE_FELT_DEPOSIT && commitmentBigInt < FELT252_MAX;

      console.log("Calling account.execute NOW - wallet should popup...");
      console.log(useFeltDeposit ? "Using deposit (felt252) entrypoint" : "Commitment u256:", useFeltDeposit ? "" : { low: commitmentLow.toString(), high: commitmentHigh.toString() });

      const poolCall = useFeltDeposit
        ? {
            contractAddress: FULLY_SHIELDED_POOL_ADDRESS as `0x${string}`,
            entrypoint: "deposit",
            calldata: [commitmentBigInt.toString(), amountLow.toString(), amountHigh.toString()],
          }
        : {
            contractAddress: FULLY_SHIELDED_POOL_ADDRESS as `0x${string}`,
            entrypoint: "deposit_u256",
            calldata: [
              commitmentLow.toString(),
              commitmentHigh.toString(),
              amountLow.toString(),
              amountHigh.toString(),
            ],
          };

      const result = await account.execute([
        {
          contractAddress: FULL_PRIVACY_TOKEN_ADDRESS as `0x${string}`,
          entrypoint: "approve",
          calldata: [FULLY_SHIELDED_POOL_ADDRESS, amountLow.toString(), amountHigh.toString()],
        },
        poolCall,
      ]);
      
      console.log("SUCCESS! Transaction submitted:", result.transaction_hash);
      console.log("==================================");

      // Only set step 4 AFTER transaction succeeds
      setStep(4);
      setTxHash(result.transaction_hash);
      // Show in withdraw list immediately (will add leaf_index when register returns)
      saveCommitment(commitmentData);
      toastSuccess("Deposit transaction submitted!", {
        action: {
          label: "View on explorer",
          onClick: () => window.open(`${EXPLORER_STARKSCAN}/tx/${result.transaction_hash}`, "_blank"),
        },
      });

      // Register commitment in off-chain merkle tree (updates list with leaf_index when done)
      const regRes = await fetch(`${API_BASE}/api/v1/zkdefi/full_privacy/deposit/register_commitment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitment: commitmentData.commitment }),
      });
      const regData = await regRes.json();
      if (regData.leaf_index !== undefined) {
        const fullData: CommitmentData = {
          ...commitmentData,
          leaf_index: regData.leaf_index,
          merkle_root: regData.merkle_root,
          path_elements: regData.path_elements,
          path_indices: regData.path_indices,
        };
        setSavedCommitments((prev) => {
          const idx = prev.findIndex((c) => c.commitment === commitmentData.commitment);
          const next = idx >= 0 ? prev.map((c, i) => (i === idx ? fullData : c)) : [...prev, fullData];
          if (address) localStorage.setItem(`zkdefi_fullprivacy_${address}`, JSON.stringify(next));
          return next;
        });
        setMerkleRoot(regData.merkle_root);
      }
    } catch (e: unknown) {
      console.error("DEPOSIT FAILED:", e);
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Deposit failed: ${err}`);
      // Stay on step 3 so user can try again
      setStep(3);
    } finally {
      setDepositSubmitting(false);
    }
  };

  const handleGenerateWithdrawProof = async () => {
    if (!selectedCommitment || !amount || !address) return;
    if (useRelayer && !relayerDestination?.trim()) return;
    setStep(2);
    const recipient = useRelayer ? relayerDestination.trim() : address;
    try {
      // Use pure BigInt math to avoid precision loss (same as deposit)
      const withdrawAmount = ethToWei(amount);
      console.log(`[FullPrivacy] Withdraw: converting ${amount} ETH to ${withdrawAmount} wei`);
      // Use leaf_index if available, otherwise send -1 for auto-find
      const leafIndex = selectedCommitment.leaf_index ?? -1;
      // Send amount as string to preserve precision
      const commitmentAmount = typeof selectedCommitment.amount === 'number' 
        ? selectedCommitment.amount.toString() 
        : selectedCommitment.amount;
      const body: Record<string, unknown> = {
        user_secret: selectedCommitment.user_secret,
        amount: commitmentAmount,
        pool_type: selectedCommitment.pool_type,
        nonce: selectedCommitment.nonce,
        blinding: selectedCommitment.blinding,
        withdraw_amount: withdrawAmount,
        recipient,
        leaf_index: leafIndex,
      };
      if (selectedCommitment.merkle_root && selectedCommitment.path_elements?.length && selectedCommitment.path_indices?.length) {
        body.merkle_root = selectedCommitment.merkle_root;
        body.path_elements = selectedCommitment.path_elements;
        body.path_indices = selectedCommitment.path_indices;
      }
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/full_privacy/withdraw/generate_proof`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.nullifier) { setCommitmentData({ ...selectedCommitment, ...data }); setStep(3); toastSuccess("Withdrawal proof generated!"); }
      else { toastError(data.detail || "Failed to generate proof"); setStep(1); }
    } catch (e) { toastError(`Error: ${e}`); setStep(1); }
  };

  const handleSyncCommitment = async (commitment: CommitmentData) => {
    // Try to find commitment in merkle tree and update leaf_index
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/full_privacy/merkle/find_commitment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_secret: commitment.user_secret,
          amount: commitment.amount,
          pool_type: commitment.pool_type,
          nonce: commitment.nonce,
          blinding: commitment.blinding,
        }),
      });
      const data = await res.json();
      if (data.found && data.leaf_index !== null) {
        // Update the commitment with the correct leaf_index
        const updated = savedCommitments.map(c =>
          c.commitment === commitment.commitment
            ? { ...c, leaf_index: data.leaf_index, merkle_root: data.merkle_root }
            : c
        );
        setSavedCommitments(updated);
        if (address) localStorage.setItem(`zkdefi_fullprivacy_${address}`, JSON.stringify(updated));
        toastSuccess(`Commitment synced! Leaf index: ${data.leaf_index}`);
      } else {
        toastError(data.message || "Commitment not found in tree");
      }
    } catch (e) {
      toastError(`Sync failed: ${e}`);
    }
  };

  const handleWithdraw = async () => {
    if (!account) {
      toastError("Wallet not connected or still loading. Use Connect Wallet in the header or refresh the page.");
      return;
    }
    if (!commitmentData) {
      toastError("No commitment data");
      return;
    }
    if (!FULLY_SHIELDED_POOL_ADDRESS) {
      toastError("Full Privacy Pool not configured");
      return;
    }
    if (!commitmentData.nullifier || !commitmentData.root || !commitmentData.proof_calldata) {
      toastError("Missing proof data. Generate withdrawal proof first.");
      return;
    }
    
    console.log("=== FULL PRIVACY POOL WITHDRAW ===");
    console.log("About to call account.execute - wallet signature should appear...");
    console.log("Nullifier:", commitmentData.nullifier);
    console.log("Account:", account);
    
    try {
      const nullifierBigInt = commitmentData.nullifier.startsWith("0x")
        ? BigInt(commitmentData.nullifier)
        : BigInt("0x" + commitmentData.nullifier);
      const rootBigInt = commitmentData.root.startsWith("0x")
        ? BigInt(commitmentData.root)
        : BigInt("0x" + commitmentData.root);
      const recipientAddr = commitmentData.recipient || address || "";

      const withdrawAmountWei = BigInt(ethToWei(amount));
      const amountLow = withdrawAmountWei % BigInt(2 ** 128);
      const amountHigh = withdrawAmountWei / BigInt(2 ** 128);
      const poolTypeNum = selectedCommitment?.pool_type ?? 1;

      const proofFelts = commitmentData.proof_calldata.map((p) => {
        const v = BigInt(p.startsWith("0x") ? p : "0x" + p);
        return (v % STARK_PRIME).toString();
      });

      const useFeltWithdraw = USE_FELT_WITHDRAW && nullifierBigInt < STARK_PRIME && rootBigInt < STARK_PRIME;
      const nullifierStr = nullifierBigInt.toString();
      const rootStr = rootBigInt.toString();

      if (useFeltWithdraw) {
        console.log("Using withdraw(felt252) entrypoint");
      } else {
        console.log("Using withdraw_u256 entrypoint");
      }

      const result = await account.execute({
        contractAddress: FULLY_SHIELDED_POOL_ADDRESS as `0x${string}`,
        entrypoint: useFeltWithdraw ? "withdraw" : "withdraw_u256",
        calldata: useFeltWithdraw
          ? [nullifierStr, rootStr, recipientAddr, amountLow.toString(), amountHigh.toString(), poolTypeNum.toString(), proofFelts.length.toString(), ...proofFelts]
          : [
              (nullifierBigInt % BigInt(2 ** 128)).toString(),
              (nullifierBigInt / BigInt(2 ** 128)).toString(),
              (rootBigInt % BigInt(2 ** 128)).toString(),
              (rootBigInt / BigInt(2 ** 128)).toString(),
              recipientAddr,
              amountLow.toString(),
              amountHigh.toString(),
              poolTypeNum.toString(),
              proofFelts.length.toString(),
              ...proofFelts,
            ],
      });
      
      console.log("SUCCESS! Transaction submitted:", result.transaction_hash);
      console.log("==================================");

      // Only set step 4 AFTER transaction succeeds
      setStep(4);
      setTxHash(result.transaction_hash);
      toastSuccess("Withdrawal successful!", {
        action: {
          label: "View on explorer",
          onClick: () => window.open(`${EXPLORER_STARKSCAN}/tx/${result.transaction_hash}`, "_blank"),
        },
      });

      // Remove the spent commitment from saved list
      if (address && selectedCommitment) {
        const updated = savedCommitments.filter(c => c.commitment !== selectedCommitment.commitment);
        setSavedCommitments(updated);
        localStorage.setItem(`zkdefi_fullprivacy_${address}`, JSON.stringify(updated));
      }
    } catch (e: unknown) {
      console.error("WITHDRAW FAILED:", e);
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Withdrawal failed: ${err}`);
      // Stay on step 3 so user can try again
      setStep(3);
    }
  };

  const handleSelectiveDisclosure = async () => {
    if (!selectedCommitment) return;
    try {
      const endpoint = disclosureType === "balance" ? "balance_above" : "pool_membership";
      const body = disclosureType === "balance" ? {
        user_secret: selectedCommitment.user_secret, amount: selectedCommitment.amount,
        pool_type: selectedCommitment.pool_type, nonce: selectedCommitment.nonce,
        blinding: selectedCommitment.blinding, threshold: parseInt(disclosureThreshold) * 1e18,
        leaf_index: selectedCommitment.leaf_index,
      } : {
        user_secret: selectedCommitment.user_secret, amount: selectedCommitment.amount,
        pool_type: selectedCommitment.pool_type, nonce: selectedCommitment.nonce,
        blinding: selectedCommitment.blinding, leaf_index: selectedCommitment.leaf_index,
      };
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/full_privacy/disclosure/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.verified) { setDisclosureResult(data.message); toastSuccess(data.message); }
      else toastError(data.detail || "Failed");
    } catch (e) { toastError(`Error: ${e}`); }
  };

  const exportCommitmentData = () => {
    if (!commitmentData) return;
    const blob = new Blob([JSON.stringify(commitmentData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `commitment_${commitmentData.commitment.slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!mounted) return <div className="glass rounded-2xl border border-zinc-800 p-8 text-center"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  if (!walletSettled) return <div className="glass rounded-2xl border border-zinc-800 p-8 text-center"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  if (!isConnected) return <div className="glass rounded-2xl border border-zinc-800 p-8 text-center"><Lock className="w-12 h-12 text-violet-400 mx-auto mb-4" /><h2 className="text-xl font-bold mb-2">Full Privacy Pool</h2><p className="text-zinc-400 mb-4">Connect wallet to access maximum privacy features</p><ConnectButton /></div>;

  return (
    <div className="glass rounded-2xl border border-zinc-800 p-8">
      <div className="flex items-center justify-between mb-6">
        <div><h2 className="text-2xl font-bold mb-1 flex items-center gap-2"><Shield className="w-6 h-6 text-violet-400" />Full Privacy Pool</h2><p className="text-sm text-zinc-400">Everything hidden + selective disclosure</p></div>
        <span className="px-3 py-1 rounded-full bg-violet-900/30 text-violet-300 border border-violet-800/50 text-xs font-medium flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5" />Merkle Tree</span>
      </div>

      <div className="mb-6 p-4 rounded-lg bg-gradient-to-r from-violet-950/50 to-purple-950/50 border border-violet-800/30">
        <div className="flex items-start gap-3"><Eye className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" /><div className="text-sm"><p className="text-violet-300 font-medium mb-1">Maximum Privacy Mode</p><p className="text-zinc-400">Balance, pool type, and owner are ALL hidden on-chain.</p></div></div>
      </div>

      <div className="flex gap-2 mb-6 p-1 bg-zinc-900/50 rounded-lg border border-zinc-700">
        <button onClick={() => { setMode("deposit"); resetFlow(); }} className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm flex items-center justify-center gap-2 ${mode === "deposit" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}><ArrowDownToLine className="w-4 h-4" />Deposit</button>
        <button onClick={() => { setMode("withdraw"); resetFlow(); }} className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm flex items-center justify-center gap-2 ${mode === "withdraw" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}><ArrowUpFromLine className="w-4 h-4" />Withdraw</button>
        <button onClick={() => { setMode("disclose"); resetFlow(); }} className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm flex items-center justify-center gap-2 ${mode === "disclose" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}><FileCheck className="w-4 h-4" />Disclose</button>
      </div>

      {merkleRoot && <div className="mb-6 p-3 rounded-lg bg-zinc-900/50 border border-zinc-700"><p className="text-xs text-zinc-500">Current Merkle Root</p><p className="font-mono text-xs text-zinc-300 truncate">{merkleRoot}</p></div>}

      <AnimatePresence mode="wait">
        {mode === "deposit" && step === 1 && (
          <motion.div key="deposit-step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
            <div><label className="block text-sm font-medium text-zinc-300 mb-3">Select Pool</label><div className="grid grid-cols-3 gap-3">{([0, 1, 2] as PoolType[]).map((pool) => (<button key={pool} onClick={() => setSelectedPool(pool)} className={`p-4 rounded-lg border text-left ${selectedPool === pool ? "border-violet-500 bg-violet-950/30" : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"}`}><p className="font-medium text-sm mb-1">{POOL_INFO[pool].name}</p><p className="text-xs text-zinc-500">{POOL_INFO[pool].allocation}</p></button>))}</div></div>
            <div><label className="block text-sm font-medium text-zinc-300 mb-2">Amount (ETH)</label><input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-lg font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50" /></div>
            <button onClick={handleGenerateCommitment} disabled={!amount} className="w-full px-6 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg font-semibold text-white flex items-center justify-center gap-2"><Key className="w-5 h-5" />Generate Secret Commitment</button>
          </motion.div>
        )}
        {mode === "deposit" && step === 3 && commitmentData && (
          <motion.div key="deposit-step3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30"><div className="flex items-start gap-3"><AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" /><div className="text-sm"><p className="text-amber-300 font-medium mb-1">Save This Data Securely</p><p className="text-zinc-400">You MUST save this commitment data to withdraw later.</p></div></div></div>
            <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-700 space-y-3"><div><p className="text-xs text-zinc-500">Commitment (Public)</p><p className="font-mono text-xs text-zinc-200 break-all">{commitmentData.commitment}</p></div><div><p className="text-xs text-zinc-500">User Secret (PRIVATE)</p><p className="font-mono text-xs text-red-400 break-all">{commitmentData.user_secret.slice(0, 20)}...</p></div><div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-zinc-500">Pool</p><p className="text-sm">{POOL_INFO[commitmentData.pool_type as PoolType].name}</p></div><div><p className="text-xs text-zinc-500">Amount</p><p className="text-sm">{amountToEth(commitmentData.amount).toFixed(4)} ETH</p></div></div></div>
            <button onClick={exportCommitmentData} className="w-full px-4 py-3 border border-violet-600 text-violet-400 hover:bg-violet-950/30 rounded-lg font-medium flex items-center justify-center gap-2"><Download className="w-4 h-4" />Download Commitment Data</button>
            <button onClick={handleDeposit} disabled={depositSubmitting || !account} className="w-full px-6 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:pointer-events-none rounded-lg font-semibold text-white flex items-center justify-center gap-2" title={!account ? "Wallet not ready — refresh or reconnect" : undefined}><Lock className="w-5 h-5" />{depositSubmitting ? "Submitting…" : !account ? "Wallet loading…" : "Confirm Deposit"}</button>
          </motion.div>
        )}
        {mode === "withdraw" && step === 1 && (
          <motion.div key="withdraw-step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
            <div className="p-4 rounded-lg bg-orange-950/20 border border-orange-800/30"><div className="flex items-start gap-3"><ArrowUpFromLine className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" /><div className="text-sm"><p className="text-orange-300 font-medium mb-1">Private Withdrawal</p><p className="text-zinc-400">Generate ZK proof to withdraw without revealing your identity.</p></div></div></div>
            <div><label className="block text-sm font-medium text-zinc-300 mb-2">Select Commitment</label>
              {savedCommitments.length === 0 ? (
                <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-900/50 text-center"><p className="text-sm text-zinc-400 mb-2">No saved commitments</p><p className="text-xs text-zinc-500">Make a deposit first or import commitment data</p></div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {savedCommitments.map((c, i) => (
                    <div key={i} className={`p-4 rounded-lg border transition-all ${selectedCommitment?.commitment === c.commitment ? "border-violet-500 bg-violet-950/30" : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"}`}>
                      <button onClick={() => setSelectedCommitment(c)} className="w-full text-left">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono text-sm text-zinc-200">{c.commitment.slice(0, 10)}...{c.commitment.slice(-6)}</p>
                            <p className="text-xs text-zinc-500 mt-1">
                              {POOL_INFO[c.pool_type as PoolType].name} pool
                              {c.leaf_index !== undefined ? ` • Leaf #${c.leaf_index}` : " • Not synced"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-semibold">{amountToEth(c.amount).toFixed(4)}</p>
                            <p className="text-xs text-zinc-500">ETH</p>
                          </div>
                        </div>
                      </button>
                      {c.leaf_index === undefined && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSyncCommitment(c); }}
                          className="mt-2 w-full px-3 py-1.5 text-xs rounded-lg border border-amber-600/50 text-amber-400 hover:bg-amber-950/30"
                        >
                          Sync with Merkle Tree
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedCommitment && (
              <div><label className="block text-sm font-medium text-zinc-300 mb-2">Withdraw Amount (ETH)</label>
                <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-lg font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
                <p className="mt-1 text-xs text-zinc-500">Max: {amountToEth(selectedCommitment.amount).toFixed(4)} ETH</p>
              </div>
            )}

            {/* Relayer Option - Full Privacy Pool: no tier required */}
            {selectedCommitment && amount && (
              <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-700">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useRelayer}
                    onChange={(e) => setUseRelayer(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Send className="w-4 h-4 text-violet-400" />
                      <span className="font-medium text-sm">Use Private Relayer</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">
                      Withdraw to a fresh address. Full Privacy Pool: no tier required. Breaks the on-chain link between source and destination.
                    </p>
                  </div>
                </label>
                {useRelayer && (
                  <div className="mt-4">
                    <label className="block text-sm text-zinc-400 mb-2">Destination Address (fresh wallet)</label>
                    <input
                      type="text"
                      value={relayerDestination}
                      onChange={(e) => setRelayerDestination(e.target.value)}
                      placeholder="0x..."
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-mono text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                    <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300">Use a fresh address with no prior transaction history for maximum privacy.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button onClick={handleGenerateWithdrawProof} disabled={!selectedCommitment || !amount || (useRelayer && !relayerDestination?.trim())} className="w-full px-6 py-4 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg font-semibold text-white flex items-center justify-center gap-2"><Lock className="w-5 h-5" />Generate Withdrawal Proof</button>
          </motion.div>
        )}
        {mode === "withdraw" && step === 3 && commitmentData && (
          <motion.div key="withdraw-step3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
            <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/30"><div className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" /><div className="text-sm"><p className="text-emerald-300 font-medium mb-1">Proof Generated</p><p className="text-zinc-400">Your withdrawal proof is ready. Sign to complete.</p></div></div></div>
            <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-700 space-y-3">
              <div><p className="text-xs text-zinc-500">Nullifier (prevents double-spend)</p><p className="font-mono text-xs text-zinc-200 break-all">{(commitmentData as any).nullifier || "N/A"}</p></div>
              <div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-zinc-500">Amount</p><p className="text-sm">{amount} ETH</p></div><div><p className="text-xs text-zinc-500">Pool</p><p className="text-sm">{selectedCommitment ? POOL_INFO[selectedCommitment.pool_type as PoolType].name : ""}</p></div><div className="col-span-2"><p className="text-xs text-zinc-500">Destination</p><p className="text-sm">{useRelayer ? "Fresh address (unlinkable)" : "Your wallet"}</p></div></div>
            </div>
            <button onClick={handleWithdraw} className="w-full px-6 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold text-white flex items-center justify-center gap-2"><ArrowUpFromLine className="w-5 h-5" />Sign & Withdraw</button>
            <p className="text-xs text-zinc-500 text-center">If you see &quot;Unknown merkle root&quot;, wait 30–60s after deposit for root sync, or ensure backend has <code className="text-zinc-400">FULL_PRIVACY_MERKLE_TREE_*</code> set (see docs Wallet Troubleshooting).</p>
          </motion.div>
        )}
        {mode === "disclose" && (
          <motion.div key="disclose" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
            <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/30"><div className="flex items-start gap-3"><FileCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" /><div className="text-sm"><p className="text-emerald-300 font-medium mb-1">Selective Disclosure</p><p className="text-zinc-400">Prove properties about your position WITHOUT revealing your balance.</p></div></div></div>
            <div><label className="block text-sm font-medium text-zinc-300 mb-2">Select Commitment</label><select value={selectedCommitment?.commitment || ""} onChange={(e) => { const c = savedCommitments.find((c) => c.commitment === e.target.value); setSelectedCommitment(c || null); }} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white"><option value="">Select a commitment...</option>{savedCommitments.map((c, i) => (<option key={i} value={c.commitment}>{c.commitment.slice(0, 10)}... ({amountToEth(c.amount).toFixed(2)} ETH, {POOL_INFO[c.pool_type as PoolType].name})</option>))}</select></div>
            <div><label className="block text-sm font-medium text-zinc-300 mb-2">Disclosure Type</label><div className="flex gap-2"><button onClick={() => setDisclosureType("balance")} className={`flex-1 px-4 py-2 rounded-lg border ${disclosureType === "balance" ? "border-violet-500 bg-violet-950/30" : "border-zinc-700 hover:border-zinc-600"}`}>Balance Above</button><button onClick={() => setDisclosureType("pool")} className={`flex-1 px-4 py-2 rounded-lg border ${disclosureType === "pool" ? "border-violet-500 bg-violet-950/30" : "border-zinc-700 hover:border-zinc-600"}`}>Pool Membership</button></div></div>
            {disclosureType === "balance" && (<div><label className="block text-sm font-medium text-zinc-300 mb-2">Threshold (ETH)</label><input type="text" value={disclosureThreshold} onChange={(e) => setDisclosureThreshold(e.target.value)} placeholder="1.0" className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white" /></div>)}
            <button onClick={handleSelectiveDisclosure} disabled={!selectedCommitment || (disclosureType === "balance" && !disclosureThreshold)} className="w-full px-6 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-semibold text-white">Generate Disclosure Proof</button>
            {disclosureResult && (<div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-700"><div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-400" /><p className="text-emerald-300 font-medium">{disclosureResult}</p></div></div>)}
          </motion.div>
        )}
        {step === 4 && txHash && (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-6">
            <div className="flex justify-center"><motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-20 h-20 rounded-full bg-violet-500/20 flex items-center justify-center"><CheckCircle2 className="w-10 h-10 text-violet-400" /></motion.div></div>
            <div><p className="text-xl font-semibold text-violet-400 mb-2">Transaction Complete</p><p className="text-sm text-zinc-400">Your position is now fully private</p></div>
            <div className="flex flex-wrap justify-center gap-3">
              <a href={`${EXPLORER_STARKSCAN}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 text-sm font-medium inline-flex items-center gap-1">View on Starkscan</a>
              <a href={`${EXPLORER_VOYAGER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 text-sm font-medium inline-flex items-center gap-1">View on Voyager</a>
            </div>
            <button onClick={resetFlow} className="px-6 py-3 border border-zinc-600 hover:bg-zinc-800 rounded-lg">New Transaction</button>
          </motion.div>
        )}
        {step === 2 && (<motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><ProofVisualizer state="generating" progress={50} step="Generating ZK proof..." /></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
