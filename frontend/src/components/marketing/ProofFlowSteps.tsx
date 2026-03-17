"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    num: "01",
    label: "Strategy",
    desc: "Your private conditions compile into a provable circuit",
  },
  {
    num: "02",
    label: "Proof",
    desc: "EZKL generates a Halo2 SNARK — conditions met, nothing revealed",
  },
  {
    num: "03",
    label: "Verify",
    desc: "Garaga checks the proof on-chain using pairing math",
  },
  {
    num: "04",
    label: "Execute",
    desc: "Capital moves only if both proof systems agree",
  },
  {
    num: "05",
    label: "Receipt",
    desc: "On-chain evidence feeds back into your reputation score",
  },
] as const;

/**
 * ProofFlowSteps — 5-step pipeline that progressively lights up
 * as each card scrolls into the viewport.
 */
export function ProofFlowSteps() {
  const [lit, setLit] = useState<boolean[]>(Array(5).fill(false));
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    refs.current.forEach((el, i) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            // Stagger: base 200ms + 250ms per step
            setTimeout(() => {
              setLit((prev) => {
                const next = [...prev];
                next[i] = true;
                return next;
              });
            }, 200 + i * 250);
            obs.unobserve(el);
          }
        },
        { threshold: 0.2, rootMargin: "0px 0px -40px 0px" }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  return (
    <div className="mt-16 grid grid-cols-1 gap-0 sm:grid-cols-5">
      {STEPS.map((step, i) => {
        const isLit = lit[i];
        const isExecute = i >= 3; // steps 04 & 05 get emerald accent

        return (
          <div
            key={step.num}
            ref={(el) => { refs.current[i] = el; }}
            className="relative flex flex-col"
          >
            {/* Connector dot on the top border */}
            {i > 0 && (
              <div
                className={`absolute -top-[5px] left-6 hidden h-2.5 w-2.5 rounded-full ring-4 ring-zinc-950 sm:block transition-colors duration-700 ${
                  isLit
                    ? isExecute
                      ? "bg-emerald-500"
                      : "bg-zinc-400"
                    : "bg-zinc-800"
                }`}
              />
            )}

            {/* Progress fill on top border */}
            <div className="relative">
              <div className={`border-t-2 ${isLit ? (isExecute ? "border-emerald-500/50" : "border-zinc-600") : "border-zinc-800/50"} transition-colors duration-700`} />
              {/* Animated fill overlay */}
              <div
                className={`absolute top-0 left-0 h-[2px] transition-all duration-700 ease-out ${
                  isExecute ? "bg-emerald-500" : "bg-zinc-500"
                }`}
                style={{ width: isLit ? "100%" : "0%" }}
              />
            </div>

            <div className="px-4 pb-6 pt-5 sm:px-5">
              <span
                className={`font-serif text-3xl font-bold tracking-tight sm:text-4xl transition-colors duration-700 ${
                  isLit ? (isExecute ? "text-emerald-500/40" : "text-zinc-600") : "text-zinc-800/30"
                }`}
              >
                {step.num}
              </span>
              <h3
                className={`mt-2 text-sm font-bold uppercase tracking-wider transition-colors duration-700 ${
                  isLit
                    ? isExecute
                      ? "text-emerald-400"
                      : "text-zinc-300"
                    : "text-zinc-700"
                }`}
              >
                {step.label}
              </h3>
              <p
                className={`mt-2 font-mono text-[11px] leading-relaxed transition-colors duration-700 ${
                  isLit ? "text-zinc-500" : "text-zinc-800"
                }`}
              >
                {step.desc}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
