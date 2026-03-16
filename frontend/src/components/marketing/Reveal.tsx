"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Delay in ms before the animation starts once visible */
  delay?: number;
  /** Which direction to slide in from */
  direction?: "up" | "left" | "right" | "none";
}

/**
 * Scroll-triggered reveal wrapper.
 * Children fade + slide in when they enter the viewport.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
  direction = "up",
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Apply delay then reveal
          setTimeout(() => {
            el.classList.add("revealed");
          }, delay);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  const dirClass =
    direction === "up"
      ? "reveal-up"
      : direction === "left"
        ? "reveal-left"
        : direction === "right"
          ? "reveal-right"
          : "reveal-fade";

  return (
    <div ref={ref} className={`${dirClass} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Staggered reveal for grid children.
 * Each child gets an increasing delay.
 */
export function RevealStagger({
  children,
  className = "",
  baseDelay = 0,
  stagger = 80,
  direction = "up",
}: {
  children: ReactNode[];
  className?: string;
  baseDelay?: number;
  stagger?: number;
  direction?: "up" | "left" | "right" | "none";
}) {
  return (
    <>
      {children.map((child, i) => (
        <Reveal
          key={i}
          className={className}
          delay={baseDelay + i * stagger}
          direction={direction}
        >
          {child}
        </Reveal>
      ))}
    </>
  );
}
