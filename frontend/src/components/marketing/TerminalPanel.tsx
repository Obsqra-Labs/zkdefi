"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  Maximize2,
  Minimize2,
  X,
  GripVertical,
  Terminal,
} from "lucide-react";

/* ─── types ────────────────────────────────────────────────────────── */

export interface TerminalPanelProps {
  /** Unique panel id */
  id: string;
  /** Tab title shown in the header bar */
  title: string;
  /** Accent color class (text-xxx-400) */
  accent?: string;
  /** Small icon next to title */
  icon?: ReactNode;
  /** Child content rendered in the panel body */
  children: ReactNode;
  /** Whether this panel is currently popped-out / maximized */
  isMaximized?: boolean;
  /** Whether the panel is collapsed to header-only */
  isCollapsed?: boolean;
  onToggleMaximize?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
  onClose?: (id: string) => void;
  /** Optional className for outer wrapper */
  className?: string;
}

/* ─── component ────────────────────────────────────────────────────── */

export function TerminalPanel({
  id,
  title,
  accent = "text-emerald-400",
  icon,
  children,
  isMaximized = false,
  isCollapsed = false,
  onToggleMaximize,
  onToggleCollapse,
  onClose,
  className = "",
}: TerminalPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll body to bottom when content updates
  useEffect(() => {
    if (bodyRef.current && !isCollapsed) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [children, isCollapsed]);

  return (
    <div
      className={`
        flex flex-col overflow-hidden rounded-lg border border-zinc-800
        bg-zinc-950/90 backdrop-blur-sm
        ${isMaximized ? "fixed inset-4 z-50 shadow-2xl shadow-black/60" : ""}
        ${className}
      `}
    >
      {/* ── Title bar ── */}
      <div
        className="flex items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/80 px-3 py-1.5 select-none cursor-pointer"
        onClick={() => onToggleCollapse?.(id)}
      >
        {/* Traffic-light dots */}
        <div className="flex items-center gap-1 mr-1">
          {onClose && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(id); }}
              className="h-2.5 w-2.5 rounded-full bg-rose-500/80 hover:bg-rose-400 transition-colors"
              title="Close"
            />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(id); }}
            className="h-2.5 w-2.5 rounded-full bg-amber-500/80 hover:bg-amber-400 transition-colors"
            title={isCollapsed ? "Expand" : "Collapse"}
          />
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMaximize?.(id); }}
            className="h-2.5 w-2.5 rounded-full bg-emerald-500/80 hover:bg-emerald-400 transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          />
        </div>

        {/* Icon + title */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {icon ?? <Terminal className={`h-3 w-3 ${accent}`} />}
          <span className={`text-[10px] font-bold uppercase tracking-wider ${accent} truncate`}>
            {title}
          </span>
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMaximize?.(id); }}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {isMaximized
              ? <Minimize2 className="h-3 w-3" />
              : <Maximize2 className="h-3 w-3" />
            }
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      {!isCollapsed && (
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-zinc-800"
        >
          {children}
        </div>
      )}
    </div>
  );
}
