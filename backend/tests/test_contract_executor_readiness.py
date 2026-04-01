from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.contract_executor import ContractExecutor


def test_mainnet_readiness_defaults_to_preview(monkeypatch):
    monkeypatch.delenv("EXECUTOR_RPC_URL_MAINNET", raising=False)
    monkeypatch.delenv("EXECUTOR_ACCOUNT_PATH_MAINNET", raising=False)
    monkeypatch.delenv("EXECUTOR_PRIVATE_KEY_MAINNET", raising=False)
    monkeypatch.delenv("EXECUTOR_LIVE_SUBMIT_MAINNET", raising=False)

    executor = ContractExecutor()
    executor._starkli = None
    monkeypatch.setattr(executor, "_is_account_deployed", lambda cfg: False)

    readiness = executor.get_readiness("starknet_mainnet")

    assert readiness["network_id"] == "starknet_mainnet"
    assert readiness["live_submit_enabled"] is False
    assert readiness["account_configured"] is False
    assert readiness["private_key_configured"] is False
    assert readiness["account_deployed"] is False
    assert readiness["can_submit_live"] is False


def test_mainnet_readiness_uses_mainnet_env(monkeypatch):
    monkeypatch.setenv("EXECUTOR_RPC_URL_MAINNET", "https://starknet-mainnet.example")
    monkeypatch.setenv("EXECUTOR_ACCOUNT_PATH_MAINNET", "/tmp/mainnet-account.json")
    monkeypatch.setenv("EXECUTOR_PRIVATE_KEY_MAINNET", "0x123")
    monkeypatch.setenv("EXECUTOR_LIVE_SUBMIT_MAINNET", "true")

    executor = ContractExecutor()
    executor._starkli = "/usr/bin/starkli"
    monkeypatch.setattr(executor, "_is_account_deployed", lambda cfg: True)

    readiness = executor.get_readiness("starknet_mainnet")

    assert readiness["rpc_url"] == "https://starknet-mainnet.example"
    assert readiness["account_path"] == "/tmp/mainnet-account.json"
    assert readiness["live_submit_enabled"] is True
    assert readiness["starkli_available"] is True
    assert readiness["account_configured"] is True
    assert readiness["private_key_configured"] is True
    assert readiness["account_deployed"] is True
    assert readiness["can_submit_live"] is True


def test_mainnet_does_not_inherit_generic_executor_env(monkeypatch):
    monkeypatch.setenv("EXECUTOR_RPC_URL", "https://starknet-sepolia.example")
    monkeypatch.setenv("EXECUTOR_ACCOUNT_PATH", "/tmp/sepolia-account.json")
    monkeypatch.setenv("EXECUTOR_PRIVATE_KEY", "0x456")
    monkeypatch.setenv("EXECUTOR_LIVE_SUBMIT", "true")
    monkeypatch.delenv("EXECUTOR_RPC_URL_MAINNET", raising=False)
    monkeypatch.delenv("EXECUTOR_ACCOUNT_PATH_MAINNET", raising=False)
    monkeypatch.delenv("EXECUTOR_PRIVATE_KEY_MAINNET", raising=False)
    monkeypatch.delenv("EXECUTOR_LIVE_SUBMIT_MAINNET", raising=False)

    executor = ContractExecutor()
    executor._starkli = "/usr/bin/starkli"
    monkeypatch.setattr(executor, "_is_account_deployed", lambda cfg: False)

    readiness = executor.get_readiness("starknet_mainnet")

    assert readiness["rpc_url"] == ""
    assert readiness["account_path"] == ""
    assert readiness["live_submit_enabled"] is False
    assert readiness["account_configured"] is False
    assert readiness["private_key_configured"] is False
    assert readiness["account_deployed"] is False
    assert readiness["can_submit_live"] is False
