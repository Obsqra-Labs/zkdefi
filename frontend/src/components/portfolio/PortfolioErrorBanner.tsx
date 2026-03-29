"use client";

import { AlertTriangle } from "lucide-react";

type Props = {
  message: string;
};

export function PortfolioErrorBanner({ message }: Props) {
  return (
    <section className="rounded-[24px] border border-amber-500/20 bg-amber-500/10 px-5 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-zinc-950/70 text-amber-200">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200/80">Needs attention</p>
          <p className="mt-1 text-sm font-medium text-amber-50">The desk needs a retry before you keep going.</p>
          <p className="mt-2 text-sm text-amber-100/85">{message}</p>
        </div>
      </div>
    </section>
  );
}
