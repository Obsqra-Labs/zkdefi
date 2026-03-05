"use client";

import React from "react";
import { motion } from "framer-motion";
import { Shield, ExternalLink, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { voyagerTxUrl, voyagerBaseUrl } from "@/lib/explorer";

interface ZkGraphProvenance {
  fact_hash: string;
  block_range: string;
  merkle_root: string;
  source_count: number;
  verified_on_chain?: boolean;
}

interface ProvenanceDisplayProps {
  provenance: ZkGraphProvenance | null;
  className?: string;
  variant?: "compact" | "full";
}

/**
 * ProvenanceDisplay: Shows zkRAG attested intelligence provenance
 * 
 * Displays cryptographic proof trail: decision → fact_hash → merkle_root → blocks
 * Uses Voyager for all explorer links (never Starkscan)
 */
export function ProvenanceDisplay({ 
  provenance, 
  className = "",
  variant = "full"
}: ProvenanceDisplayProps) {
  if (!provenance) {
    return (
      <div className={`rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2.5 ${className}`}>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Info className="w-3.5 h-3.5" />
          <span>Local data only • No attested intelligence available</span>
        </div>
      </div>
    );
  }

  const { fact_hash, block_range, merkle_root, source_count, verified_on_chain } = provenance;
  
  // Extract block numbers for Voyager links
  const blocks = block_range.split("-");
  const startBlock = blocks[0];
  const endBlock = blocks[1] || startBlock;
  
  // Voyager block URL
  const blockUrl = `${voyagerBaseUrl()}/block/${endBlock}`;
  
  if (variant === "compact") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 ${className}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-xs text-emerald-300/90 truncate">
              Attested: blocks {block_range}
            </span>
          </div>
          {verified_on_chain && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 p-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          <h4 className="text-sm font-medium text-emerald-300">
            Attested Intelligence
          </h4>
        </div>
        {verified_on_chain ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Verified</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Pending</span>
          </div>
        )}
      </div>

      {/* Provenance details */}
      <div className="space-y-2 text-xs">
        {/* Fact hash */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-zinc-400 min-w-[80px]">Fact Hash:</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <code className="text-emerald-300 font-mono text-[10px] truncate">
              {fact_hash.slice(0, 16)}...{fact_hash.slice(-12)}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(fact_hash);
              }}
              className="text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
              title="Copy fact hash"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Block range */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Block Range:</span>
          <a
            href={blockUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-emerald-300 hover:text-emerald-200 transition-colors"
          >
            <span className="font-mono text-[11px]">{block_range}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Merkle root */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-zinc-400 min-w-[80px]">Merkle Root:</span>
          <code className="text-zinc-300 font-mono text-[10px] truncate">
            {merkle_root.slice(0, 16)}...{merkle_root.slice(-8)}
          </code>
        </div>

        {/* Source count */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Sources:</span>
          <span className="text-emerald-300 font-medium">{source_count}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-emerald-500/10 text-[10px] text-zinc-500">
        <p className="leading-relaxed">
          This data comes from obsqra&apos;s proven-index. The fact hash is registered on-chain
          via the Integrity Verifier, ensuring all intelligence is cryptographically attested.
        </p>
      </div>
    </motion.div>
  );
}

/**
 * InlineProvenance: Compact single-line provenance badge
 */
export function InlineProvenance({ provenance }: { provenance: ZkGraphProvenance | null }) {
  if (!provenance) return null;

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">
      <Shield className="w-2.5 h-2.5" />
      <span>Attested: blocks {provenance.block_range}</span>
      {provenance.verified_on_chain && (
        <CheckCircle2 className="w-2.5 h-2.5" />
      )}
    </div>
  );
}
