"use client";

import { ExternalLink } from "lucide-react";
import { sepoliaStarkscanTxUrl, sepoliaStarkscanContractUrl } from "@/lib/explorer";

interface ExplorerLinkProps {
  /** Transaction hash (for type="tx") */
  txHash?: string;
  /** Contract address (for type="contract") */
  contractAddress?: string;
  type: "tx" | "contract";
  children?: React.ReactNode;
  className?: string;
}

export function ExplorerLink({ txHash, contractAddress, type, children, className = "" }: ExplorerLinkProps) {
  const href =
    type === "tx" && txHash
      ? sepoliaStarkscanTxUrl(txHash)
      : type === "contract" && contractAddress
        ? sepoliaStarkscanContractUrl(contractAddress)
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
          View on Starkscan
        </>
      )}
    </a>
  );
}
