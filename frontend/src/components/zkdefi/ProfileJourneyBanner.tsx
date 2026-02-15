"use client";

import Link from "next/link";
import { Shield, Check, ChevronRight } from "lucide-react";

interface ProfileJourneyBannerProps {
  hasOnboarded: boolean;
  hasPassport: boolean;
  canUseRelayer: boolean;
}

export function ProfileJourneyBanner({ hasOnboarded, hasPassport, canUseRelayer }: ProfileJourneyBannerProps) {
  const steps = [
    { done: true, label: "Connect" },
    { done: hasOnboarded, label: "Onboard" },
    { done: hasPassport, label: "Build passport" },
    { done: canUseRelayer, label: "Use protocol" },
  ];

  const nextStep = steps.find((s) => !s.done);
  const allDone = steps.every((s) => s.done);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {steps.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-sm">
            {s.done ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check className="w-4 h-4" /> {s.label}
              </span>
            ) : (
              <span className="text-zinc-500">{s.label}</span>
            )}
            {i < steps.length - 1 && <ChevronRight className="w-4 h-4 text-zinc-600" />}
          </span>
        ))}
      </div>
      {!allDone && nextStep && (
        <div className="mt-3 flex items-center gap-2">
          {nextStep.label === "Onboard" && (
            <Link
              href="/agent?tab=onboarding"
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium text-sm text-white transition-colors"
            >
              <Shield className="w-4 h-4" /> Complete onboarding
            </Link>
          )}
          {nextStep.label === "Build passport" && (
            <Link
              href="/agent"
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium text-sm text-white transition-colors"
            >
              <Shield className="w-4 h-4" /> Run proofs
            </Link>
          )}
          {nextStep.label === "Use protocol" && (
            <p className="text-sm text-zinc-400">
              Complete more transactions to unlock relayer (Standard tier).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
