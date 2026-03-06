# Intelligence Surface Rewrite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite 4 components in Mission Control: add Oracle Dashboard Strip above the stream, replace AgentRebalancer with Agent Insights strip, rewrite Circuit Board palette with draggable model nodes, and wire BrainVisualizer as a full overlay.

**Architecture:** The center stage gains a persistent collapsible Oracle strip above the Unified Stream. The ControlPlane right rail loses AgentRebalancer and gains a compact Agent Insights feed. The Circuit Board palette gains a MODELS section with draggable items that create ModelNode instances on the canvas, with properties editable in the right panel. BrainVisualizer becomes a fourth overlay mode alongside Deploy, Circuit Board, and Governance.

**Tech Stack:** Next.js 14, React, ReactFlow, Recharts (ScatterChart for radar), Framer Motion, lucide-react, apiFetch client

---

## Task 1: Create OracleDashboardStrip Component

**Files:**
- Create: `frontend/src/components/zkdefi/mission-control/OracleDashboardStrip.tsx`

**Step 1: Create the component**

```tsx
// OracleDashboardStrip.tsx
// 3-panel strip: Signal Feed | Risk-Yield Radar | Genome Snapshot
// Single POST /strategies/opportunities fetch shared across panels
// Collapsible via chevron, state in localStorage
// ~200px expanded, single-line collapsed
//
// Props: { address: string | undefined; onDeploy?: (id: string) => void }
// Data: opportunities[] from POST /api/v1/strategies/opportunities
// Panels:
//   Left  (~40%): top 3-4 opportunities as compact rows
//   Center(~30%): Recharts ScatterChart (risk x yield, sized by liquidity)
//   Right (~30%): factor bars for #1 strategy
```

The component fetches `POST /api/v1/strategies/opportunities` with `{ user_address: address, risk_profile: "balanced", limit: 20 }`. It shows loading/error states. The collapsed state is a one-line summary persisted to `localStorage("zkdefi_oracle_collapsed")`.

**Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: Compiles (component not imported yet)

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/OracleDashboardStrip.tsx
git commit -m "feat: add OracleDashboardStrip component"
```

---

## Task 2: Integrate OracleDashboardStrip into UnifiedStream

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/UnifiedStream.tsx`

**Step 1: Add import and render strip above filter bar**

In `UnifiedStream.tsx`:
- Import `OracleDashboardStrip` from `./OracleDashboardStrip`
- Add `onDeploy` to the props destructuring (already exists)
- Render `<OracleDashboardStrip address={address} onDeploy={onDeploy} />` as the first child inside the root `<div className="flex flex-col h-full">`, before the filter bar

The strip sits above the filter bar. When a signal card is clicked, it calls `onDeploy(opportunityId)` which opens the Deploy overlay.

**Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/UnifiedStream.tsx
git commit -m "feat: integrate OracleDashboardStrip above unified stream"
```

---

## Task 3: Create AgentInsightsStrip Component

**Files:**
- Create: `frontend/src/components/zkdefi/mission-control/AgentInsightsStrip.tsx`

**Step 1: Create the component**

```tsx
// AgentInsightsStrip.tsx
// Compact insight cards for 280px ControlPlane right rail
// Props: { address: string | undefined; onAction?: (action: string) => void }
// Data sources:
//   - POST /api/v1/zkdefi/zkml/risk_score (position risk)
//   - POST /api/v1/strategies/opportunities (top yield opp)
// Displays max 3 compact cards, each ~60px tall:
//   - Icon + one-liner text + [Action] button
//   - Actions: "review", "rebalance", "deploy", "investigate"
// "See all" link at bottom calls onAction("open_zkrag")
```

Each insight card is a single flex row: icon (16px) + text (flex-1, truncated) + action button (text-only). The component polls every 30s. It parses risk_score results to generate insights like "Risk score elevated: 72/100" and opportunity data to generate "Ekubo ETH/STRK yielding 12.4% APY".

**Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: Compiles (not imported yet)

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/AgentInsightsStrip.tsx
git commit -m "feat: add AgentInsightsStrip component for ControlPlane"
```

---

## Task 4: Replace AgentRebalancer with AgentInsightsStrip in ControlPlane

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/ControlPlane.tsx`

**Step 1: Remove AgentRebalancer, add AgentInsightsStrip**

In `ControlPlane.tsx`:
- Remove import of `AgentRebalancer`
- Remove `showRebalancer` state
- Remove the entire "Agent Rebalancer (expandable)" section (lines 732-747)
- Import `AgentInsightsStrip` from `./AgentInsightsStrip`
- Add props: `onOpenBrain?: () => void`, `onDeploy?: () => void`, `onOpenZkRag?: () => void`
- Add the Agent Insights section after Session Key:
  ```tsx
  <AgentInsightsStrip
    address={address}
    onAction={(action) => {
      if (action === "investigate" && onOpenBrain) onOpenBrain();
      if (action === "deploy" && onDeploy) onDeploy();
      if (action === "open_zkrag" && onOpenZkRag) onOpenZkRag();
    }}
  />
  ```
- Add "Run Brain Check" button after Agent Insights:
  ```tsx
  <button onClick={onOpenBrain} className="w-full py-2 rounded-lg border border-indigo-600/50 text-indigo-400 hover:bg-indigo-900/20 text-xs font-medium">
    Run Brain Check
  </button>
  ```

**Step 2: Update ControlPlane props interface**

```tsx
interface ControlPlaneProps {
  address: string | undefined;
  onOpenCircuitBoard?: () => void;
  onOpenBrain?: () => void;
  onDeploy?: () => void;
  onOpenZkRag?: () => void;
}
```

**Step 3: Verify build**

Run: `cd frontend && npx next build`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/ControlPlane.tsx
git commit -m "feat: replace AgentRebalancer with AgentInsightsStrip in ControlPlane"
```

---

## Task 5: Add ModelNode to Circuit Board and Rewrite Palette

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/CircuitBoard.tsx`

**Step 1: Add ModelNode custom node component**

Add after `VenueNode` (around line 133):

```tsx
function ModelNode({ data }: { data: Record<string, unknown> }) {
  const name = (data.label as string) || "ML Model";
  const threshold = (data.threshold as number) ?? 30;
  const confidence = (data.confidence as number) ?? 0.8;
  return (
    <div className="min-w-[140px] rounded-lg border-2 border-indigo-500/70 bg-zinc-900/95 px-3 py-2 shadow-lg">
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-indigo-400" />
      <div className="text-xs font-semibold text-indigo-400">{name}</div>
      <div className="text-[10px] text-zinc-500">thresh: {threshold}</div>
      <div className="text-[10px] text-zinc-500">conf: {(confidence * 100).toFixed(0)}%</div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-indigo-400" />
    </div>
  );
}
```

**Step 2: Register ModelNode in nodeTypes**

```tsx
const nodeTypes: NodeTypes = {
  entity: EntityNode,
  circuit: CircuitNode,
  logic: LogicNode,
  venue: VenueNode,
  model: ModelNode,
};
```

**Step 3: Update MiniMap color**

Add model color to MiniMap nodeColor callback:
```tsx
if (n.type === "model") return "rgb(129 140 248)"; // indigo-400
```

**Step 4: Replace Agents & Models section with MODELS palette**

Remove the `showModels` state, `agentRefresh` state, `ModelComposer` import, and `MyAgents` import.

Remove the entire "Agents & Models" div (lines 555-575).

Add a new CollapsibleSection after VENUES:

```tsx
<CollapsibleSection title="MODELS" defaultOpen={false}>
  {["RiskScore ML", "AnomalyDetector", "CreditMLP", "YieldForecast", "TimingPredictor", "RobustnessCert"].map((l) => (
    <PaletteItem key={l} label={l} type="model" onDragStart={onNodeDragStart} />
  ))}
</CollapsibleSection>
```

**Step 5: Update PaletteItem to handle model type**

In the `PaletteItem` function, add model data initialization:
```tsx
if (type === "model") {
  data.threshold = 30;
  data.confidence = 0.8;
}
```

**Step 6: Update properties panel for model nodes**

After the venue properties block (around line 639), add:

```tsx
{selectedNode.type === "model" && (
  <>
    <div>
      <label className="block text-zinc-500 mb-0.5">Model</label>
      <select
        value={(selectedNode.data?.label as string) || "RiskScore ML"}
        onChange={(e) => updateSelectedNodeData("label", e.target.value)}
        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
      >
        {["RiskScore ML", "AnomalyDetector", "CreditMLP", "YieldForecast", "TimingPredictor", "RobustnessCert"].map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
    <div>
      <label className="block text-zinc-500 mb-0.5">Threshold</label>
      <input
        type="number"
        min={0}
        max={100}
        value={(selectedNode.data?.threshold as number) ?? 30}
        onChange={(e) => updateSelectedNodeData("threshold", parseInt(e.target.value, 10) || 0)}
        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200"
      />
    </div>
    <div>
      <label className="block text-zinc-500 mb-0.5">Confidence %</label>
      <input
        type="range"
        min={0}
        max={100}
        value={((selectedNode.data?.confidence as number) ?? 0.8) * 100}
        onChange={(e) => updateSelectedNodeData("confidence", parseInt(e.target.value, 10) / 100)}
        className="w-full h-1.5 rounded-full appearance-none bg-zinc-800 accent-indigo-500"
      />
      <div className="text-right text-zinc-400 text-[10px]">
        {(((selectedNode.data?.confidence as number) ?? 0.8) * 100).toFixed(0)}%
      </div>
    </div>
  </>
)}
```

**Step 7: Add "Save As Agent" to header**

After the Save button in the header, add:

```tsx
<button
  onClick={handleSaveAsAgent}
  className="flex items-center gap-1 rounded border border-indigo-600 bg-indigo-600/20 px-2 py-0.5 text-xs text-indigo-400 hover:bg-indigo-600/30"
>
  <Save className="w-3 h-3" /> Save As Agent
</button>
```

Add the handler:
```tsx
const handleSaveAsAgent = useCallback(async () => {
  if (!address) {
    toastError("Connect wallet first");
    return;
  }
  if (nodes.length === 0) {
    toastWarning("Add nodes to the canvas first");
    return;
  }
  try {
    const modelNodes = nodes.filter(n => n.type === "model");
    const processorIds = modelNodes.map(n => (n.data?.label as string)?.toLowerCase().replace(/\s+/g, "_") || "risk_score");
    await apiFetch("/api/v1/agents/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_address: address,
        name: policyName,
        processor_ids: processorIds.length ? processorIds : ["risk_score"],
        decision_logic: "AND",
        circuit_board: { nodes, edges, policy_name: policyName },
      }),
    });
    toastSuccess(`Agent "${policyName}" created`);
  } catch (e) {
    toastError(e instanceof Error ? e.message : "Failed to create agent");
  }
}, [address, nodes, edges, policyName]);
```

**Step 8: Update onDrop to handle model type**

In `FlowCanvasInner`'s `onDrop`, the type cast should include "model":
```tsx
type: type as "entity" | "circuit" | "logic" | "venue" | "model",
```

**Step 9: Verify build**

Run: `cd frontend && npx next build`
Expected: PASS

**Step 10: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/CircuitBoard.tsx
git commit -m "feat: rewrite Circuit Board palette with draggable model nodes"
```

---

## Task 6: Add BrainVisualizer as Overlay

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/MissionControlLayout.tsx`
- Modify: `frontend/src/components/zkdefi/mission-control/HeaderStrip.tsx`
- Modify: `frontend/src/app/agent/page.tsx`

**Step 1: Extend OverlayMode**

In `MissionControlLayout.tsx`, change:
```tsx
export type OverlayMode = "deploy" | "circuit-board" | "governance" | "brain" | null;
```

**Step 2: Add Brain button to HeaderStrip**

In `HeaderStrip.tsx`, after the "Govern" button, add:
```tsx
<button
  onClick={() => onOverlayChange(activeOverlay === "brain" ? null : "brain")}
  className={`px-2 py-0.5 rounded transition-colors ${activeOverlay === "brain" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
>
  Brain
</button>
```

**Step 3: Wire BrainVisualizer in agent/page.tsx**

Import `BrainVisualizer`:
```tsx
import { BrainVisualizer } from "@/components/zkdefi/BrainVisualizer";
```

Add the brain overlay case in the overlay content block (after governance):
```tsx
} else if (activeOverlay === "brain") {
  overlayContent = (
    <div className="flex h-full flex-col bg-zinc-950">
      <header className="flex h-10 flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4">
        <span className="font-semibold text-sm text-zinc-100">Brain — zkML Check</span>
        <button
          onClick={() => setActiveOverlay(null)}
          className="flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700 text-zinc-200"
        >
          <X className="w-3 h-3" /> Close
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {address && <BrainVisualizer userAddress={address} />}
      </div>
    </div>
  );
}
```

**Step 4: Wire ControlPlane new props**

Update the `<ControlPlane>` render to pass new props:
```tsx
<ControlPlane
  address={address}
  onOpenCircuitBoard={handleOpenCircuitBoard}
  onOpenBrain={() => setActiveOverlay("brain")}
  onDeploy={() => setActiveOverlay("deploy")}
  onOpenZkRag={() => setSlideout("zkrag")}
/>
```

**Step 5: Hide right rail for brain overlay too**

In `MissionControlLayout.tsx`, update the right rail visibility:
```tsx
{activeOverlay !== "circuit-board" && activeOverlay !== "brain" && (
```

**Step 6: Verify build**

Run: `cd frontend && npx next build`
Expected: PASS

**Step 7: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/MissionControlLayout.tsx \
       frontend/src/components/zkdefi/mission-control/HeaderStrip.tsx \
       frontend/src/app/agent/page.tsx
git commit -m "feat: add BrainVisualizer as full overlay mode"
```

---

## Task 7: Add Rebalance Proposal and Brain Check Card Types to Stream

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/StreamCard.tsx`

**Step 1: Add new TYPE_CONFIG entries**

Add to the `TYPE_CONFIG` object:
```tsx
rebalance: { icon: Shuffle, bg: "bg-indigo-500/20", text: "text-indigo-400", border: "border-l-indigo-500" },
brain_check: { icon: Brain, bg: "bg-purple-500/20", text: "text-purple-400" },
```

Import `Shuffle` from `lucide-react`.

**Step 2: Add rebalance-specific rendering**

In the StreamCard body, after the opportunity APY display, add:
```tsx
{item.type === "rebalance" && item.venue && (
  <p className="text-xs text-indigo-400 mt-1">{item.venue}</p>
)}
{item.type === "brain_check" && item.composite_score != null && (
  <div className="flex items-center gap-2 mt-1">
    <span className={`text-xs font-medium ${item.composite_score < 30 ? "text-emerald-400" : item.composite_score < 70 ? "text-amber-400" : "text-red-400"}`}>
      Score: {item.composite_score}/100
    </span>
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${item.status === "passed" ? "bg-emerald-900/50 text-emerald-400" : "bg-red-900/50 text-red-400"}`}>
      {item.status}
    </span>
  </div>
)}
```

**Step 3: Add border-left for rebalance cards**

In the root div className conditional, add:
```tsx
${item.type === "rebalance" ? "border-l-4 border-l-indigo-500" : ""}
```

**Step 4: Verify build**

Run: `cd frontend && npx next build`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/StreamCard.tsx
git commit -m "feat: add rebalance and brain_check stream card types"
```

---

## Task 8: Update Exports and Final Build Verification

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/index.ts`

**Step 1: Add new exports**

```tsx
export { OracleDashboardStrip } from "./OracleDashboardStrip";
export { AgentInsightsStrip } from "./AgentInsightsStrip";
```

**Step 2: Full build verification**

Run: `cd frontend && npx next build`
Expected: PASS with zero type errors

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/index.ts
git commit -m "feat: export new intelligence surface components"
```
