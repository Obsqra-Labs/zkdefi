"use client";

interface ExplainabilityPanelProps {
  creditLine: unknown;
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) {
    return "{}";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ExplainabilityPanel({ creditLine }: ExplainabilityPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="text-sm font-semibold text-zinc-100">Explainability</h4>
      <p className="mt-2 text-sm text-zinc-400">
        Explainability shim renders current credit-line payload for downstream feature compatibility.
      </p>
      <pre className="mt-3 max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-200">
        {pretty(creditLine)}
      </pre>
    </section>
  );
}
