"""Orchestration API: privacy → Ekubo deploy (personal v1), STRK→USDC swap, ETH faucet."""
import json
import logging
import os
import uuid
from pathlib import Path
from time import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.ekubo_execution_service import build_calldata_for_allocation
from app.services.ekubo_config import get_ekubo_chain_id, SEPOLIA_ETH
from app.services.privacy_ekubo_orchestrator import orchestrate_deploy
from app.services.receipt_service import get_receipt_service
from app.services.ledger_service import get_ledger_service
from app.services.ledger_service import get_ledger_service

logger = logging.getLogger(__name__)

# Starknet Sepolia ETH contract (native token)
ETH_CONTRACT_SEPOLIA = SEPOLIA_ETH
FAUCET_ETH_AMOUNT_WEI = int(os.getenv("FAUCET_ETH_AMOUNT_WEI", "1000000000000000"))  # 0.001 ETH
FAUCET_ETH_COOLDOWN_SEC = int(os.getenv("FAUCET_ETH_COOLDOWN_SEC", "86400"))  # 24h

router = APIRouter(tags=["orchestration"])


class SwapStrkToUsdcRequest(BaseModel):
    """Request STRK→USDC swap calldata (Ekubo Sepolia). Sign in wallet to execute."""
    amount_strk_wei: str  # STRK amount in wei (18 decimals)


class FaucetEthRequest(BaseModel):
    """Request ETH airdrop to address (Starknet Sepolia). Backend sends from configured faucet account."""
    to_address: str


class OrchestrateDeployRequest(BaseModel):
    user_address: str
    deployable_amount: float
    risk_profile: str  # conservative | balanced | aggressive


class ConfirmReceiptRequest(BaseModel):
    receipt_id: str
    tx_hash: str


@router.post("/deploy")
async def orchestrate_deploy_endpoint(http_request: Request, request: OrchestrateDeployRequest):
    """Deploy user's deployable amount to Ekubo Sepolia only; record receipt. In demo mode, ledger-only."""
    if getattr(http_request.state, "demo_mode", False):
        amount_wei = int(request.deployable_amount * 1e18)
        if amount_wei <= 0:
            raise HTTPException(status_code=400, detail="deployable_amount must be positive")
        ledger = get_ledger_service()
        try:
            ledger.debit_balance(
                request.user_address,
                amount_wei,
                request_id=None,
                reason="demo_deploy",
                settlement_type="demo",
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        ledger.record_vault_allocation(
            user_address=request.user_address,
            strategy_id="ekubo_demo",
            pool_id="demo",
            amount=request.deployable_amount,
            pair="demo",
            status="active",
            is_demo=True,
        )
        deployment_id = f"demo_{uuid.uuid4().hex[:12]}"
        receipt_svc = get_receipt_service()
        receipt = await receipt_svc.create_receipt(
            user_address=request.user_address,
            constraints_hash=f"demo_{deployment_id}",
            proof_hash=f"0x{uuid.uuid4().hex}",
            action_type="deploy",
            protocol_id=1,
            amount=int(request.deployable_amount * 1e6),
        )
        return {
            "deployment_id": deployment_id,
            "positions": [
                {"strategy": "ekubo_demo", "amount": request.deployable_amount, "status": "recorded", "tx_hash": None},
            ],
            "receipt_id": receipt["receipt_id"],
            "target": "ekubo",
            "demo": True,
        }
    try:
        result = await orchestrate_deploy(
            user_address=request.user_address,
            deployable_amount=request.deployable_amount,
            risk_profile=request.risk_profile,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/receipt/{receipt_id}")
async def get_receipt_endpoint(receipt_id: str):
    """Get a deployment receipt by ID. on_chain=true when a tx_hash was confirmed."""
    receipt_svc = get_receipt_service()
    receipt = await receipt_svc.get_receipt(receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


@router.post("/receipt/confirm")
async def confirm_receipt_endpoint(request: ConfirmReceiptRequest):
    """Attach tx_hash to a deployment receipt after user signs and submits."""
    receipt_svc = get_receipt_service()
    out = await receipt_svc.confirm_receipt(
        receipt_id=request.receipt_id,
        tx_hash=request.tx_hash,
    )
    return out


@router.post("/swap-strk-to-usdc")
async def swap_strk_to_usdc_calldata(request: SwapStrkToUsdcRequest):
    """
    Get Router.swap calldata to swap STRK → USDC on Ekubo Sepolia.
    Use this to get testnet USDC from your STRK.
    Wallet path: transfer STRK to Router, Router.swap, then Router.clear(USDC).
    """
    chain_id = get_ekubo_chain_id()
    if not chain_id:
        raise HTTPException(status_code=503, detail="EKUBO_CHAIN_ID not set. Set for Starknet Sepolia.")
    try:
        amount_wei = int(request.amount_strk_wei)
    except ValueError:
        raise HTTPException(status_code=400, detail="amount_strk_wei must be a decimal string (STRK wei, 18 decimals).")
    if amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_strk_wei must be positive.")
    result = await build_calldata_for_allocation("ekubo_strk_to_usdc", amount_wei, chain_id=chain_id)
    if result.get("error"):
        raise HTTPException(status_code=503, detail=result.get("error", "Failed to build swap calldata."))
    return {
        "contract_address": result["contract_address"],
        "entrypoint": result["entrypoint"],
        "calldata": result["calldata"],
        "token_in": "STRK",
        "token_out": "USDC",
        "message": "Sign in wallet: transfer STRK to Router, execute Router.swap, then Router.clear(USDC). Same flow as Deploy Sign & execute.",
        "balance_required": "Ensure your wallet has at least amount_strk_wei of STRK. Router.swap settles from Router balance, so transfer input to Router before swap and clear output after swap.",
    }


def _faucet_eth_claims_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "faucet_eth_claims.json"


def _faucet_eth_can_claim(to_address: str) -> bool:
    """True if address can claim (not claimed in last FAUCET_ETH_COOLDOWN_SEC)."""
    path = _faucet_eth_claims_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    now = time()
    addr = (to_address or "").strip().lower()
    if not addr:
        return False
    try:
        data = json.loads(path.read_text()) if path.exists() else {}
    except Exception:
        data = {}
    last = data.get(addr, 0)
    return (now - last) >= FAUCET_ETH_COOLDOWN_SEC


def _faucet_eth_record_claim(to_address: str) -> None:
    path = _faucet_eth_claims_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    addr = (to_address or "").strip().lower()
    try:
        data = json.loads(path.read_text()) if path.exists() else {}
    except Exception:
        data = {}
    data[addr] = time()
    path.write_text(json.dumps(data, indent=2))


@router.post("/faucet/eth")
async def faucet_eth_airdrop(request: FaucetEthRequest):
    """
    Airdrop a small amount of ETH to an address on Starknet Sepolia.
    Uses the same executor account as EXECUTOR_LIVE_SUBMIT (must hold ETH).
    Rate limit: one claim per address per 24h (FAUCET_ETH_COOLDOWN_SEC).
    """
    to_address = (request.to_address or "").strip()
    if not to_address or not to_address.startswith("0x"):
        raise HTTPException(status_code=400, detail="to_address must be a valid Starknet address (0x...).")
    if not _faucet_eth_can_claim(to_address):
        raise HTTPException(
            status_code=429,
            detail=f"Address already claimed in the last {FAUCET_ETH_COOLDOWN_SEC // 3600}h. Try again later.",
        )
    try:
        from app.services.contract_executor import ContractExecutor
        ex = ContractExecutor()
        if not ex.can_submit_live():
            raise HTTPException(
                status_code=503,
                detail="Faucet not configured. Set EXECUTOR_LIVE_SUBMIT=true and fund the executor account with ETH.",
            )
        # ERC20 transfer(recipient, amount): u256 = low, high
        amount = FAUCET_ETH_AMOUNT_WEI
        low = amount % (2**128)
        high = amount // (2**128)
        calldata = [to_address, str(low), str(high)]
        tx_hash = await ex._invoke(ETH_CONTRACT_SEPOLIA, "transfer", calldata)
        if not tx_hash:
            raise HTTPException(status_code=503, detail="Faucet invoke failed (no tx_hash).")
        _faucet_eth_record_claim(to_address)
        return {"tx_hash": tx_hash, "amount_wei": FAUCET_ETH_AMOUNT_WEI, "to_address": to_address}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Faucet ETH failed: %s", e)
        raise HTTPException(status_code=503, detail=f"Faucet failed: {e!s}")
