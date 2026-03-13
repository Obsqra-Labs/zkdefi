#!/usr/bin/env python3
"""
Extract a real `kzg_mpcheck_bundle` from EZKL proof execution.

Flow:
1) Generate a model-matched Solidity verifier via `ezkl.create_evm_verifier`.
2) Compile it with Foundry (with stack-safe fallback).
3) Encode proof calldata via `ezkl.encode_evm_calldata`.
4) Run `debug_traceCall` against an ephemeral local Anvil node.
5) Parse bn256 pairing precompile input (address 0x08) and emit pair0/pair1.

The script prints JSON to stdout:
{
  "kzg_mpcheck_bundle": {
    "pair0": {"x":"0x..","y":"0x.."},
    "pair1": {"x":"0x..","y":"0x.."},
    "auto_build_hint": true
  }
}

It is designed to be used by `EZKL_KZG_BUNDLE_EXTRACTOR_CMD`.
The serializer already passes these env vars to the command:
  - EZKL_RAW_PROOF_JSON_PATH
  - EZKL_MODEL_NAME
  - EZKL_MODEL_DIR
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import ezkl
from web3 import Web3


BN254_FIELD_MODULUS = int(
    "30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47",
    16,
)


def _hex(value: int) -> str:
    return hex(int(value))


def _garaga_module_path() -> Path | None:
    module = (
        Path(__file__).resolve().parents[1]
        / "circuits"
        / "node_modules"
        / "garaga"
        / "dist"
        / "index.cjs"
    )
    return module if module.exists() else None


def _resolve_model_dir(model_name: str, model_dir: str) -> Path | None:
    if model_dir:
        p = Path(model_dir).expanduser().resolve()
        return p if p.exists() else None
    if model_name:
        p = (
            Path(__file__).resolve().parents[1]
            / "backend"
            / "app"
            / "data"
            / "ezkl_models"
            / model_name
        )
        return p if p.exists() else None
    return None


def _load_proof_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        raise RuntimeError(f"Failed to read proof json: {path}: {exc}") from exc


def _require_proof_fields(raw: dict[str, Any]) -> None:
    proof_hex = raw.get("hex_proof") or raw.get("proof")
    if not isinstance(proof_hex, str) or not proof_hex:
        raise RuntimeError("Proof JSON missing `hex_proof` (or string `proof`).")

    instances = raw.get("instances")
    if not isinstance(instances, list) or not instances or not isinstance(instances[0], list):
        raise RuntimeError("Proof JSON missing `instances` as nested list.")
    if not instances[0]:
        raise RuntimeError("Proof JSON `instances[0]` is empty.")


async def _maybe_await(result: Any) -> Any:
    if asyncio.isfuture(result):
        return await result
    return result


async def _ensure_verifier_artifact(
    *,
    model_dir: Path,
    build_dir: Path,
    force_rebuild: bool,
) -> Path:
    """
    Build `Halo2Verifier` artifact in `build_dir`.
    """
    src_dir = build_dir / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / "foundry.toml").write_text(
        '[profile.default]\n'
        'src = "src"\n'
        'out = "out"\n'
        'libs = ["lib"]\n'
        "optimizer = true\n"
        "optimizer_runs = 200\n"
    )

    artifact_path = build_dir / "out" / "Halo2Verifier.sol" / "Halo2Verifier.json"
    sol_path = src_dir / "Halo2Verifier.sol"
    abi_path = build_dir / "Halo2Verifier.abi"

    vk_path = model_dir / "vk.key"
    settings_path = model_dir / "settings.json"
    srs_path = model_dir / "kzg.srs"
    for req in (vk_path, settings_path, srs_path):
        if not req.exists():
            raise RuntimeError(f"Missing EZKL artifact required for extractor: {req}")

    if artifact_path.exists() and not force_rebuild:
        try:
            artifact_mtime = artifact_path.stat().st_mtime
            input_mtime = max(req.stat().st_mtime for req in (vk_path, settings_path, srs_path))
            if artifact_mtime >= input_mtime:
                return artifact_path
        except Exception:
            pass

    generated = await _maybe_await(
        ezkl.create_evm_verifier(
            str(vk_path),
            str(settings_path),
            str(sol_path),
            str(abi_path),
            srs_path=str(srs_path),
            reusable=False,
        )
    )
    if not generated:
        raise RuntimeError("ezkl.create_evm_verifier returned false.")

    first = subprocess.run(
        ["forge", "build"],
        cwd=str(build_dir),
        capture_output=True,
        text=True,
    )
    if first.returncode != 0:
        second = subprocess.run(
            [
                "bash",
                "-lc",
                "FOUNDRY_VIA_IR=false forge build --force --no-auto-detect --use 0.8.24",
            ],
            cwd=str(build_dir),
            capture_output=True,
            text=True,
        )
        if second.returncode != 0:
            out = "\n".join(
                [
                    "forge build failed (default + stack-safe fallback).",
                    "--- default stdout ---",
                    first.stdout[-4000:],
                    "--- default stderr ---",
                    first.stderr[-4000:],
                    "--- fallback stdout ---",
                    second.stdout[-4000:],
                    "--- fallback stderr ---",
                    second.stderr[-4000:],
                ]
            )
            raise RuntimeError(out)

    if not artifact_path.exists():
        raise RuntimeError(f"Expected verifier artifact missing: {artifact_path}")
    return artifact_path


async def _encode_calldata(proof_path: Path, out_path: Path) -> bytes:
    encoded = await _maybe_await(ezkl.encode_evm_calldata(str(proof_path), str(out_path)))
    if isinstance(encoded, (bytes, bytearray)) and encoded:
        return bytes(encoded)
    if out_path.exists():
        return out_path.read_bytes()
    raise RuntimeError("ezkl.encode_evm_calldata produced no bytes output.")


def _deploy_verifier(
    *,
    w3: Web3,
    artifact_path: Path,
    gas_limit: int,
) -> str:
    data = json.loads(artifact_path.read_text())
    bytecode = data.get("bytecode", {}).get("object") or ""
    if not bytecode:
        raise RuntimeError(f"Bytecode missing in {artifact_path}")
    if not str(bytecode).startswith("0x"):
        bytecode = "0x" + str(bytecode)

    account = w3.eth.accounts[0]
    tx_hash = w3.eth.send_transaction(
        {
            "from": account,
            "data": bytecode,
            "gas": gas_limit,
        }
    )
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    if not receipt.contractAddress:
        raise RuntimeError("Verifier deployment did not return contract address.")
    return receipt.contractAddress


def _collect_precompile_calls(trace_node: dict[str, Any]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []

    def walk(node: dict[str, Any]) -> None:
        to_addr = str(node.get("to") or "").lower()
        if to_addr == "0x0000000000000000000000000000000000000008":
            hits.append(node)
        for child in node.get("calls") or []:
            if isinstance(child, dict):
                walk(child)

    walk(trace_node)
    return hits


def _select_pairing_call(precompile_calls: list[dict[str, Any]]) -> dict[str, Any]:
    if not precompile_calls:
        raise RuntimeError("No bn256 pairing precompile calls found in trace.")

    def score(call: dict[str, Any]) -> tuple[int, int]:
        inp = str(call.get("input") or "")
        nbytes = (len(inp) - 2) // 2 if inp.startswith("0x") else 0
        is_2pair = 1 if nbytes == 384 else 0
        no_error = 1 if not call.get("error") else 0
        return (is_2pair, no_error)

    best = sorted(precompile_calls, key=score, reverse=True)[0]
    inp = str(best.get("input") or "")
    nbytes = (len(inp) - 2) // 2 if inp.startswith("0x") else 0
    if nbytes < 384:
        raise RuntimeError(
            f"Selected precompile input too short ({nbytes} bytes), need at least 384."
        )
    return best


def _decode_pairing_words(precompile_input_hex: str) -> list[int]:
    if not precompile_input_hex.startswith("0x"):
        raise RuntimeError("Precompile input is not hex.")
    raw = bytes.fromhex(precompile_input_hex[2:])
    if len(raw) % 32 != 0:
        raise RuntimeError("Precompile input has non-word-aligned byte length.")
    return [int.from_bytes(raw[i : i + 32], "big") for i in range(0, len(raw), 32)]


def _build_dynamic_mpcheck_hint_felts(
    *,
    pair0: tuple[int, int],
    pair1: tuple[int, int],
    g2_pair0_words: list[int],
    g2_pair1_words: list[int],
) -> tuple[list[int], str]:
    """
    Build MPCheck hint felts from traced dynamic pairings.

    The EVM pairing precompile words are encoded as:
      [x_im, x_re, y_im, y_re]
    while Garaga expects:
      [[x0=x_re, x1=x_im], [y0=y_re, y1=y_im]].
    """
    garaga_module = _garaga_module_path()
    if garaga_module is None:
        return [], "garaga_module_not_found"
    if len(g2_pair0_words) != 4 or len(g2_pair1_words) != 4:
        return [], "invalid_g2_words"

    payload = json.dumps(
        {
            "pair0": [str(pair0[0]), str(pair0[1])],
            "pair1": [str(pair1[0]), str(pair1[1])],
            "g2_pair0_words": [str(v) for v in g2_pair0_words],
            "g2_pair1_words": [str(v) for v in g2_pair1_words],
        }
    )
    js = r"""
const garaga = require(process.argv[1]);
const payload = JSON.parse(process.argv[2]);
const b = (v) => BigInt(v);
const toG2 = (words) => [
  [b(words[1]), b(words[0])],
  [b(words[3]), b(words[2])],
];

async function main() {
  await garaga.init();
  const p0 = [b(payload.pair0[0]), b(payload.pair0[1])];
  const p1 = [b(payload.pair1[0]), b(payload.pair1[1])];
  const g20 = toG2(payload.g2_pair0_words);
  const g21 = toG2(payload.g2_pair1_words);
  const out = garaga.mpcCalldataBuilder(garaga.CurveId.BN254, [[p0, g20], [p1, g21]], 0);
  console.log(JSON.stringify(out.map((x) => x.toString())));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
"""
    node_env = os.environ.copy()
    # PM2 injects NODE_CHANNEL_* IPC vars; child `node` processes can abort
    # when those descriptors are not valid in this context.
    for k in (
        "NODE_CHANNEL_FD",
        "NODE_CHANNEL_SERIALIZATION_MODE",
        "NODE_APP_INSTANCE",
        "PM2_HOME",
        "PM2_USAGE",
        "ELECTRON_RUN_AS_NODE",
    ):
        node_env.pop(k, None)
    try:
        proc = subprocess.run(
            ["node", "-e", js, str(garaga_module), payload],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
            env=node_env,
        )
        raw = json.loads(proc.stdout.strip() or "[]")
        return [int(v) for v in raw], ""
    except Exception as exc:
        return [], str(exc)


def _build_bundle_from_words(
    words: list[int], negate_second_pair: bool
) -> tuple[dict[str, Any], dict[str, Any]]:
    if len(words) < 12:
        raise RuntimeError(f"Expected >=12 words for 2-pair input, got {len(words)}.")

    pair0_raw = (words[0], words[1])
    pair1_raw = (words[6], words[7])
    pair0_neg = (pair0_raw[0], (BN254_FIELD_MODULUS - pair0_raw[1]) % BN254_FIELD_MODULUS)
    pair1_neg = (pair1_raw[0], (BN254_FIELD_MODULUS - pair1_raw[1]) % BN254_FIELD_MODULUS)

    g2_pair0_words = [_hex(words[2]), _hex(words[3]), _hex(words[4]), _hex(words[5])]
    g2_pair1_words = [_hex(words[8]), _hex(words[9]), _hex(words[10]), _hex(words[11])]

    g2_pair0 = {
        "x0": _hex(words[3]),
        "x1": _hex(words[2]),
        "y0": _hex(words[5]),
        "y1": _hex(words[4]),
    }
    g2_pair1 = {
        "x0": _hex(words[9]),
        "x1": _hex(words[8]),
        "y0": _hex(words[11]),
        "y1": _hex(words[10]),
    }

    # Try sign variants and keep the first one that yields a valid dynamic hint.
    preferred_variants = [
        ("pair0_raw_pair1_neg", pair0_raw, pair1_neg),
        ("pair0_raw_pair1_raw", pair0_raw, pair1_raw),
        ("pair0_neg_pair1_raw", pair0_neg, pair1_raw),
        ("pair0_neg_pair1_neg", pair0_neg, pair1_neg),
    ]
    if not negate_second_pair:
        preferred_variants = [
            ("pair0_raw_pair1_raw", pair0_raw, pair1_raw),
            ("pair0_raw_pair1_neg", pair0_raw, pair1_neg),
            ("pair0_neg_pair1_raw", pair0_neg, pair1_raw),
            ("pair0_neg_pair1_neg", pair0_neg, pair1_neg),
        ]

    chosen_variant = preferred_variants[0][0]
    chosen_pair0 = preferred_variants[0][1]
    chosen_pair1 = preferred_variants[0][2]
    dynamic_hint: list[int] = []
    dynamic_hint_error = ""
    for variant_name, p0, p1 in preferred_variants:
        candidate, hint_error = _build_dynamic_mpcheck_hint_felts(
            pair0=p0,
            pair1=p1,
            g2_pair0_words=words[2:6],
            g2_pair1_words=words[8:12],
        )
        if candidate:
            chosen_variant = variant_name
            chosen_pair0 = p0
            chosen_pair1 = p1
            dynamic_hint = candidate
            dynamic_hint_error = ""
            break
        if hint_error:
            dynamic_hint_error = hint_error

    bundle = {
        "kzg_mpcheck_bundle": {
            "pair0": {"x": _hex(chosen_pair0[0]), "y": _hex(chosen_pair0[1])},
            "pair1": {"x": _hex(chosen_pair1[0]), "y": _hex(chosen_pair1[1])},
            "g2_pair0": g2_pair0,
            "g2_pair1": g2_pair1,
            "auto_build_hint": True,
        }
    }
    if dynamic_hint:
        bundle["kzg_mpcheck_bundle"]["mpcheck_hint_felts"] = [str(v) for v in dynamic_hint]
        bundle["kzg_mpcheck_bundle"]["auto_build_hint"] = False
        bundle["kzg_mpcheck_bundle"]["hint_source"] = "garaga_dynamic_pairs"
    elif dynamic_hint_error:
        bundle["kzg_mpcheck_bundle"]["hint_error"] = dynamic_hint_error
    meta = {
        "negated_second_pair": negate_second_pair,
        "selected_sign_variant": chosen_variant,
        "g2_pair0_words": g2_pair0_words,
        "g2_pair1_words": g2_pair1_words,
        "dynamic_hint_felts": len(dynamic_hint),
        "dynamic_hint_error": dynamic_hint_error,
        "pair0_raw": {"x": _hex(pair0_raw[0]), "y": _hex(pair0_raw[1])},
        "pair1_raw": {"x": _hex(pair1_raw[0]), "y": _hex(pair1_raw[1])},
        "pair0_selected": {"x": _hex(chosen_pair0[0]), "y": _hex(chosen_pair0[1])},
        "pair1_selected": {"x": _hex(chosen_pair1[0]), "y": _hex(chosen_pair1[1])},
    }
    return bundle, meta


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract EZKL KZG mpcheck bundle by tracing verifier pairing precompile."
    )
    parser.add_argument(
        "--proof-json",
        default=(os.getenv("EZKL_RAW_PROOF_JSON_PATH") or "").strip(),
        help="Path to EZKL proof JSON (default: EZKL_RAW_PROOF_JSON_PATH).",
    )
    parser.add_argument(
        "--model-name",
        default=(os.getenv("EZKL_MODEL_NAME") or "").strip(),
        help="Model name for resolving backend/app/data/ezkl_models/<model>.",
    )
    parser.add_argument(
        "--model-dir",
        default=(os.getenv("EZKL_MODEL_DIR") or "").strip(),
        help="Explicit EZKL model artifact dir (vk/settings/srs).",
    )
    parser.add_argument(
        "--cache-dir",
        default="",
        help="Optional build cache dir; defaults to <model_dir>/.kzg_trace_verifier.",
    )
    parser.add_argument(
        "--anvil-port",
        type=int,
        default=8547,
        help="Local Anvil port used for trace run.",
    )
    parser.add_argument(
        "--gas-limit",
        type=int,
        default=30_000_000,
        help="Gas limit for deploy/trace calls.",
    )
    parser.add_argument(
        "--force-rebuild",
        action="store_true",
        help="Force regenerating and rebuilding verifier artifact.",
    )
    parser.add_argument(
        "--no-negate-second-pair",
        action="store_true",
        help=(
            "Do not negate second G1 point extracted from the EVM pairing call. "
            "Default behavior negates second pair to normalize e(P, -sG2) -> e(-P, sG2)."
        ),
    )
    parser.add_argument(
        "--out",
        default="",
        help="Optional path to also write output JSON.",
    )
    parser.add_argument(
        "--debug-meta",
        action="store_true",
        help="Print extractor metadata to stderr.",
    )
    return parser.parse_args()


async def _run() -> int:
    args = _parse_args()

    if not args.proof_json:
        raise RuntimeError("Missing proof path. Set --proof-json or EZKL_RAW_PROOF_JSON_PATH.")
    proof_path = Path(args.proof_json).expanduser().resolve()
    if not proof_path.exists():
        raise RuntimeError(f"Proof path does not exist: {proof_path}")

    model_dir = _resolve_model_dir(args.model_name, args.model_dir)
    if model_dir is None:
        raise RuntimeError(
            "Model dir not found. Set --model-dir or provide --model-name with local artifacts."
        )

    raw_proof = _load_proof_json(proof_path)
    _require_proof_fields(raw_proof)

    cache_dir = (
        Path(args.cache_dir).expanduser().resolve()
        if args.cache_dir
        else (model_dir / ".kzg_trace_verifier")
    )
    cache_dir.mkdir(parents=True, exist_ok=True)

    artifact_path = await _ensure_verifier_artifact(
        model_dir=model_dir,
        build_dir=cache_dir,
        force_rebuild=bool(args.force_rebuild),
    )

    with tempfile.TemporaryDirectory(prefix="kzg-trace-") as td:
        calldata_path = Path(td) / "encoded_calldata.bin"
        calldata_bytes = await _encode_calldata(proof_path, calldata_path)
        calldata_hex = "0x" + calldata_bytes.hex()

        anvil_cmd = ["anvil", "--port", str(args.anvil_port), "--silent"]
        anvil_proc = subprocess.Popen(
            anvil_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            rpc_url = f"http://127.0.0.1:{args.anvil_port}"
            w3 = Web3(Web3.HTTPProvider(rpc_url))
            for _ in range(80):
                if w3.is_connected():
                    break
                time.sleep(0.1)
            if not w3.is_connected():
                raise RuntimeError(f"Failed to connect to local Anvil at {rpc_url}")

            contract_address = _deploy_verifier(
                w3=w3,
                artifact_path=artifact_path,
                gas_limit=args.gas_limit,
            )
            from_addr = w3.eth.accounts[0]

            trace_resp = w3.provider.make_request(
                "debug_traceCall",
                [
                    {
                        "to": contract_address,
                        "from": from_addr,
                        "data": calldata_hex,
                        "gas": hex(args.gas_limit),
                    },
                    "latest",
                    {"tracer": "callTracer", "tracerConfig": {"onlyTopCall": False}},
                ],
            )
            if "error" in trace_resp:
                raise RuntimeError(f"debug_traceCall failed: {trace_resp['error']}")
            trace = trace_resp.get("result") or {}
            precompile_calls = _collect_precompile_calls(trace)
            selected = _select_pairing_call(precompile_calls)
            words = _decode_pairing_words(str(selected.get("input") or ""))
        finally:
            anvil_proc.terminate()
            try:
                anvil_proc.wait(timeout=3)
            except Exception:
                anvil_proc.kill()

    negate_second_pair = not bool(args.no_negate_second_pair)
    bundle, meta = _build_bundle_from_words(words, negate_second_pair=negate_second_pair)
    bundle["kzg_mpcheck_bundle"]["source"] = "evm_trace_precompile_0x08"
    bundle["kzg_mpcheck_bundle"]["trace"] = {
        "precompile_calls_seen": len(precompile_calls),
        "selected_input_bytes": (len(str(selected.get("input") or "")) - 2) // 2,
        "negated_second_pair": meta["negated_second_pair"],
    }

    out_text = json.dumps(bundle)
    if args.out:
        out_path = Path(args.out).expanduser().resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(bundle, indent=2))

    if args.debug_meta:
        debug_payload = {
            "model_dir": str(model_dir),
            "artifact_path": str(artifact_path),
            "bundle_meta": meta,
        }
        print(json.dumps(debug_payload, indent=2), file=sys.stderr)

    print(out_text)
    return 0


def main() -> int:
    try:
        return asyncio.run(_run())
    except Exception as exc:
        print(f"extract_ezkl_kzg_mpcheck_bundle: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
