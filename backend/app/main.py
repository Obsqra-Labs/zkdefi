"""
Canonical zkde.fi backend application.

This file is the single FastAPI entrypoint for the zkde.fi frontend (`/agent`, `/mvp`,
`/profile`). It mounts the stable route map and keeps a compatibility alias for
legacy `/api/v2/strategies/*` MVP calls.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import os

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

# Load backend-local .env first.
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Allowed CORS origins — restrict in production, open in dev
# ---------------------------------------------------------------------------
_CORS_ORIGINS_ENV = os.getenv("CORS_ALLOWED_ORIGINS", "")
if _CORS_ORIGINS_ENV:
    CORS_ORIGINS = [o.strip() for o in _CORS_ORIGINS_ENV.split(",") if o.strip()]
elif os.getenv("APP_ENV", "development") == "production":
    CORS_ORIGINS = [
        "https://zkde.fi",
        "https://www.zkde.fi",
        "https://app.zkde.fi",
    ]
else:
    # Development — allow localhost variants
    CORS_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
    ]


@asynccontextmanager
async def _lifespan(app: FastAPI):  # noqa: ARG001
    """Startup: kick off background tasks."""
    try:
        from app.services.merkle_tree_onchain_sync import reconcile_all_roots
        asyncio.create_task(reconcile_all_roots())
        logger.info("Startup: Merkle root reconciliation task scheduled.")
    except Exception as exc:
        logger.warning("Could not schedule reconcile_all_roots on startup: %s", exc)
    
    # Set up WebSocket bridge
    try:
        from app.events.websocket_bridge import setup_websocket_bridge
        await setup_websocket_bridge()
        logger.info("Startup: WebSocket bridge activated.")
    except Exception as exc:
        logger.warning("Could not set up WebSocket bridge: %s", exc)
    
    yield


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
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DemoModeMiddleware(BaseHTTPMiddleware):
    """Set request.state.demo_mode from X-Demo-Mode header (true = paper mode)."""

    async def dispatch(self, request, call_next):
        raw = request.headers.get("X-Demo-Mode", "").strip().lower()
        request.state.demo_mode = raw in ("true", "1", "yes")
        return await call_next(request)


app.add_middleware(DemoModeMiddleware)


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
risk_profile_router = _optional_router("app.api.risk_profile")
linked_addresses_router = _optional_router("app.api.linked_addresses")
full_privacy_router = _optional_router("app.api.routes.full_privacy")
dex_router = _optional_router("app.api.routes.dex")
onboarding_router = _optional_router("app.api.routes.onboarding")
ekubo_router = _optional_router("app.api.routes.ekubo")
market_router = _optional_router("app.api.routes.market")
policy_router = _optional_router("app.api.routes.policy")
shared_pools_router = _optional_router("app.api.routes.shared_pools")
privacy_unified_router = _optional_router("app.api.routes.privacy_unified")
state_router = _optional_router("app.api.routes.state")
system_metrics_router = _optional_router("app.api.routes.system_metrics")
ledger_router = _optional_router("app.api.routes.ledger")
auth_session_router = _optional_router("app.api.routes.auth_session")
notifications_router = _optional_router("app.api.routes.notifications")

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
if risk_profile_router:
    app.include_router(
        risk_profile_router,
        prefix="/api/v1/zkdefi",
        tags=["risk_profile"],
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
if ekubo_router:
    app.include_router(ekubo_router, prefix="/api/v1/zkdefi", tags=["ekubo"])
if market_router:
    app.include_router(market_router, prefix="/api/v1/zkdefi", tags=["market"])
if policy_router:
    app.include_router(policy_router, prefix="/api/v1/zkdefi", tags=["policy"])
if shared_pools_router:
    app.include_router(shared_pools_router, prefix="/api/v1/zkdefi", tags=["shared_pools"])
if privacy_unified_router:
    app.include_router(privacy_unified_router, prefix="/api/v1/zkdefi", tags=["privacy"])
if state_router:
    app.include_router(state_router, prefix="/api/v1/zkdefi", tags=["state"])
if system_metrics_router:
    app.include_router(system_metrics_router, prefix="/api/v1/zkdefi", tags=["system"])
if ledger_router:
    app.include_router(ledger_router, prefix="/api/v1/zkdefi", tags=["ledger"])
if auth_session_router:
    app.include_router(auth_session_router, prefix="/api/v1/zkdefi", tags=["auth_session"])
if notifications_router:
    app.include_router(notifications_router, prefix="/api/v1", tags=["notifications"])
agent_builder_router = _optional_router("app.api.agent_builder")
if agent_builder_router:
    app.include_router(
        agent_builder_router,
        prefix="/api/v1/zkdefi/agent-builder",
        tags=["agent-builder"],
    )
collateral_router = _optional_router("app.api.routes.collateral")
if collateral_router:
    app.include_router(collateral_router, prefix="/api/v1/zkdefi", tags=["collateral"])
lending_router = _optional_router("app.api.routes.lending")
if lending_router:
    app.include_router(lending_router, prefix="/api/v1/zkdefi", tags=["lending"])
stark_id_router = _optional_router("app.api.routes.stark_id")
if stark_id_router:
    app.include_router(stark_id_router, prefix="/api/v1/zkdefi", tags=["stark_id"])
receipts_router = _optional_router("app.api.routes.receipts")
if receipts_router:
    app.include_router(receipts_router, prefix="/api/v1/zkdefi", tags=["receipts"])
sim_router = _optional_router("app.api.routes.sim")
if sim_router:
    app.include_router(sim_router, prefix="/api/v1/zkdefi", tags=["sim"])
private_yield_router = _optional_router("app.api.routes.private_yield")
if private_yield_router:
    app.include_router(private_yield_router, prefix="/api/v1/zkdefi", tags=["private_yield"])
orchestration_router = _optional_router("app.api.routes.orchestration")
if orchestration_router:
    app.include_router(
        orchestration_router,
        prefix="/api/v1/zkdefi/orchestration",
        tags=["orchestration"],
    )
vault_activity_router = _optional_router("app.api.routes.vault_activity")
if vault_activity_router:
    app.include_router(vault_activity_router, prefix="/api/v1/zkdefi", tags=["vault-activity"])
vault_proposals_router = _optional_router("app.api.routes.vault_proposals")
if vault_proposals_router:
    app.include_router(vault_proposals_router)

proofs_router = _optional_router("app.api.routes.proofs")
if proofs_router:
    app.include_router(proofs_router, prefix="/api/v1/zkdefi/proofs", tags=["proofs"])

vault_v2_router = _optional_router("app.api.routes.vault_v2")
if vault_v2_router:
    app.include_router(vault_v2_router, prefix="/api/v1/zkdefi", tags=["vault-v2"])
batch_verification_router = _optional_router("app.api.routes.batch_verification")
if batch_verification_router:
    app.include_router(batch_verification_router, prefix="/api/v1/zkdefi", tags=["batch"])


# -----------------------------------------------------------------------------
# Shared service routers (identity + agent marketplace + strategy execution)
# -----------------------------------------------------------------------------

identity_router = _optional_router("app.api.routes.identity")
agents_router = _optional_router("app.api.routes.agents")
strategies_router = _optional_router("app.api.routes.strategies")
deployments_router = _optional_router("app.api.routes.deployments")
vault_execute_router = _optional_router("app.api.routes.vault_execute")
vault_execute_live_router = _optional_router("app.api.routes.vault_execute_live")
vault_router = _optional_router("app.api.routes.vault")
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
if vault_router:
    app.include_router(vault_router, prefix="/api/v1/zkdefi/vault", tags=["vault-deposit"])
if phase4a_router:
    app.include_router(phase4a_router, prefix="/api/v1/phase4a", tags=["phase4a"])


# -----------------------------------------------------------------------------
# Backward compatibility aliases
# -----------------------------------------------------------------------------

if strategies_router:
    # Legacy MVP route family: /api/v2/strategies/*
    app.include_router(strategies_router, prefix="/api/v2/strategies", tags=["strategies-v2"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "zkdefi-backend"}


@app.get("/api/v1/zkdefi/status")
def legacy_status() -> dict[str, str]:
    """
    Legacy compatibility endpoint retained for smoke tests and older clients.
    """
    return {"status": "ok", "service": "zkdefi-backend"}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "zkde.fi api", "health": "/health", "docs": "/docs"}


# -----------------------------------------------------------------------------
# WebSocket endpoint for real-time updates
# -----------------------------------------------------------------------------

@app.websocket("/ws/{user_address}")
async def websocket_endpoint(websocket: WebSocket, user_address: str):
    """
    WebSocket endpoint for real-time updates.
    
    Clients connect with their wallet address and receive:
    - Strategy updates from market poller
    - Position alerts from position monitor
    - Proof completion notifications
    - Agent status changes
    
    Connection stays alive with periodic pings.
    """
    from app.websocket.manager import get_connection_manager
    
    manager = get_connection_manager()
    await manager.connect(user_address, websocket)
    
    try:
        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for client messages (e.g., pong responses)
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                
                # Client can send ping requests, we respond with pong
                if data == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": asyncio.get_event_loop().time()})
                
            except asyncio.TimeoutError:
                # Send ping every 30s to keep connection alive
                await manager.send_ping(user_address)
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected normally: {user_address}")
        await manager.disconnect(user_address)
        
    except Exception as e:
        logger.error(f"WebSocket error for {user_address}: {e}")
        await manager.disconnect(user_address)
