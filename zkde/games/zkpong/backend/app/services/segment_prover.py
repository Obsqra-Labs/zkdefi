"""
Build segment trace; call STARK (e.g. Stone) or SNARK (Garaga) per segment.
Stub: returns proof_hash and optional proof_calldata for on-chain verify.
"""
import hashlib
from typing import List, Optional

from app.schemas.segment import Segment
from app.services.receipt_builder import build_segment_receipt


def hash_trace(trace: list) -> str:
    """Commitment over segment trace for action_commit."""
    payload = b""
    for step in trace:
        for k, v in sorted(step.items()):
            if isinstance(v, int):
                payload += v.to_bytes(8, "big")
            elif isinstance(v, str):
                payload += v.encode("utf-8")[:32].ljust(32, b"\0")
    return hashlib.sha256(payload).hexdigest()


def prove_segment(segment: Segment) -> tuple:
    """
    Generate proof for segment. Returns (proof_hash, proof_calldata or None).
    Stub: proof_hash = hash(segment); proof_calldata = None.
    """
    payload = (
        segment.session_id.encode("utf-8")
        + segment.segment_id.to_bytes(8, "big")
        + segment.pre_state_hash.encode("utf-8")
        + segment.post_state_hash.encode("utf-8")
        + segment.action_commit.encode("utf-8")
    )
    for step in segment.trace:
        payload += str(sorted(step.items())).encode("utf-8")
    proof_hash = hashlib.sha256(payload).hexdigest()
    proof_calldata = None
    return proof_hash, proof_calldata


def build_segment_receipt_with_proof(
    session_id: str,
    segment_id: int,
    pre_state_hash: str,
    post_state_hash: str,
    trace: list,
) -> tuple:
    """Build segment, prove it, return receipt + proof_hash + proof_calldata."""
    action_commit = hash_trace(trace)
    segment = Segment(
        session_id=session_id,
        segment_id=segment_id,
        rally_start=trace[0].get("rally_id", 0) if trace else 0,
        rally_end=trace[-1].get("rally_id", 0) if trace else 0,
        pre_state_hash=pre_state_hash,
        post_state_hash=post_state_hash,
        action_commit=action_commit,
        trace=trace,
    )
    proof_hash, proof_calldata = prove_segment(segment)
    receipt = build_segment_receipt(
        session_id=session_id,
        segment_id=segment_id,
        pre_state_hash=pre_state_hash,
        post_state_hash=post_state_hash,
        action_commit=action_commit,
        proof_hash=proof_hash,
    )
    return receipt, proof_hash, proof_calldata
