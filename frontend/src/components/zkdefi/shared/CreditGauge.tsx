"use client";

interface CreditGaugeProps {
  score: number;
  maxScore?: number;
  size?: "sm" | "md";
}

export function CreditGauge({ score, maxScore = 850, size = "md" }: CreditGaugeProps) {
  const pct = Math.min(score / maxScore, 1);
  const dims = size === "sm" ? { w: 64, h: 64, stroke: 6, text: "text-sm" } : { w: 96, h: 96, stroke: 8, text: "text-lg" };
  const r = (dims.w - dims.stroke) / 2;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.75;
  const filled = arc * pct;
  const color = score >= 700 ? "#34d399" : score >= 550 ? "#fbbf24" : "#f87171";

  return (
    <div className="relative flex items-center justify-center" style={{ width: dims.w, height: dims.h }}>
      <svg width={dims.w} height={dims.h} className="-rotate-[135deg]">
        <circle cx={dims.w / 2} cy={dims.h / 2} r={r} fill="none" stroke="#27272a" strokeWidth={dims.stroke} strokeDasharray={`${arc} ${circ}`} strokeLinecap="round" />
        <circle cx={dims.w / 2} cy={dims.h / 2} r={r} fill="none" stroke={color} strokeWidth={dims.stroke} strokeDasharray={`${filled} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className={`absolute ${dims.text} font-bold text-zinc-100`}>{score}</span>
    </div>
  );
}
