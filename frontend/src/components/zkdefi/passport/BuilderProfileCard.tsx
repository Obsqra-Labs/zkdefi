"use client";

import {
  ArrowUpRight,
  ArrowDownToLine,
  ArrowLeftRight,
  Landmark,
  FileCode2,
  Receipt,
  CheckCircle2,
  Circle,
} from "lucide-react";
import type { ReputationProfile, BuilderActivity } from "@/lib/receiptos/types";

/* ── Verified protocol sources (COVERAGE_TABLE) ───────────────────── */

const SOURCES = {
  rpc: "Starknet RPC · getNonce",
  starkgate: "StarkGate · 0x0733…9d82",
  ekubo: "Ekubo Core · 0x0280…e0f2",
  vesu: "Vesu Core · 0x00a8…a87e",
  deploys: "Starknet tx-type scanner",
  registry: "ReceiptRegistry · 0x0544…bdff",
} as const;

/* ── Row model ────────────────────────────────────────────────────── */

interface Row {
  id: string;
  label: string;
  icon: typeof ArrowUpRight;
  value: string;
  detail: string;
  attestation: "attested" | "indexed" | "on-chain" | "pending";
  source: string;
  active: boolean;
}

function buildRows(profile: ReputationProfile, activity: BuilderActivity): Row[] {
  const gates = profile.gates ?? {};
  const verified = activity.receipts.filter((r) => r.gateStatus === "pass").length;

  return [
    {
      id: "transactions",
      label: "Transactions",
      icon: ArrowUpRight,
      value: profile.transaction_count > 0 ? `${profile.transaction_count} txns` : "—",
      detail:
        profile.transaction_count > 0
          ? `${profile.successful_txns} successful · ${profile.failed_txns} failed · ${profile.total_volume_eth.toFixed(2)} ETH vol`
          : "no outbound transactions detected",
      attestation: profile.transaction_count > 0 ? "attested" : "pending",
      source: SOURCES.rpc,
      active: profile.transaction_count > 0,
    },
    {
      id: "bridge",
      label: "Bridge Deposits",
      icon: ArrowDownToLine,
      value: profile.collateral_eth > 0 ? `${profile.collateral_eth} ETH` : "—",
      detail: gates.collateral_deposit
        ? "collateral gate open · deposit events indexed"
        : "no bridge deposits detected",
      attestation: profile.collateral_eth > 0 ? "indexed" : "pending",
      source: SOURCES.starkgate,
      active: profile.collateral_eth > 0,
    },
    {
      id: "dex",
      label: "DEX Swaps",
      icon: ArrowLeftRight,
      value: gates.swap ? "active" : "—",
      detail: gates.swap
        ? "swap events detected via Ekubo indexer"
        : "no swap events detected",
      attestation: gates.swap ? "indexed" : "pending",
      source: SOURCES.ekubo,
      active: !!gates.swap,
    },
    {
      id: "lending",
      label: "Lending",
      icon: Landmark,
      value: gates.lending ? "active" : "—",
      detail: gates.lending
        ? "supply events detected via Vesu indexer"
        : "no lending activity detected",
      attestation: gates.lending ? "indexed" : "pending",
      source: SOURCES.vesu,
      active: !!gates.lending,
    },
    {
      id: "deploys",
      label: "Contract Deploys",
      icon: FileCode2,
      value: "—",
      detail: "deploy transaction indexing not yet live",
      attestation: "pending",
      source: SOURCES.deploys,
      active: false,
    },
    {
      id: "receipts",
      label: "Attested Receipts",
      icon: Receipt,
      value: activity.totalReceipts > 0 ? `${activity.totalReceipts} total` : "—",
      detail:
        activity.totalReceipts > 0
          ? `${verified} verified on-chain via ReceiptRegistry`
          : "no receipts issued yet",
      attestation: activity.totalReceipts > 0 ? "on-chain" : "pending",
      source: SOURCES.registry,
      active: activity.totalReceipts > 0,
    },
  ];
}

/* ── Attestation badge styles ─────────────────────────────────────── */

const ATT_STYLE: Record<string, { label: string; color: string }> = {
  attested: { label: "attested", color: "text-emerald-500" },
  indexed: { label: "indexed", color: "text-emerald-500" },
  "on-chain": { label: "on-chain", color: "text-cyan-400" },
  pending: { label: "pending", color: "text-zinc-600" },
};

/* ── Component ────────────────────────────────────────────────────── */

export function BuilderActivityCard({
  profile,
  activity,
}: {
  profile: ReputationProfile;
  activity: BuilderActivity;
}) {
  const rows = buildRows(profile, activity);
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-300">On-Chain Activity</h2>
        <p className="mt-0.5 text-[10px] text-zinc-600">
          {activeCount}/{rows.length} categories active · indexed from Starknet · backed by ReceiptOS
        </p>
      </div>

      <div className="divide-y divide-zinc-800/60 rounded-xl border border-zinc-800/60 bg-zinc-900/40">
        {rows.map((row) => {
          const Icon = row.icon;
          const att = ATT_STYLE[row.attestation];
          return (
            <div
              key={row.id}
              className={`px-4 py-3 transition-all ${
                row.active ? "hover:bg-zinc-900/80" : "opacity-50"
              }`}
            >
              {/* Line 1: icon + label + value */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      row.active ? "text-zinc-300" : "text-zinc-600"
                    }`}
                  />
                  <span
                    className={`text-xs font-semibold ${
                      row.active ? "text-zinc-200" : "text-zinc-500"
                    }`}
                  >
                    {row.label}
                  </span>
                </div>
                <span
                  className={`font-mono text-xs font-bold ${
                    row.active ? "text-zinc-100" : "text-zinc-600"
                  }`}
                >
                  {row.value}
                </span>
              </div>

              {/* Line 2: detail */}
              <p className="ml-[22px] mt-1 text-[10px] text-zinc-500">{row.detail}</p>

              {/* Line 3: attestation + source */}
              <div className="ml-[22px] mt-1 flex items-center gap-1.5">
                {row.attestation !== "pending" ? (
                  <CheckCircle2 className={`h-2.5 w-2.5 ${att.color}`} />
                ) : (
                  <Circle className="h-2.5 w-2.5 text-zinc-700" />
                )}
                <span className="text-[9px] text-zinc-600">
                  {att.label} · {row.source}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
