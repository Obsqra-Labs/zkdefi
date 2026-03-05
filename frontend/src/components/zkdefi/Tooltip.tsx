"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  /** Position relative to the trigger element. */
  position?: "top" | "bottom" | "left" | "right";
  /** Extra CSS classes on the tooltip bubble. */
  className?: string;
}

/**
 * Lightweight tooltip — pure CSS positioning, no external dependencies.
 */
export function Tooltip({ content, children, position = "top", className = "" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    timeoutRef.current = setTimeout(() => setVisible(false), 120);
  }, []);

  const positionClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && content && (
        <span
          role="tooltip"
          className={`absolute z-50 pointer-events-none whitespace-normal max-w-[220px] rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-300 shadow-lg ${positionClasses[position]} ${className}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
