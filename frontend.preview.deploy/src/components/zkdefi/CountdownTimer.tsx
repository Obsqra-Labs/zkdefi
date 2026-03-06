"use client";

import { useState, useEffect } from "react";

interface CountdownTimerProps {
  launchDate: Date;
}

export default function CountdownTimer({ launchDate }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isLive: false,
  });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = launchDate.getTime();
      const difference = target - now;

      if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, isLive: true };
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((difference % (1000 * 60)) / 1000),
        isLive: false,
      };
    };

    // Initial calculation
    setTimeLeft(calculateTimeLeft());

    // Update every second
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [launchDate]);

  if (timeLeft.isLive) {
    return (
      <div className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600/20 border border-emerald-500/30">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
        </span>
        <span className="text-emerald-400 font-medium">Alpha Live on Sepolia</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs font-mono text-zinc-400 tracking-wider uppercase">
        Alpha launches on Sepolia in
      </p>
      <div className="flex gap-3 md:gap-6">
        <TimeUnit value={timeLeft.days} label="days" />
        <TimeUnit value={timeLeft.hours} label="hours" />
        <TimeUnit value={timeLeft.minutes} label="mins" />
        <TimeUnit value={timeLeft.seconds} label="secs" />
      </div>
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 min-w-[70px]">
        <span className="text-3xl md:text-4xl font-bold text-white tabular-nums">
          {String(value).padStart(2, "0")}
        </span>
      </div>
      <span className="text-xs text-zinc-500 mt-2 uppercase tracking-wide">
        {label}
      </span>
    </div>
  );
}
