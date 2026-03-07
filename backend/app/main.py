"""
Canonical zkde.fi backend application.

This file is the single FastAPI entrypoint for the zkde.fi frontend (`/agent`, `/mvp`,
`/profile`). It mounts the stable route map and keeps a compatibility alias for
legacy `/api/v2/strategies/*` MVP calls.
"""

from __future__ import annotations

import importlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load backend-local .env first.
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    try:
        from app.services.snapshot_forecaster_worker import (
            maybe_start_snapshot_forecaster_worker,
            stop_snapshot_forecaster_worker,
        )

        await maybe_start_snapshot_forecaster_worker()
    except Exception as exc:  # pragma: no cover - defensive startup guard
        logger.warning("Snapshot forecaster worker startup skipped: %s", exc)
        stop_snapshot_forecaster_worker = None

    try:
        yield
    finally:
        try:
            if stop_snapshot_forecaster_worker:
                await stop_snapshot_forecaster_worker()
        except Exception as exc:  # pragma: no cover - defensive shutdown guard
            logger.warning("Snapshot forecaster worker shutdown warning: %s", exc)


def _optional_router(module_path: str, attr: str = "router") -> Optional[APIRouter]:
    """Load a router module without crashing app startup if it's unavailable."""
    try:
        module = importlib.import_module(module_path)
        router = getattr(module, attr, None)
        if router is None:
            logger.warning("Router attribute %s missing in %s", attr, module_path)
            return None
        return router
    except Exception as exc:  # pragma: no cover - defensive startup guard
        logger.warning("Skipping router %s: %s", module_path, exc)
        return None


app = FastAPI(
    title="zkde.fi API",
    description=(
        "zkde.fi by Obsqra Labs — proof-gated execution, privacy pools, "
        "risk passport, and autonomous agent tooling on Starknet."
    ),
    version="0.2.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Core zkde.fi API surface (consumed by /agent and /profile)
# -----------------------------------------------------------------------------

zkdefi_router = _optional_router("app.api.zkdefi_agent")
zkml_router = _optional_router("app.api.zkml")
session_keys_router = _optional_router("app.api.session_keys")
rebalancer_router = _optional_router("app.api.rebalancer")
oracle_router = _optional_router("app.api.oracle")
reputation_router = _optional_router("app.api.reputation")
relayer_router = _optional_router("app.api.relayer")
risk_passport_router = _optional_router("app.api.risk_passport")
linked_addresses_router = _optional_router("app.api.linked_addresses")
full_privacy_router = _optional_router("app.api.routes.full_privacy")
dex_router = _optional_router("app.api.routes.dex")
onboarding_router = _optional_router("app.api.routes.onboarding")
proofs_router = _optional_router("app.api.routes.proofs")
zkgraph_router = _optional_router("app.api.routes.zkgraph")
snapshot_forecaster_router = _optional_router("app.api.routes.snapshot_forecaster")
trade_desk_router = _optional_router("app.api.routes.trade_desk")

if zkdefi_router:
    app.include_router(zkdefi_router, prefix="/api/v1/zkdefi", tags=["zkdefi"])
if zkml_router:
    app.include_router(zkml_router, prefix="/api/v1/zkdefi/zkml", tags=["zkml"])
if session_keys_router:
    app.include_router(
        session_keys_router,
        prefix="/api/v1/zkdefi/session_keys",
        tags=["session_keys"],
    )
if rebalancer_router:
    app.include_router(
        rebalancer_router,
        prefix="/api/v1/zkdefi/rebalancer",
        tags=["rebalancer"],
    )
if oracle_router:
    app.include_router(oracle_router, prefix="/api/v1/zkdefi", tags=["oracle"])
if reputation_router:
    app.include_router(reputation_router, prefix="/api/v1/zkdefi", tags=["reputation"])
if relayer_router:
    app.include_router(relayer_router, prefix="/api/v1/zkdefi", tags=["relayer"])
if risk_passport_router:
    app.include_router(
        risk_passport_router,
        prefix="/api/v1/zkdefi",
        tags=["risk_passport"],
    )
if linked_addresses_router:
    app.include_router(
        linked_addresses_router,
        prefix="/api/v1/zkdefi",
        tags=["linked_addresses"],
    )
if full_privacy_router:
    app.include_router(
        full_privacy_router,
        prefix="/api/v1/zkdefi/full_privacy",
        tags=["full_privacy"],
    )
if dex_router:
    app.include_router(dex_router, prefix="/api/v1/zkdefi", tags=["dex"])
if onboarding_router:
    app.include_router(
        onboarding_router,
        prefix="/api/v1/zkdefi/onboarding",
        tags=["onboarding"],
    )
if proofs_router:
    app.include_router(
        proofs_router,
        prefix="/api/v1/zkdefi/proofs",
        tags=["proofs"],
    )
if snapshot_forecaster_router:
    app.include_router(
        snapshot_forecaster_router,
        prefix="/api/v1/zkdefi",
        tags=["snapshot-forecaster"],
    )
orchestration_router = _optional_router("app.api.routes.orchestration")
if zkgraph_router:
    app.include_router(
        zkgraph_router,
        prefix="/api/v1/zkdefi/zkgraph",
        tags=["zkgraph"],
    )
if orchestration_router:
    app.include_router(
        orchestration_router,
        prefix="/api/v1/zkdefi/orchestration",
        tags=["orchestration"],
    )


# -----------------------------------------------------------------------------
# Mission Control: previously orphaned routes now mounted
# -----------------------------------------------------------------------------

vault_v2_router = _optional_router("app.api.routes.vault_v2")
ledger_router = _optional_router("app.api.routes.ledger")
private_yield_router = _optional_router("app.api.routes.private_yield")
dao_router = _optional_router("app.api.routes.dao_governance")
vault_proposals_router = _optional_router("app.api.routes.vault_proposals")
lending_router = _optional_router("app.api.routes.lending")
staking_router = _optional_router("app.api.routes.staking")
mission_control_router = _optional_router("app.api.routes.mission_control")

if vault_v2_router:
    app.include_router(vault_v2_router, prefix="/api/v2/vault", tags=["vault-v2"])
if ledger_router:
    app.include_router(
        ledger_router, prefix="/api/v1/zkdefi", tags=["ledger"]
    )
if private_yield_router:
    app.include_router(
        private_yield_router, prefix="/api/v1/zkdefi", tags=["private-yield"]
    )
if dao_router:
    app.include_router(dao_router, prefix="/api/v1/dao", tags=["dao"])
if vault_proposals_router:
    app.include_router(
        vault_proposals_router,
        prefix="/api/v1/zkdefi/vault/proposals",
        tags=["vault-proposals"],
    )
if lending_router:
    app.include_router(
        lending_router, prefix="/api/v1/zkdefi/lending", tags=["lending"]
    )
if staking_router:
    app.include_router(
        staking_router, prefix="/api/v1/zkdefi/staking", tags=["staking"]
    )
if mission_control_router:
    app.include_router(
        mission_control_router,
        prefix="/api/v1/zkdefi/mc",
        tags=["mission-control"],
    )


# -----------------------------------------------------------------------------
# Shared service routers (identity + agent marketplace + strategy execution)
# -----------------------------------------------------------------------------

identity_router = _optional_router("app.api.routes.identity")
agents_router = _optional_router("app.api.routes.agents")
strategies_router = _optional_router("app.api.routes.strategies")
deployments_router = _optional_router("app.api.routes.deployments")
vault_execute_router = _optional_router("app.api.routes.vault_execute")
vault_execute_live_router = _optional_router("app.api.routes.vault_execute_live")
phase4a_router = _optional_router("app.api.routes.phase4a")

if identity_router:
    app.include_router(identity_router, prefix="/api/v1/identity", tags=["identity"])
if agents_router:
    app.include_router(agents_router, prefix="/api/v1/agents", tags=["agents"])
if strategies_router:
    app.include_router(strategies_router, prefix="/api/v1/strategies", tags=["strategies"])
if deployments_router:
    app.include_router(
        deployments_router,
        prefix="/api/v1/deployments",
        tags=["deployments"],
    )
if vault_execute_router:
    app.include_router(vault_execute_router, prefix="/api/v1/vault", tags=["vault"])
if vault_execute_live_router:
    app.include_router(
        vault_execute_live_router,
        prefix="/api/v1/vault-live",
        tags=["vault-live"],
    )
if phase4a_router:
    app.include_router(phase4a_router, prefix="/api/v1/phase4a", tags=["phase4a"])
if trade_desk_router:
    app.include_router(trade_desk_router)

receipts_router = _optional_router("app.api.routes.receipts")
if receipts_router:
    app.include_router(
        receipts_router,
        prefix="/api/v1/zkdefi",
        tags=["receipts"],
    )


# -----------------------------------------------------------------------------
# Backward compatibility aliases
# -----------------------------------------------------------------------------

if strategies_router:
    # Legacy MVP route family: /api/v2/strategies/*
    app.include_router(strategies_router, prefix="/api/v2/strategies", tags=["strategies-v2"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "zkdefi-backend"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "zkde.fi api", "health": "/health", "docs": "/docs"}


# Live data routes (wired to Ekubo + zkGraph + zkRAG)
trade_desk_live_router = _optional_router("app.api.routes.trade_desk_live")
if trade_desk_live_router:
    app.include_router(trade_desk_live_router)
