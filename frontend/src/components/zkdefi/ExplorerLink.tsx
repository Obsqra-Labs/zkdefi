"use client";

import { ExternalLink } from "lucide-react";
import { voyagerTxUrl, sepoliaVoyagerTxUrl, sepoliaVoyagerContractUrl } from "@/lib/explorer";

interface ExplorerLinkProps {
  /** Transaction hash (for type="tx") */
  txHash?: string;
  /** Contract address (for type="contract") */
  contractAddress?: string;
  /** Chain id for tx links (e.g. Sepolia vs mainnet). Omit for Sepolia. */
  chainId?: string | null;
  type: "tx" | "contract";
  children?: React.ReactNode;
  className?: string;
}

export function ExplorerLink({ txHash, contractAddress, chainId, type, children, className = "" }: ExplorerLinkProps) {
  const href =
    type === "tx" && txHash
      ? (chainId != null ? voyagerTxUrl(txHash, chainId) : sepoliaVoyagerTxUrl(txHash))
      : type === "contract" && contractAddress
        ? sepoliaVoyagerContractUrl(contractAddress)
        : undefined;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-cyan-400 hover:underline ${className}`}
    >
      {children ?? (
        <>
          <ExternalLink className="w-3 h-3" />
          View on Explorer
        </>
      )}
    </a>
  );
}
