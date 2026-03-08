"""Capital OS trust version matrix and feature-flag helpers."""

from __future__ import annotations

import os
from typing import Any


TRUST_VERSION_MATRIX: dict[str, str] = {
    "builder_v2": "2.0",
    "profile_v2": "2.0",
    "portable_v3": "3.0",
    "zkfico_pack_v1": "1.0",
}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_bool_any(names: list[str], default: bool) -> bool:
    """Resolve first-present boolean env var from an alias list."""
    for name in names:
        raw = os.getenv(name)
        if raw is None:
            continue
        return str(raw).strip().lower() in {"1", "true", "yes", "on"}
    return default


def get_trust_version_matrix() -> dict[str, str]:
    """Return a copy of the canonical trust version matrix."""
    return dict(TRUST_VERSION_MATRIX)


def get_backend_trust_flags() -> dict[str, Any]:
    """Return backend trust-related feature flags as booleans."""
    return {
        "profile_v3_enabled": _env_bool("PROFILE_V3", True),
        "portable_identity_v3_enabled": _env_bool_any(
            ["PORTABLE_IDENTITY_V3", "PORTABLE_IDENTITY_V3_ENABLED"],
            True,
        ),
        "zkfico_finisher_enabled": _env_bool("ZKFICO_FINISHER", True),
        "trust_surface_wiring_enabled": _env_bool("TRUST_SURFACE_WIRING", True),
    }
