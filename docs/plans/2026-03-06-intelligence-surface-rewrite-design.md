# Intelligence Surface Rewrite Design

**Date**: 2026-03-06
**Status**: Approved

## Problem

Three components were directly embedded into narrow sidebars where they don't fit:

| Component | Container | Width | Issue |
|-----------|-----------|-------|-------|
| ModelComposer + MyAgents | Circuit Board palette | 200px | 2-col grids, full-width forms, execution cards all need 400px+ |
| AgentRebalancer | ControlPlane right rail | 280px | 2-col zkML grid, proposal cards, propose modal need 400px+ |

Additionally, the Oracle intelligence components (Signals, Radar, Genome) and BrainVisualizer have no home in Mission Control.

## Design

### 1. Oracle Dashboard Strip

A persistent 3-panel horizontal strip (~200px tall) pinned above the Unified Stream in center stage. Collapsible via chevron (state persisted to localStorage).

**Layout**:

| Left (~40%) | Center (~30%) | Right (~30%) |
|---|---|---|
| Signal Feed: top 3-4 opportunities as compact rows (protocol icon, name, APY, risk badge). Click opens Deploy overlay pre-filled. | Risk-Yield Radar: mini Recharts scatter chart. Dots by risk (x) vs yield (y), sized by liquidity. Hover tooltip, click opens Deploy. | Genome Snapshot: factor bars for the #1 ranked strategy (Yield, Risk, Volatility, Liquidity, Efficiency). Read-only. |

**Data**: Single `POST /api/v1/strategies/opportunities` fetch shared across all three panels. Auto-refresh every 60s.

**Collapsed state**: One-line strip: "3 signals | Top: Ekubo ETH/STRK 12.4% | Risk: Low"

### 2. Agent Insights Strip (replaces Rebalancer in ControlPlane)

Remove the full AgentRebalancer component from ControlPlane. Replace with a compact **Agent Insights** section that surfaces proactive intelligence nudges.

**Data sources** (all existing backend endpoints):
- `POST /api/v1/zkdefi/zkml/risk_score` -- position risk
- `POST /api/v1/zkdefi/zkml/anomaly` -- market anomalies
- `POST /api/v1/strategies/opportunities` -- yield opportunities
- zkRAG pipeline recommendations

**Display**: Max 3 compact insight cards (280px-friendly), each with:
- One-liner insight text with icon
- Action button: [Review], [Rebalance], [Deploy], [Investigate]
- Actions open relevant overlay or slideout

**Examples**:
- "ETH volatility +18% -- Ekubo LP IL exposure rising" → [Review]
- "STRK lending rate 2.1% -- Staking yields 4.8%" → [Rebalance]
- "AnomalyDetector flagged unusual STRK/USDC spread" → [Investigate]

**"See all"** expands or opens zkRAG slideout.

**Rebalance proposals** still flow into the Unified Stream as actionable cards (approve/reject inline). The insights strip is the "why"; the stream card is the "what."

### 3. Circuit Board Palette Rewrite

Remove ModelComposer and MyAgents embeds from the 200px palette. Replace with purpose-built palette items and header actions.

#### Palette: MODELS section
New collapsible section alongside CIRCUITS, ENTITIES, LOGIC, VENUES:

```
MODELS ▾
  [drag] RiskScore ML
  [drag] AnomalyDetector
  [drag] CreditMLP
  [drag] YieldForecast
  [drag] TimingPredictor
  [drag] RobustnessCert
```

Each item is a compact draggable chip (icon + name), matching existing palette item pattern. No forms, no descriptions.

#### Canvas: Model Nodes
When dragged onto canvas, creates a Model Node:
- **Input ports**: feature inputs (connect from Entity nodes or circuits)
- **Output ports**: score/classification (connect to Logic nodes for gating)
- **Visual**: indigo border to distinguish from green circuit nodes

#### Properties Panel (220px right sidebar)
When a Model Node is selected:
- **Type**: ModelNode (read-only)
- **Model**: dropdown to switch models
- **Threshold**: numeric input (reject if score > N)
- **Confidence**: slider (minimum confidence)
- **Input mapping**: feature-to-input mapping

#### Agent Creation via Header
- **Save As Agent** button in header toolbar (next to Test Run, Save Policy)
- Names the flow, persists via `POST /agents/create` with full node graph
- No more inline ModelComposer form

#### Load Agent via Templates
- Existing Templates dropdown gets "My Agents" as a category
- Selecting loads agent's node graph onto canvas
- No more MyAgents card list in palette

#### A2A Reputation Gating (future scope)
New ENTITIES palette item: **Agent Identity**
- Properties: Agent address, required reputation tier, required proof badges
- Use case: gate interactions by verifiable credentials
- Implementation deferred; node type and properties panel designed now

### 4. BrainVisualizer as Overlay

Full-width overlay, same pattern as Deploy / Circuit Board / Governance.

**Trigger**:
- "Run Brain Check" button in ControlPlane (under Agent Status)
- Also reachable from Agent Insights cards ([Investigate] action)

**Overlay content**:
- Feature sliders (Volatility, Concentration, Age, Volume)
- Tier flow visualization (Tier 0 Cairo → Tier 1a RiskScore → Tier 1b Anomaly → Verdict)
- Real proof generation via `/api/v1/zkdefi/zkml/risk_score` and `/api/v1/zkdefi/zkml/anomaly`
- Results: proof calldata, verification status

**Stream integration**: Completed brain checks emit `brain_check` events into the Unified Stream with timestamp, verdict, tier results, and proof badge.

**OverlayMode**: Extended to `null | "deploy" | "circuitBoard" | "governance" | "brain"`

## Components Affected

| File | Action |
|------|--------|
| `mission-control/UnifiedStream.tsx` | Add Oracle Dashboard Strip above stream; add `rebalance_proposal` and `brain_check` card types |
| `mission-control/ControlPlane.tsx` | Remove AgentRebalancer section; add Agent Insights strip; add Brain Check button |
| `mission-control/CircuitBoard.tsx` | Remove ModelComposer/MyAgents embeds; add MODELS palette section; add Save As Agent header action; add Model Node type |
| `agent/page.tsx` | Add `"brain"` to OverlayMode; wire BrainVisualizer overlay |
| New: `mission-control/OracleDashboardStrip.tsx` | 3-panel Oracle strip component |
| New: `mission-control/AgentInsightsStrip.tsx` | Compact insights strip for ControlPlane |
| New: `mission-control/ModelNode.tsx` (React Flow custom node) | Model node for Circuit Board canvas |
| `mission-control/StreamCard.tsx` | Add `rebalance_proposal` and `brain_check` card renderers |

## API Dependencies

All endpoints already exist:
- `POST /api/v1/strategies/opportunities`
- `POST /api/v1/zkdefi/zkml/risk_score`
- `POST /api/v1/zkdefi/zkml/anomaly`
- `GET /api/v1/zkdefi/rebalancer/proposals/{address}`
- `POST /api/v1/zkdefi/rebalancer/execute`
- `GET /api/v1/agents/models/list`
- `POST /api/v1/agents/create`
- `GET /api/v1/agents/user/{address}`

No new backend endpoints required. The `/stream/{address}` endpoint may need to include `rebalance_proposal` and `brain_check` event types.
