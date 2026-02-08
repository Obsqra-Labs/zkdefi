"""
zkde.fi backend - FastAPI app (port 8003).
zkde.fi by Obsqra Labs. Calls obsqra.fi proving API as external black box.
"""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)

# Enable application-level logging (uvicorn only passes its own loggers by default)
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logging.getLogger("app").setLevel(logging.INFO)

from app.api.zkdefi_agent import router as zkdefi_router
from app.api.zkml import router as zkml_router
from app.api.session_keys import router as session_keys_router
from app.api.rebalancer import router as rebalancer_router
from app.api.oracle import router as oracle_router
from app.api.reputation import router as reputation_router
from app.api.relayer import router as relayer_router
from app.api.routes.full_privacy import router as full_privacy_router
from app.api.routes.onboarding import router as onboarding_router
from app.api.routes.agents import router as agents_router
from app.api.routes.identity import router as identity_router

app = FastAPI(
    title="zkde.fi by Obsqra Labs API",
    description="zkde.fi - Full privacy DeFi with selective disclosure on Starknet.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(zkdefi_router, prefix="/api/v1/zkdefi", tags=["zkdefi"])
app.include_router(zkml_router, prefix="/api/v1/zkdefi/zkml", tags=["zkml"])
app.include_router(session_keys_router, prefix="/api/v1/zkdefi/session_keys", tags=["session_keys"])
app.include_router(rebalancer_router, prefix="/api/v1/zkdefi/rebalancer", tags=["rebalancer"])
app.include_router(oracle_router, prefix="/api/v1/zkdefi", tags=["oracle"])
app.include_router(reputation_router, prefix="/api/v1/zkdefi", tags=["reputation"])
app.include_router(relayer_router, prefix="/api/v1/zkdefi", tags=["relayer"])
app.include_router(full_privacy_router, prefix="/api/v1/zkdefi/full_privacy", tags=["full_privacy"])
app.include_router(onboarding_router, prefix="/api/v1/zkdefi/onboarding", tags=["onboarding"])
app.include_router(agents_router, prefix="/api/v1/agents", tags=["agents"])
app.include_router(identity_router, prefix="/api/v1/identity", tags=["identity"])

@app.get("/health")
def health():
    return {"status": "ok", "service": "zkde.fi"}
