# Capital OS Builder V2 Upgrade Doc

## Scope
This upgrade rebuilds the `/agent` compose experience as a circuit-first side-drawer workspace, hardens composed-agent persistence with SQLite, normalizes LLM providers (including aliases), and keeps `/api/v1/agents/*` backward-compatible.

## What Changed

### Frontend
- Replaced drawer internals in `frontend/src/components/zkdefi/mission-control/AgentBuilderDrawer.tsx` with V2 workspace behavior:
  - `Compose Agent` and `My Agents` tabs.
  - integrated activity stream.
  - auto-switch to `My Agents` on create success.
  - new-agent highlight support.
- Rebuilt `frontend/src/components/zkdefi/ModelComposer.tsx` into a fixed 4-step flow:
  - `Name/Intent`
  - `zkML Models`
  - `LLM Config`
  - `Review/Create`
- Hardened `frontend/src/components/zkdefi/MyAgents.tsx`:
  - defensive payload normalization.
  - execution/deactivation logging hooks.
  - UI safety for malformed API payloads.
- Kept Circuit Board handoff unchanged (`name`, `processors`, `decisionLogic`) and widened drawer in V2 mode via `frontend/src/app/agent/page.tsx`.
- `/marketplace` now reuses the upgraded shared blocks (`ModelComposer` + `MyAgents`) with consistent create/log/highlight behavior.

### Backend
- Replaced volatile in-memory storage path in `backend/app/services/agent_service.py` with SQLite persistence (V2-enabled):
  - additive table `composed_agents` with:
    - `agent_id`, `owner`, `name`, `processors_json`, `decision_logic_json`, `llm_json`, `active`, `created_at`, `updated_at`
  - startup-safe migration:
    - `CREATE TABLE IF NOT EXISTS`
    - `ALTER TABLE ADD COLUMN` only for missing additive columns
- Preserved existing `/api/v1/agents` route shapes in `backend/app/api/routes/agents.py`.
- Added provider alias normalization on create:
  - `anthropic`, `claude`, `clawed` -> canonical `anthropic`
- Extended `GET /api/v1/agents/providers` entries (backward-compatible):
  - `aliases`, `family`, `config_requirements`
  - retained existing fields (`provider_id`, `name`, `models`, `defaults`, etc.)
- Added structured builder events into receipt timeline pipeline (through `ReceiptService.append_proof_receipt`) for:
  - `create`
  - `provider_bind`
  - `execute`
  - `deactivate`

## Feature Flags

### Frontend
- `NEXT_PUBLIC_AGENT_BUILDER_V2`
  - default behavior: enabled unless set to `"0"`
  - `"0"` switches drawer to legacy fallback layout.
- `NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_PERCENT`
  - integer `0..100`, default `100`
  - cohort gate for V2 UI per user address.
- `NEXT_PUBLIC_AGENT_BUILDER_V2_INTERNAL_ALLOWLIST`
  - comma-separated lowercase/hex wallet list
  - always enabled for listed users, regardless of rollout percent.
- `NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_SALT`
  - optional salt for deterministic cohort bucketing.

### Backend
- `AGENT_BUILDER_V2_ENABLED`
  - default behavior: enabled unless explicitly falsy
  - falsy values (`0/false/no/off`) keep in-memory fallback path.
- `AGENT_BUILDER_V2_ROLLOUT_PERCENT`
  - integer `0..100`, default `100`
  - controls which users persist to SQLite vs fallback path.
- `AGENT_BUILDER_V2_INTERNAL_ALLOWLIST`
  - comma-separated lowercase/hex wallet list
  - always on SQLite path even if percent is `0`.
- `AGENT_BUILDER_V2_ROLLOUT_SALT`
  - optional salt for deterministic cohort bucketing.
- Optional DB override:
  - `AGENT_BUILDER_DB_PATH`

## Rollout Plan
1. Internal:
  - set `*_ROLLOUT_PERCENT=0`
  - set `*_INTERNAL_ALLOWLIST` to internal wallets.
2. 10% cohort:
  - set `*_ROLLOUT_PERCENT=10` (keep allowlist populated for guaranteed access).
3. 50% cohort:
  - set `*_ROLLOUT_PERCENT=50` and monitor create/deactivate + receipt events.
4. 100%:
  - set `*_ROLLOUT_PERCENT=100` for full rollout.
5. Instant rollback options:
  - UI rollback: `NEXT_PUBLIC_AGENT_BUILDER_V2=0`
  - backend rollback: `AGENT_BUILDER_V2_ENABLED=false`
  - cohort rollback: set `*_ROLLOUT_PERCENT` down (for example `10` -> `0`).

## Compatibility Notes
- No `/api/v1/agents/*` routes were removed.
- Existing client payloads remain valid.
- Provider alias inputs now map to canonical provider IDs before persistence.

## Test Coverage Added

### Backend
- `backend/tests/test_agents_v2_routes.py`
  - persistence across restart simulation (`create`/`get`/`list`/`deactivate`)
  - provider alias normalization and unknown-provider rejection
  - rollout gating behavior (`allowlist` + `rollout percent`)
  - `/api/v1/agents/*` compatibility checks and providers contract checks

### Frontend
- `frontend/src/lib/agentBuilderRollout.test.ts`
  - kill switch, allowlist override, and percent gating behavior
- `frontend/src/components/zkdefi/ModelComposer.test.tsx`
  - Circuit Board draft hydration across step flow
  - provider-specific config rendering
- `frontend/src/components/zkdefi/mission-control/__tests__/AgentBuilderDrawer.test.tsx`
  - create-success transition to `My Agents` and highlight
- `frontend/src/components/zkdefi/MyAgents.test.tsx`
  - malformed payload safety and API failure handling

## Operational Checks
- Create from Circuit Board -> open builder with draft.
- Complete compose -> agent appears in My Agents and remains after reload.
- Execute/deactivate -> activity stream updates and receipts emitted.
- Verify provider forms for OpenAI, Anthropic aliases (`claude`, `clawed`), Local, Deterministic, Clawbot, Onyx.
