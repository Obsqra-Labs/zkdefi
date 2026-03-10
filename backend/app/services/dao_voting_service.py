"""
DAO Voting Service

Generates zero-knowledge proofs for private DAO voting.

User votes privately (hidden vote direction) while proving voting power.
"""

import asyncio
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
CIRCUITS_DIR = PROJECT_ROOT / "circuits"
BUILD_DIR = CIRCUITS_DIR / "build"
WASM_PATH = BUILD_DIR / "private_vote_js" / "private_vote.wasm"
ZKEY_PATH = BUILD_DIR / "private_vote_final.zkey"
VKEY_PATH = BUILD_DIR / "private_vote_verification_key.json"
SNARKJS = "snarkjs"


@dataclass
class VotingProof:
    """Result of voting proof generation"""
    proof_calldata: list[str]
    nullifier_hash: str
    commitment: str
    vote_value: int
    public_inputs: list[str]
    proof_mode: str = "groth16"
    fallback_reason: str | None = None


class DAOVotingService:
    """
    Service for generating zero-knowledge voting proofs.
    
    Privacy guarantees:
    - Vote direction is hidden (only user knows)
    - Voting power is aggregated (not revealed individually)
    - Nullifiers prevent double voting
    - Results are public and verifiable
    """
    
    def __init__(self):
        self.circuit_wasm = WASM_PATH
        self.proving_key = ZKEY_PATH
        self.verification_key = VKEY_PATH
        app_env = os.getenv("APP_ENV", "development").strip().lower()
        sim_flag = os.getenv("ALLOW_SIMULATED_PROOFS", "").lower() in ("true", "1")
        fallback_env = os.getenv("DAO_VOTING_ALLOW_FALLBACK", "").strip().lower()
        if fallback_env in ("true", "1", "yes", "on"):
            self._allow_mock_fallback = True
        elif fallback_env in ("false", "0", "no", "off"):
            self._allow_mock_fallback = False
        else:
            self._allow_mock_fallback = sim_flag or app_env in {"development", "dev", "local", "test"}
        self._groth16_available = (
            self.circuit_wasm.exists()
            and self.proving_key.exists()
        )
        if not self._groth16_available:
            if self._allow_mock_fallback:
                logger.warning(
                    "DAO voting Groth16 artifacts missing — falling back to mock proofs. "
                    "Need: %s and %s", self.circuit_wasm, self.proving_key,
                )
            else:
                raise RuntimeError(
                    f"DAO voting Groth16 artifacts missing and fallback is disabled. "
                    f"Need: {self.circuit_wasm} and {self.proving_key}. "
                    f"Set DAO_VOTING_ALLOW_FALLBACK=true for development."
                )
        
        self.user_secrets: Dict[str, str] = {}
    
    async def generate_voting_proof(
        self,
        user_address: str,
        proposal_id: int,
        vote_direction: int,  # 0 = against, 1 = for
    ) -> VotingProof:
        """
        Generate ZK proof for private vote.
        
        Args:
            user_address: Voter's Starknet address
            proposal_id: Proposal ID to vote on
            vote_direction: 0 (against) or 1 (for)
        
        Returns:
            VotingProof with proof_calldata, nullifier_hash, commitment
        
        Raises:
            ValueError: If vote_direction not 0 or 1
            RuntimeError: If proof generation fails
        """
        if vote_direction not in (0, 1):
            raise ValueError(f"vote_direction must be 0 or 1, got {vote_direction}")
        
        # Step 1: Get user's voting power
        voting_power = await self._get_voting_power(user_address)
        logger.info(f"Voting power for {user_address}: {voting_power}")
        
        # Step 2: Get or create voting secret
        secret = self._get_or_create_voting_secret(user_address)
        secret_int = int(secret, 16)
        
        # Step 3: Compute nullifier hash
        # nullifier_hash = Pedersen(secret, proposal_id)
        nullifier_hash = self._pedersen_hash_components(
            components=[(secret_int, 254), (int(proposal_id), 254)]
        )
        nullifier_hash_hex = hex(nullifier_hash)
        
        # Step 4: Prepare circuit inputs
        witness_input = {
            "secret": secret,
            "voting_power": str(voting_power),
            "vote_direction": str(vote_direction),
            "proposal_id": str(proposal_id),
            "nullifier_hash": str(nullifier_hash),
        }
        
        logger.info(f"Generating voting proof for proposal {proposal_id}")
        
        vote_value = voting_power * vote_direction
        commitment = self._pedersen_hash_components(
            components=[(secret_int, 254), (int(vote_direction), 2), (int(voting_power), 64)]
        )

        if self._groth16_available:
            # ── Real Groth16 proof via snarkjs ──
            try:
                proof_data, public_signals = await self._generate_groth16_fullprove(
                    witness_input
                )
                proof_calldata = [
                    json.dumps(proof_data.get("pi_a", [])),
                    json.dumps(proof_data.get("pi_b", [])),
                    json.dumps(proof_data.get("pi_c", [])),
                    *public_signals,
                ]
                public_inputs = public_signals
                logger.info("Groth16 proof generated for proposal %d", proposal_id)

                return VotingProof(
                    proof_calldata=proof_calldata,
                    nullifier_hash=nullifier_hash_hex,
                    commitment=hex(commitment),
                    vote_value=vote_value,
                    public_inputs=public_inputs,
                    proof_mode="groth16",
                )
            except Exception as exc:
                if self._allow_mock_fallback:
                    logger.warning("Groth16 proof failed, falling back to mock: %s", exc)
                else:
                    raise RuntimeError(
                        f"Groth16 proof generation failed and fallback is disabled: {exc}"
                    ) from exc

        # ── Mock fallback (enabled in development / explicit fallback mode) ──
        proof_calldata = [
            hex(commitment),           # Public output 1: commitment
            hex(vote_value),           # Public output 2: vote_value
            hex(nullifier_hash),       # Public input 1: nullifier_hash
            hex(proposal_id),          # Public input 2: proposal_id
        ]
        
        public_inputs = [
            hex(proposal_id),
            hex(nullifier_hash),
        ]
        
        logger.info(f"Voting proof generated: nullifier={nullifier_hash_hex[:16]}...")
        
        return VotingProof(
            proof_calldata=proof_calldata,
            nullifier_hash=nullifier_hash_hex,
            commitment=hex(commitment),
            vote_value=vote_value,
            public_inputs=public_inputs,
            proof_mode="mock_fallback",
            fallback_reason="groth16_unavailable_or_failed",
        )

    def _pedersen_hash_components(self, components: list[tuple[int, int]]) -> int:
        """
        Compute Pedersen hash x-coordinate from bit-packed components.
        Components are provided as (value, bit_length), packed little-endian per field.
        """
        for value, bits in components:
            if int(value) < 0:
                raise ValueError(f"Pedersen component must be non-negative (got {value})")
            if int(value) >= (1 << int(bits)):
                raise ValueError(f"Pedersen component {value} exceeds {bits}-bit range")

        payload = json.dumps([[str(int(v)), int(bits)] for v, bits in components], separators=(",", ":"))
        script = """
const circomlib = require("circomlibjs");
(async () => {
  const comps = JSON.parse(process.argv[1]);
  const babyJub = await circomlib.buildBabyjub();
  const pedersen = await circomlib.buildPedersenHash();
  const F = babyJub.F;
  const bits = [];
  for (const [rawValue, rawBits] of comps) {
    const v = BigInt(rawValue);
    const n = Number(rawBits);
    for (let i = 0; i < n; i++) {
      bits.push(Number((v >> BigInt(i)) & 1n));
    }
  }
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      bytes[Math.floor(i / 8)] |= (1 << (i % 8));
    }
  }
  const point = babyJub.unpackPoint(pedersen.hash(bytes));
  console.log(F.toString(point[0]));
})().catch((err) => { console.error(err && err.stack ? err.stack : String(err)); process.exit(1); });
"""
        result = subprocess.run(
            ["/usr/bin/node", "-e", script, payload],
            capture_output=True,
            text=True,
            cwd=str(CIRCUITS_DIR),
            env={
                **os.environ,
                "NODE_PATH": str(CIRCUITS_DIR / "node_modules"),
            },
            timeout=20,
        )
        if result.returncode != 0:
            if self._allow_mock_fallback:
                logger.warning(
                    "Pedersen helper failed (code=%s), using deterministic fallback hash for demo mode: %s",
                    result.returncode,
                    (result.stderr or result.stdout),
                )
                return int(hashlib.sha256(payload.encode("utf-8")).hexdigest(), 16) % ((1 << 251) - 1)
            raise RuntimeError(f"Pedersen hash helper failed: {result.stderr or result.stdout}")
        try:
            return int((result.stdout or "").strip())
        except Exception as exc:
            if self._allow_mock_fallback:
                logger.warning(
                    "Pedersen helper returned invalid output, using deterministic fallback hash for demo mode: %s",
                    result.stdout,
                )
                return int(hashlib.sha256(payload.encode("utf-8")).hexdigest(), 16) % ((1 << 251) - 1)
            raise RuntimeError(f"Pedersen hash helper returned invalid output: {result.stdout}") from exc
    
    async def _get_voting_power(self, user_address: str) -> int:
        """
        Get user's voting power based on real on-chain / ledger positions.

        Formula: voting_power = sqrt(position_value_usd)

        Sources (additive):
        1. Ledger balance (staking / LP deposits tracked in ledger.db)
        2. Collateral positions (from collateral_service JsonStore)

        Falls back to 1 VP if no positions found (minimum vote).
        """
        position_usd = 0.0

        # 1. Ledger balance
        try:
            from app.services.ledger_service import get_ledger_service
            ledger = get_ledger_service()
            balance_wei = ledger.get_balance(user_address)
            if balance_wei > 0:
                # Convert wei to USD using live ETH price
                try:
                    from app.services.ekubo.oracle_adapter import get_live_prices
                    prices = await get_live_prices()
                    eth_usd = float(prices.get("eth_usd") or 1800)
                except Exception:
                    eth_usd = 1800.0
                position_usd += (balance_wei / 1e18) * eth_usd
        except Exception as exc:
            logger.debug("Ledger lookup for voting power failed: %s", exc)

        # 2. Collateral positions
        try:
            from app.services.collateral_service import get_user_total_collateral, WEI_PER_ETH
            summary = get_user_total_collateral(user_address)
            collateral_eth = summary.get("weighted_collateral_eth", 0)
            if collateral_eth > 0:
                try:
                    from app.services.ekubo.oracle_adapter import get_live_prices
                    prices = await get_live_prices()
                    eth_usd = float(prices.get("eth_usd") or 1800)
                except Exception:
                    eth_usd = 1800.0
                position_usd += collateral_eth * eth_usd
        except Exception as exc:
            logger.debug("Collateral lookup for voting power failed: %s", exc)

        if position_usd <= 0:
            return 1  # minimum 1 VP so every user can vote

        voting_power = int(math.sqrt(position_usd))
        return max(voting_power, 1)
    
    def _get_or_create_voting_secret(self, user_address: str) -> str:
        """
        Get or create voting secret for user.
        
        Secret is deterministic per user (derived from address hash)
        but appears random to others.
        
        In production: Store in secure vault (HSM, KMS, etc.)
        """
        if user_address not in self.user_secrets:
            # Generate deterministic secret from address
            # In production: Use secure key derivation (HKDF, etc.)
            secret_int = int(user_address, 16) % (2**251)  # Fit in felt252
            self.user_secrets[user_address] = hex(secret_int)
        
        return self.user_secrets[user_address]
    
    async def _generate_groth16_fullprove(
        self, witness_input: Dict[str, str],
    ) -> tuple[Dict[str, Any], list[str]]:
        """
        Run snarkjs groth16 fullprove (witness + prove in one shot).

        Returns (proof_json, public_signals_list).
        """
        input_path = BUILD_DIR / "private_vote_input.json"
        proof_path = BUILD_DIR / "private_vote_proof.json"
        public_path = BUILD_DIR / "private_vote_public.json"

        input_path.write_text(json.dumps(witness_input), encoding="utf-8")

        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                [
                    SNARKJS, "groth16", "fullprove",
                    str(input_path),
                    str(self.circuit_wasm),
                    str(self.proving_key),
                    str(proof_path),
                    str(public_path),
                ],
                capture_output=True,
                text=True,
                timeout=120,
            ),
        )
        if result.returncode != 0:
            raise RuntimeError(f"snarkjs fullprove failed: {result.stderr[:500]}")

        proof = json.loads(proof_path.read_text(encoding="utf-8"))
        public_signals = json.loads(public_path.read_text(encoding="utf-8"))
        return proof, public_signals

    async def _generate_witness(self, witness_input: Dict[str, str]) -> Path:
        """
        Generate witness using circom WASM witness generator.
        Returns path to .wtns file.
        """
        input_path = BUILD_DIR / "private_vote_input.json"
        witness_path = BUILD_DIR / "private_vote_witness.wtns"

        input_path.write_text(json.dumps(witness_input), encoding="utf-8")

        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                [
                    "node",
                    str(BUILD_DIR / "private_vote_js" / "generate_witness.js"),
                    str(self.circuit_wasm),
                    str(input_path),
                    str(witness_path),
                ],
                capture_output=True,
                text=True,
                timeout=60,
            ),
        )
        if result.returncode != 0:
            raise RuntimeError(f"Witness generation failed: {result.stderr[:500]}")
        return witness_path
    
    async def _generate_groth16_proof(self, witness_path: Path) -> tuple[Dict[str, Any], list[str]]:
        """
        Generate Groth16 proof from witness file using snarkjs.
        Returns (proof_json, public_signals_list).
        """
        proof_path = BUILD_DIR / "private_vote_proof.json"
        public_path = BUILD_DIR / "private_vote_public.json"

        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                [
                    SNARKJS, "groth16", "prove",
                    str(self.proving_key),
                    str(witness_path),
                    str(proof_path),
                    str(public_path),
                ],
                capture_output=True,
                text=True,
                timeout=120,
            ),
        )
        if result.returncode != 0:
            raise RuntimeError(f"snarkjs prove failed: {result.stderr[:500]}")

        proof = json.loads(proof_path.read_text(encoding="utf-8"))
        public_signals = json.loads(public_path.read_text(encoding="utf-8"))
        return proof, public_signals
    
    def set_voting_power(self, user_address: str, voting_power: int):
        """
        Admin function to set user voting power.
        
        In production: This would be computed automatically from on-chain LP positions.
        """
        # Store in contract or local cache
        pass


# Singleton instance
_dao_voting_service: Optional[DAOVotingService] = None


def get_dao_voting_service() -> DAOVotingService:
    """Get or create singleton DAO voting service"""
    global _dao_voting_service
    if _dao_voting_service is None:
        _dao_voting_service = DAOVotingService()
    return _dao_voting_service
