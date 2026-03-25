"use client";

import {
  ShieldCheck,
  Bot,
  Fingerprint,
  Vote,
  FileCheck,
  Globe,
  Check,
  Minus,
  Link2,
  Key,
} from "lucide-react";
import type { BuilderProfile } from "@/lib/receiptos/types";

type Provenance = "zkdefi" | "portable";

interface FacetDef {
  key: keyof BuilderProfile;
  label: string;
  icon: typeof ShieldCheck;
  provenance: Provenance;
  protocol: string;
}

const FACETS: FacetDef[] = [
  {
    key: "proofs",
    label: "ZK Proofs",
    icon: ShieldCheck,
    provenance: "zkdefi",
    protocol: "zkFICO Circuit Pack",
  },
  {
    key: "agents",
    label: "Agents",
    icon: Bot,
    provenance: "zkdefi",
    protocol: "Agent Builder",
  },
  {
    key: "identity",
    label: "Identity",
    icon: Fingerprint,
    provenance: "portable",
    protocol: "Portable Identity v3",
  },
  {
    key: "governance",
    label: "Governance",
    icon: Vote,
    provenance: "zkdefi",
    protocol: "DAO Voting Power",
  },
  {
    key: "receipts",
    label: "Receipts",
    icon: FileCheck,
    provenance: "zkdefi",
    protocol: "Mission Control",
  },
];

export function BuilderProfileCard({ builder }: { builder: BuilderProfile }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-300">Builder Profile</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FACETS.map((facet) => (
          <FacetCard
            key={facet.key}
            facet={facet}
            data={builder[facet.key]}
          />
        ))}
      </div>
    </div>
  );
}

function FacetCard({ facet, data }: { facet: FacetDef; data: unknown }) {
  const Icon = facet.icon;
  const isZkdefi = facet.provenance === "zkdefi";
  const { headline, details } = renderFacet(facet.key, data);
  const active = headline !== "—";

  return (
    <div
      className={`rounded-xl border px-4 py-3 transition-colors ${
        active
          ? "border-zinc-700/60 bg-zinc-900/60"
          : "border-zinc-800/40 bg-zinc-900/30 opacity-60"
      }`}
    >
      {/* Row 1: icon + label */}
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 flex-shrink-0 ${active ? "text-zinc-300" : "text-zinc-600"}`} />
        <span className={`text-xs font-semibold ${active ? "text-zinc-200" : "text-zinc-500"}`}>
          {facet.label}
        </span>
      </div>

      {/* Row 2: headline metric */}
      <p className={`mt-1.5 text-lg font-bold ${active ? "text-zinc-100" : "text-zinc-600"}`}>
        {headline}
      </p>

      {/* Row 3: detail chips */}
      {details.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {details.map((d, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[8px] font-medium ${d.color}`}
            >
              {d.icon && <d.icon className="h-2 w-2" />}
              {d.text}
            </span>
          ))}
        </div>
      )}

      {/* Row 4: provenance + protocol */}
      <div className="mt-2 flex items-center gap-1.5">
        {isZkdefi ? (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-px text-[8px] font-medium text-cyan-400">
            <Fingerprint className="h-2 w-2" />
            native
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-px text-[8px] font-medium text-violet-400">
            <Globe className="h-2 w-2" />
            portable
          </span>
        )}
        <span className="truncate text-[9px] text-zinc-500">{facet.protocol}</span>
      </div>
    </div>
  );
}

/* ── Render helpers per facet ─────────────────────────────────────── */

interface Chip {
  text: string;
  color: string;
  icon?: typeof Check;
}

function renderFacet(
  key: string,
  data: unknown,
): { headline: string; details: Chip[] } {
  switch (key) {
    case "proofs": {
      const p = data as BuilderProfile["proofs"];
      if (p.total === 0) return { headline: "—", details: [] };
      const chips: Chip[] = [];
      if (p.completed > 0)
        chips.push({
          text: `${p.completed}/${p.total} complete`,
          color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
          icon: Check,
        });
      if (p.onChainVerified > 0)
        chips.push({
          text: `${p.onChainVerified} on-chain`,
          color: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
          icon: ShieldCheck,
        });
      // Show individual proof types
      p.types
        .filter((t) => t.status === "complete")
        .forEach((t) =>
          chips.push({
            text: t.name.replace(/_/g, " "),
            color: t.onChain
              ? "border-cyan-500/20 bg-cyan-500/5 text-cyan-500"
              : "border-zinc-700 bg-zinc-800 text-zinc-400",
          }),
        );
      return { headline: `${p.completed} proofs`, details: chips };
    }

    case "agents": {
      const a = data as BuilderProfile["agents"];
      if (a.count === 0) return { headline: "—", details: [] };
      const chips: Chip[] = a.agents.map((ag) => ({
        text: `${ag.name} (${ag.skills} skills)`,
        color: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        icon: Bot,
      }));
      return { headline: `${a.count} agent${a.count > 1 ? "s" : ""}`, details: chips };
    }

    case "identity": {
      const id = data as BuilderProfile["identity"];
      if (id.links === 0 && !id.hasCommitment) return { headline: "—", details: [] };
      const chips: Chip[] = [];
      if (id.hasCommitment)
        chips.push({
          text: "commitment",
          color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
          icon: Fingerprint,
        });
      if (id.verified > 0)
        chips.push({
          text: `${id.verified} verified`,
          color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
          icon: Check,
        });
      if (id.links > id.verified)
        chips.push({
          text: `${id.links - id.verified} unverified`,
          color: "border-zinc-700 bg-zinc-800 text-zinc-400",
          icon: Minus,
        });
      if (id.sessions > 0)
        chips.push({
          text: `${id.sessions} session${id.sessions > 1 ? "s" : ""}`,
          color: "border-blue-500/30 bg-blue-500/10 text-blue-400",
          icon: Key,
        });
      return {
        headline: `${id.links} link${id.links !== 1 ? "s" : ""}`,
        details: chips,
      };
    }

    case "governance": {
      const g = data as BuilderProfile["governance"];
      if (g.votingPower === 0) return { headline: "—", details: [] };
      const chips: Chip[] = [
        {
          text: `$${g.capitalUsd.toFixed(0)} capital`,
          color: "border-zinc-700 bg-zinc-800 text-zinc-400",
        },
        {
          text: `${g.tierMultiplier}x tier`,
          color: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        },
      ];
      return { headline: `${g.votingPower.toFixed(2)} VP`, details: chips };
    }

    case "receipts": {
      const r = data as BuilderProfile["receipts"];
      if (r.total === 0) return { headline: "—", details: [] };
      return {
        headline: `${r.total} receipt${r.total > 1 ? "s" : ""}`,
        details: [
          {
            text: "audit trail",
            color: "border-zinc-700 bg-zinc-800 text-zinc-400",
            icon: FileCheck,
          },
        ],
      };
    }

    default:
      return { headline: "—", details: [] };
  }
}
