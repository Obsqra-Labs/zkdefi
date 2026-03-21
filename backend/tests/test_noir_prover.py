from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.services import noir_prover


def test_generate_noir_ezkl_bridge_proof_uses_isolated_workspace(monkeypatch, tmp_path: Path):
    source_pkg = tmp_path / "noir_ezkl_bridge"
    (source_pkg / "src").mkdir(parents=True)
    (source_pkg / "Nargo.toml").write_text("[package]\nname = 'noir_ezkl_bridge'\n", encoding="utf-8")
    (source_pkg / "src" / "main.nr").write_text("fn main() {}", encoding="utf-8")

    monkeypatch.setattr(noir_prover, "NOIR_PKG", source_pkg)
    monkeypatch.setattr(noir_prover, "_has_nargo", lambda: True)
    monkeypatch.setattr(noir_prover, "_has_bb", lambda: True)
    monkeypatch.setattr(noir_prover, "_has_garaga", lambda: True)

    def fake_run(args, cwd=None, env=None, capture_output=None, text=None, timeout=None, check=False):
        workdir = Path(cwd)
        target = workdir / "target"
        target.mkdir(exist_ok=True)
        cmd = list(args)
        if cmd[:2] == ["nargo", "compile"]:
            (target / "noir_ezkl_bridge.json").write_text("{}", encoding="utf-8")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:3] == ["nargo", "execute", "witness"]:
            (target / "witness.gz").write_bytes(b"witness")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:2] == ["bb", "write_vk"]:
            vk_dir = target / "vk"
            vk_dir.mkdir(exist_ok=True)
            (vk_dir / "vk").write_bytes(b"vk")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:2] == ["bb", "prove"]:
            (target / "proof").write_bytes(b"proof")
            (target / "public_inputs").write_bytes(b"public")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:2] == ["garaga", "calldata"]:
            return SimpleNamespace(returncode=0, stdout="0x1 2 0x3", stderr="")
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr(noir_prover.subprocess, "run", fake_run)

    result = noir_prover.generate_noir_ezkl_bridge_proof(
        expected_model_hash=123,
        output_lower_bound=0,
        output_upper_bound=10000,
        model_output=42,
    )

    assert result["success"] is True
    assert result["proof_calldata"] == [1, 2, 3]
    assert not (source_pkg / "target").exists()
    prover_toml = source_pkg / "Prover.toml"
    assert not prover_toml.exists()


def test_generate_noir_ezkl_bridge_proof_retries_transient_failure(monkeypatch, tmp_path: Path):
    source_pkg = tmp_path / "noir_ezkl_bridge"
    (source_pkg / "src").mkdir(parents=True)
    (source_pkg / "Nargo.toml").write_text("[package]\nname = 'noir_ezkl_bridge'\n", encoding="utf-8")
    (source_pkg / "src" / "main.nr").write_text("fn main() {}", encoding="utf-8")

    monkeypatch.setattr(noir_prover, "NOIR_PKG", source_pkg)
    monkeypatch.setattr(noir_prover, "_has_nargo", lambda: True)
    monkeypatch.setattr(noir_prover, "_has_bb", lambda: True)
    monkeypatch.setattr(noir_prover, "_has_garaga", lambda: True)
    monkeypatch.setattr(noir_prover.time, "sleep", lambda _s: None)

    attempts = {"garaga": 0}

    def fake_run(args, cwd=None, env=None, capture_output=None, text=None, timeout=None, check=False):
        workdir = Path(cwd)
        target = workdir / "target"
        target.mkdir(exist_ok=True)
        cmd = list(args)
        if cmd[:2] == ["nargo", "compile"]:
            (target / "noir_ezkl_bridge.json").write_text("{}", encoding="utf-8")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:3] == ["nargo", "execute", "witness"]:
            (target / "witness.gz").write_bytes(b"witness")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:2] == ["bb", "write_vk"]:
            vk_dir = target / "vk"
            vk_dir.mkdir(exist_ok=True)
            (vk_dir / "vk").write_bytes(b"vk")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:2] == ["bb", "prove"]:
            (target / "proof").write_bytes(b"proof")
            (target / "public_inputs").write_bytes(b"public")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if cmd[:2] == ["garaga", "calldata"]:
            attempts["garaga"] += 1
            if attempts["garaga"] == 1:
                return SimpleNamespace(returncode=1, stdout="", stderr="transient")
            return SimpleNamespace(returncode=0, stdout="0x4 5 0x6", stderr="")
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr(noir_prover.subprocess, "run", fake_run)

    result = noir_prover.generate_noir_ezkl_bridge_proof(
        expected_model_hash=123,
        output_lower_bound=0,
        output_upper_bound=10000,
        model_output=42,
    )

    assert result["success"] is True
    assert result["proof_calldata"] == [4, 5, 6]
    assert attempts["garaga"] == 2
