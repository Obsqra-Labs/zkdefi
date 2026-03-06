"use client";
import { CheckCircle, AlertTriangle, Clock, FileCheck } from "lucide-react";
import { motion } from "framer-motion";

interface ProofCardProps {
  title: string;
  description: string;
  status: "complete" | "pending" | "available";
  completedAt?: string;
  icon: React.ReactNode;
  onGenerate?: () => void;
  perks?: string[];
}

const STATUS_CONFIG = {
  complete: { bg: "emerald-500/10", border: "emerald-500/30", text: "emerald-400", icon: CheckCircle },
  pending: { bg: "amber-500/10", border: "amber-500/30", text: "amber-400", icon: Clock },
  available: { bg: "zinc-800/50", border: "zinc-700", text: "zinc-400", icon: FileCheck },
} as const;

export function ProofCard({ title, description, status, completedAt, icon, onGenerate, perks }: ProofCardProps) {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  return (
    <motion.div
      className={`bg-${config.bg} border border-${config.border} rounded-xl p-5 space-y-3`}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-${config.text}/10 border border-${config.border} flex items-center justify-center`}>
            {icon}
          </div>
          <div>
            <h4 className="font-semibold text-zinc-200">{title}</h4>
            <p className="text-xs text-zinc-500">{description}</p>
          </div>
        </div>
        <StatusIcon className={`w-5 h-5 text-${config.text}`} />
      </div>

      {/* Perks */}
      {perks && perks.length > 0 && (
        <div className="pt-3 border-t border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1.5">Unlocks:</div>
          <ul className="space-y-1">
            {perks.map((perk, idx) => (
              <li key={idx} className="text-xs text-zinc-400 flex items-start gap-1.5">
                <span className="text-emerald-500">✓</span>
                {perk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action */}
      {status === "available" && onGenerate && (
        <button
          onClick={onGenerate}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          Generate Proof
        </button>
      )}

      {status === "complete" && completedAt && (
        <div className="text-xs text-zinc-500">
          Verified: {new Date(completedAt).toLocaleDateString()}
        </div>
      )}
    </motion.div>
  );
}
