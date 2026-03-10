"use client";

interface TrustFlowProgressSummaryProps {
  complete: number;
  total: number;
  ready: boolean;
  progressLabel?: string;
  readinessLabel?: string;
}

export function TrustFlowProgressSummary({
  complete,
  total,
  ready,
  progressLabel = "trust progress",
  readinessLabel = "ready for capital os",
}: TrustFlowProgressSummaryProps) {
  return (
    <div className="mb-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
      {progressLabel}: {complete}/{total}
      <span className="mx-2">|</span>
      {readinessLabel}: {ready ? "yes" : "no"}
    </div>
  );
}
