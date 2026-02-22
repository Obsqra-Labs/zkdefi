import { Suspense } from "react";

export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex flex-col items-center justify-center gap-4"
          style={{ background: "#09090b", color: "#f4f4f5" }}
        >
          <div
            className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <p className="text-sm text-zinc-400">Loading…</p>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
