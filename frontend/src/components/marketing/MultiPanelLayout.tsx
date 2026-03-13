"use client";

import { useState, useCallback, type ReactNode } from "react";
import {
  LayoutGrid,
  AlignJustify,
  Columns,
  Maximize,
  Grid2x2,
} from "lucide-react";

/* ─── types ────────────────────────────────────────────────────────── */

export type LayoutMode = "grid" | "columns" | "rows" | "focus";

export interface PanelDef {
  id: string;
  title: string;
  accent?: string;
  icon?: ReactNode;
  content: ReactNode;
  /** If true the panel cannot be closed */
  pinned?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
}

export interface PanelState {
  isCollapsed: boolean;
  isMaximized: boolean;
  isVisible: boolean;
}

interface MultiPanelLayoutProps {
  panels: PanelDef[];
  /** Initial layout mode */
  defaultLayout?: LayoutMode;
  /** Extra class on the outer wrapper */
  className?: string;
}

/* ─── layout presets CSS ───────────────────────────────────────────── */

function layoutClass(mode: LayoutMode, panelCount: number): string {
  switch (mode) {
    case "grid":
      if (panelCount <= 2) return "grid grid-cols-1 md:grid-cols-2 gap-3";
      if (panelCount <= 4) return "grid grid-cols-1 md:grid-cols-2 gap-3";
      return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3";
    case "columns":
      return "flex flex-col gap-3";
    case "rows":
      return `grid grid-cols-1 ${panelCount <= 3 ? "md:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"} gap-3`;
    case "focus":
      return "flex flex-col gap-3";
    default:
      return "grid grid-cols-1 md:grid-cols-2 gap-3";
  }
}

const LAYOUT_OPTIONS: { mode: LayoutMode; label: string; icon: typeof LayoutGrid }[] = [
  { mode: "grid", label: "Grid", icon: Grid2x2 },
  { mode: "columns", label: "Stack", icon: AlignJustify },
  { mode: "rows", label: "Row", icon: Columns },
  { mode: "focus", label: "Focus", icon: Maximize },
];

/* ─── component ────────────────────────────────────────────────────── */

export function MultiPanelLayout({
  panels,
  defaultLayout = "grid",
  className = "",
}: MultiPanelLayoutProps) {
  const [layout, setLayout] = useState<LayoutMode>(defaultLayout);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [panelStates, setPanelStates] = useState<Record<string, PanelState>>(() => {
    const s: Record<string, PanelState> = {};
    for (const p of panels) {
      s[p.id] = {
        isCollapsed: p.defaultCollapsed ?? false,
        isMaximized: false,
        isVisible: true,
      };
    }
    return s;
  });

  const updatePanel = useCallback((id: string, patch: Partial<PanelState>) => {
    setPanelStates((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { isCollapsed: false, isMaximized: false, isVisible: true }), ...patch },
    }));
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setPanelStates((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, isCollapsed: !cur.isCollapsed } };
    });
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setPanelStates((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, isMaximized: !cur.isMaximized } };
    });
  }, []);

  const closePanel = useCallback((id: string) => {
    updatePanel(id, { isVisible: false });
  }, [updatePanel]);

  const restoreAll = useCallback(() => {
    setPanelStates((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], isVisible: true, isCollapsed: false, isMaximized: false };
      }
      return next;
    });
    setFocusId(null);
  }, []);

  // Which panels are visible
  const visiblePanels = panels.filter((p) => panelStates[p.id]?.isVisible !== false);
  const hiddenCount = panels.length - visiblePanels.length;

  // Focus mode: show one panel big + sidebar of collapsed tabs
  const focusPanel = focusId ? visiblePanels.find((p) => p.id === focusId) : null;
  const effectiveLayout = layout === "focus" && !focusPanel ? "grid" : layout;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* ── Layout toolbar ── */}
      <div className="flex items-center gap-2 px-1">
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          {LAYOUT_OPTIONS.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              onClick={() => { setLayout(mode); if (mode === "focus" && !focusId && visiblePanels[0]) setFocusId(visiblePanels[0].id); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                (effectiveLayout === mode)
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}
              title={label}
            >
              <Icon className="h-3 w-3" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <span className="flex-1" />

        <span className="text-[9px] text-zinc-600">
          {visiblePanels.length} panel{visiblePanels.length !== 1 ? "s" : ""}
        </span>

        {hiddenCount > 0 && (
          <button
            onClick={restoreAll}
            className="text-[9px] text-amber-500/80 hover:text-amber-400 transition-colors"
          >
            Restore {hiddenCount} hidden
          </button>
        )}
      </div>

      {/* ── Focus layout ── */}
      {effectiveLayout === "focus" && focusPanel && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
          {/* Main area */}
          <TerminalShell
            panel={focusPanel}
            state={panelStates[focusPanel.id]}
            onToggleCollapse={toggleCollapse}
            onToggleMaximize={toggleMaximize}
            onClose={focusPanel.pinned ? undefined : closePanel}
          />

          {/* Sidebar tabs */}
          <div className="flex flex-col gap-2">
            {visiblePanels
              .filter((p) => p.id !== focusId)
              .map((p) => {
                const st = panelStates[p.id] ?? { isCollapsed: true, isMaximized: false, isVisible: true };
                return (
                  <button
                    key={p.id}
                    onClick={() => setFocusId(p.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                      "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                    }`}
                  >
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${p.accent ?? "text-zinc-400"} truncate`}>
                      {p.title}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Grid / Columns / Rows layout ── */}
      {effectiveLayout !== "focus" && (
        <div className={layoutClass(effectiveLayout, visiblePanels.length)}>
          {visiblePanels.map((p) => {
            const st = panelStates[p.id] ?? { isCollapsed: false, isMaximized: false, isVisible: true };
            return (
              <TerminalShell
                key={p.id}
                panel={p}
                state={st}
                onToggleCollapse={toggleCollapse}
                onToggleMaximize={toggleMaximize}
                onClose={p.pinned ? undefined : closePanel}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── inner: wraps PanelDef in a TerminalPanel ─────────────────────── */

import { TerminalPanel } from "./TerminalPanel";

function TerminalShell({
  panel,
  state,
  onToggleCollapse,
  onToggleMaximize,
  onClose,
}: {
  panel: PanelDef;
  state: PanelState;
  onToggleCollapse: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onClose?: (id: string) => void;
}) {
  return (
    <TerminalPanel
      id={panel.id}
      title={panel.title}
      accent={panel.accent}
      icon={panel.icon}
      isMaximized={state.isMaximized}
      isCollapsed={state.isCollapsed}
      onToggleMaximize={onToggleMaximize}
      onToggleCollapse={onToggleCollapse}
      onClose={onClose}
      className={state.isMaximized ? "" : "min-h-0"}
    >
      {panel.content}
    </TerminalPanel>
  );
}
