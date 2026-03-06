"""Tests for Ekubo Sepolia config."""
import os
import pytest


def test_ekubo_core_address_is_hex():
    from app.services.ekubo_config import EKUBO_CORE_SEPOLIA
    assert EKUBO_CORE_SEPOLIA.startswith("0x")
    assert len(EKUBO_CORE_SEPOLIA) == 66


def test_ekubo_chain_id_from_env_or_none():
    from app.services.ekubo_config import get_ekubo_chain_id
    # With no env set, may be None or default
    val = get_ekubo_chain_id()
    assert val is None or isinstance(val, str)
