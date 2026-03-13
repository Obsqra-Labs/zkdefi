from __future__ import annotations

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "extract_ezkl_kzg_mpcheck_bundle.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("extract_ezkl_kzg_mpcheck_bundle_test", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_required_inputs(model_dir: Path) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "vk.key").write_text("vk")
    (model_dir / "settings.json").write_text("{}")
    (model_dir / "kzg.srs").write_text("srs")


@pytest.mark.asyncio
async def test_ensure_verifier_artifact_reuses_fresh_cache(tmp_path, monkeypatch):
    module = _load_module()
    model_dir = tmp_path / "model"
    build_dir = tmp_path / "build"
    _write_required_inputs(model_dir)

    artifact_path = build_dir / "out" / "Halo2Verifier.sol" / "Halo2Verifier.json"
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text("{}")

    fresh_time = artifact_path.stat().st_mtime + 100
    os.utime(artifact_path, (fresh_time, fresh_time))

    calls = {"create": 0, "run": 0}

    monkeypatch.setattr(
        module.ezkl,
        "create_evm_verifier",
        lambda *args, **kwargs: calls.__setitem__("create", calls["create"] + 1) or True,
    )
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *args, **kwargs: calls.__setitem__("run", calls["run"] + 1)
        or subprocess.CompletedProcess(args[0], 0, "", ""),
    )

    result = await module._ensure_verifier_artifact(
        model_dir=model_dir,
        build_dir=build_dir,
        force_rebuild=False,
    )

    assert result == artifact_path
    assert calls["create"] == 0
    assert calls["run"] == 0


@pytest.mark.asyncio
async def test_ensure_verifier_artifact_rebuilds_when_inputs_are_newer(tmp_path, monkeypatch):
    module = _load_module()
    model_dir = tmp_path / "model"
    build_dir = tmp_path / "build"
    _write_required_inputs(model_dir)

    artifact_path = build_dir / "out" / "Halo2Verifier.sol" / "Halo2Verifier.json"
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text("{}")

    stale_time = artifact_path.stat().st_mtime - 100
    os.utime(artifact_path, (stale_time, stale_time))
    fresh_time = artifact_path.stat().st_mtime + 200
    for req in (model_dir / "vk.key", model_dir / "settings.json", model_dir / "kzg.srs"):
        os.utime(req, (fresh_time, fresh_time))

    calls = {"create": 0, "run": 0}

    def _fake_create(*args, **kwargs):
        calls["create"] += 1
        return True

    def _fake_run(*args, **kwargs):
        calls["run"] += 1
        return subprocess.CompletedProcess(args[0], 0, "", "")

    monkeypatch.setattr(module.ezkl, "create_evm_verifier", _fake_create)
    monkeypatch.setattr(module.subprocess, "run", _fake_run)

    result = await module._ensure_verifier_artifact(
        model_dir=model_dir,
        build_dir=build_dir,
        force_rebuild=False,
    )

    assert result == artifact_path
    assert calls["create"] == 1
    assert calls["run"] == 1
