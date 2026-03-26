"""
sepolia-mm — talk to the market-maker-sim API from your terminal.

  sepolia-mm health
  sepolia-mm get public/state
  sepolia-mm get public/pools --pretty
  sepolia-mm urls
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


def _base_url() -> str:
    return os.environ.get("SEPOLIA_MM_URL", "http://127.0.0.1:8099").rstrip("/")


def _request_json(method: str, path: str, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    url = f"{_base_url()}{path if path.startswith('/') else '/' + path}"
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            if not raw:
                return resp.status, None
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(body) if body else {"detail": str(e)}
        except json.JSONDecodeError:
            return e.code, {"detail": body or str(e)}


def cmd_health(_: argparse.Namespace) -> int:
    code, data = _request_json("GET", "/health")
    if code != 200:
        print(json.dumps(data, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(data, indent=2))
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    path = args.path
    if not path.startswith("/"):
        path = "/" + path
    code, data = _request_json("GET", path)
    if args.pretty:
        print(json.dumps(data, indent=2))
    else:
        print(json.dumps(data, separators=(",", ":")))
    return 0 if code == 200 else 1


def cmd_urls(_: argparse.Namespace) -> int:
    base = _base_url()
    lines = [
        f"API base:     {base}",
        f"OpenAPI:      {base}/docs",
        f"Health:       {base}/health",
        f"State:        {base}/public/state",
        f"Pools:        {base}/public/pools",
        f"WebSocket:    {base.replace('http', 'ws')}/ws/public",
        "",
        "Override base with SEPOLIA_MM_URL=https://your-host:8099",
    ]
    print("\n".join(lines))
    return 0


def cmd_version(_: argparse.Namespace) -> int:
    from sepolia_mm import __version__

    print(f"sepolia-mm {__version__}  (Obsqra Sepolia tooling)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sepolia-mm",
        description="CLI for Starknet Sepolia Ekubo market-maker-sim HTTP API",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_health = sub.add_parser("health", help="GET /health")
    p_health.set_defaults(func=cmd_health)

    p_get = sub.add_parser("get", help="GET any path, e.g. public/state")
    p_get.add_argument("path", help="Path such as public/state or /public/pools")
    p_get.add_argument("--pretty", action="store_true", help="Indent JSON")
    p_get.set_defaults(func=cmd_get)

    p_urls = sub.add_parser("urls", help="Print useful URLs for current SEPOLIA_MM_URL")
    p_urls.set_defaults(func=cmd_urls)

    p_ver = sub.add_parser("version", help="Print CLI version")
    p_ver.set_defaults(func=cmd_version)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
