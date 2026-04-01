"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Shield, X } from "lucide-react";

import { receiptVoyagerTxUrl } from "@/lib/explorer";
import type { PortableReceiptData, WorkflowMode } from "./types";

type Props = {
  receipt: PortableReceiptData;
  executionTxHash: string | null;
  workflowMode: WorkflowMode;
  passedGateCount: number;
  totalConstraintCount: number;
};

function VaultRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="text-right text-sm text-zinc-200 break-all">{children}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function VerifyCheck({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
          passed
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {passed ? "✓" : "–"}
      </span>
      <span className={`text-sm ${passed ? "text-emerald-200" : "text-zinc-500"}`}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Receipt detail modal                                               */
/* ------------------------------------------------------------------ */
function ReceiptVaultModal({
  receipt,
  executionTxHash,
  workflowMode,
  passedGateCount,
  totalConstraintCount,
  onClose,
}: Props & { onClose: () => void }) {
  const cid = receipt.cid;
  const registryId = receipt.registry_receipt_id;
  const archiveTx = receipt.archive_tx_hash;
  const gatewayUrl = receipt.gateway_url;
  const ipfsGatewayUrl = receipt.ipfs_gateway_url;
  const ipfsUri = receipt.ipfs_uri;

  const modeLabel =
    workflowMode === "automated"
      ? "Proof-gated execution"
      : workflowMode === "assisted"
        ? "Assisted execution"
        : "Manual execution";

  const voyagerTx = executionTxHash
    ? receiptVoyagerTxUrl(executionTxHash, receipt.registry_contract_address)
    : null;
  const voyagerArchive = archiveTx
    ? receiptVoyagerTxUrl(archiveTx, receipt.archive_contract_address)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl rounded-[24px] border border-emerald-500/25 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="space-y-4">
          {/* Header */}
          <div className="pr-8">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-400" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400">Receipt Vault</p>
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {registryId ? `Receipt #${registryId}` : "Receipt archived"}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {modeLabel} · Anchored on Starknet · Stored on IPFS
            </p>
          </div>

          {/* Detail grid */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* On-chain receipt */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">On-chain receipt</p>
              <div className="mt-3 space-y-2">
                {executionTxHash ? (
                  <VaultRow label="Tx">
                    <span className="font-mono text-xs">{executionTxHash.slice(0, 10)}…{executionTxHash.slice(-6)}</span>
                    <CopyButton text={executionTxHash} />
                    {voyagerTx ? (
                      <a href={voyagerTx} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-cyan-300 hover:text-cyan-200">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </VaultRow>
                ) : null}
                {registryId ? (
                  <VaultRow label="Receipt ID">
                    <span className="font-mono text-xs">{registryId}</span>
                    <CopyButton text={registryId} />
                  </VaultRow>
                ) : null}
                {archiveTx ? (
                  <VaultRow label="Anchor tx">
                    <span className="font-mono text-xs">{archiveTx.slice(0, 10)}…{archiveTx.slice(-6)}</span>
                    {voyagerArchive ? (
                      <a href={voyagerArchive} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-cyan-300 hover:text-cyan-200">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </VaultRow>
                ) : null}
              </div>
            </div>

            {/* Decentralized archive */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Decentralized archive</p>
              <div className="mt-3 space-y-2">
                {cid ? (
                  <VaultRow label="CID">
                    <span className="font-mono text-xs">{cid.slice(0, 12)}…{cid.slice(-6)}</span>
                    <CopyButton text={cid} />
                  </VaultRow>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {gatewayUrl ? (
                  <a
                    href={gatewayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-cyan-100 hover:border-cyan-400/50 hover:bg-cyan-500/20"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View bundle
                  </a>
                ) : null}
                {(ipfsGatewayUrl || ipfsUri) ? (
                  <a
                    href={ipfsGatewayUrl || `https://w3s.link/ipfs/${cid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                  >
                    <ExternalLink className="h-3 w-3" />
                    IPFS
                  </a>
                ) : null}
                <a
                  href="/archive"
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                >
                  Archive
                </a>
                {registryId ? (
                  <a
                    href={`/verify?id=${registryId}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                  >
                    Verify
                  </a>
                ) : null}
              </div>
            </div>

            {/* Verification */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Verification</p>
              <div className="mt-3 space-y-2.5">
                <VerifyCheck label="CID anchored on-chain" passed={!!archiveTx} />
                <VerifyCheck label="Bundle stored on IPFS" passed={!!cid} />
                <VerifyCheck
                  label={`Policy constraints: ${passedGateCount}/${totalConstraintCount}`}
                  passed={passedGateCount === totalConstraintCount && totalConstraintCount > 0}
                />
                <VerifyCheck label="Receipt registered" passed={!!registryId} />
              </div>
            </div>
          </div>

          {/* Bundle reference */}
          {cid ? (
            <details className="rounded-2xl border border-zinc-800 bg-zinc-950/80">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-300">Bundle reference</summary>
              <div className="space-y-1 px-4 pb-4 font-mono text-xs text-zinc-400">
                <p className="break-all">CID: {cid}</p>
                {ipfsUri ? <p className="break-all">URI: {ipfsUri}</p> : null}
                {gatewayUrl ? <p className="break-all">Gateway: {gatewayUrl}</p> : null}
                {registryId ? <p>Registry ID: {registryId}</p> : null}
                {archiveTx ? <p className="break-all">Archive tx: {archiveTx}</p> : null}
                {executionTxHash ? <p className="break-all">Execution tx: {executionTxHash}</p> : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Compact bar (inline) + modal on click                              */
/* ------------------------------------------------------------------ */
export function ReceiptVaultHero({
  receipt,
  executionTxHash,
  workflowMode,
  passedGateCount,
  totalConstraintCount,
}: Props) {
  const [showModal, setShowModal] = useState(false);
  const cid = receipt.cid;
  const registryId = receipt.registry_receipt_id;
  const archiveTx = receipt.archive_tx_hash;
  const gatewayUrl = receipt.gateway_url;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="group w-full rounded-[20px] border border-emerald-500/25 bg-[radial-gradient(circle_at_left,rgba(16,185,129,0.12),rgba(9,9,11,0.94)_60%)] px-4 py-3 text-left transition hover:border-emerald-500/40 hover:shadow-[0_8px_30px_rgba(16,185,129,0.08)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Shield className="h-4 w-4 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {registryId ? `Receipt #${registryId}` : "Receipt archived"}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                {cid ? <span className="font-mono">{cid.slice(0, 10)}…</span> : null}
                {archiveTx ? (
                  <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-1.5 py-0.5 text-[9px] uppercase text-yellow-300">gold</span>
                ) : (
                  <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase text-zinc-500">bronze</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {gatewayUrl ? (
              <a
                href={gatewayUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20"
              >
                <ExternalLink className="h-3 w-3" />
                Bundle
              </a>
            ) : null}
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-emerald-200">
              {passedGateCount}/{totalConstraintCount} checks
            </span>
            <ChevronDown className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-y-0.5" />
          </div>
        </div>
      </button>

      {showModal ? (
        <ReceiptVaultModal
          receipt={receipt}
          executionTxHash={executionTxHash}
          workflowMode={workflowMode}
          passedGateCount={passedGateCount}
          totalConstraintCount={totalConstraintCount}
          onClose={() => setShowModal(false)}
        />
      ) : null}
    </>
  );
}
