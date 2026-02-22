"""
Linked Addresses Store (8004-aligned)

Persisted mapping: Starknet address -> optional eth/arb/base/opt addresses.
Used by reputation (fetch_combined_history) and identity (credit-proof).
Commitment on-chain; mapping stored privately (file or DB).
"""
import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
LINKED_FILE = DATA_DIR / "linked_addresses.json"


def _normalize(addr: str | None) -> str:
    if not addr or not isinstance(addr, str):
        return ""
    return addr.strip().lower()


def _load() -> dict[str, dict[str, Any]]:
    if not LINKED_FILE.exists():
        return {}
    try:
        with open(LINKED_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _save(data: dict[str, dict[str, Any]]) -> None:
    with open(LINKED_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_linked(starknet_address: str) -> dict[str, Any]:
    """
    Get linked addresses for a Starknet address.
    Returns dict with optional keys: eth, arb, base, opt, verified_at.
    """
    key = _normalize(starknet_address)
    if not key:
        return {}
    data = _load()
    return data.get(key, {}).copy()


def set_linked(
    starknet_address: str,
    eth: str | None = None,
    arb: str | None = None,
    base: str | None = None,
    opt: str | None = None,
    verified_at: str | None = None,
) -> dict[str, Any]:
    """
    Set linked addresses for a Starknet address.
    Omitted chain keys are left unchanged; pass empty string to clear.
    """
    key = _normalize(starknet_address)
    if not key:
        return {}
    data = _load()
    entry = data.get(key, {}).copy()
    if eth is not None:
        entry["eth"] = _normalize(eth) or None
    if arb is not None:
        entry["arb"] = _normalize(arb) or None
    if base is not None:
        entry["base"] = _normalize(base) or None
    if opt is not None:
        entry["opt"] = _normalize(opt) or None
    if verified_at is not None:
        entry["verified_at"] = verified_at
    # Drop None values for cleaner JSON
    entry = {k: v for k, v in entry.items() if v is not None}
    data[key] = entry
    _save(data)
    return get_linked(starknet_address)
