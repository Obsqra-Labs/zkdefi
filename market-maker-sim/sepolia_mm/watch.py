"""Stream /ws/public with optional ANSI deltas (sepolia-mm watch)."""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from typing import Any

# ── ANSI (only when color enabled + tty) ──────────────────────────────────────


class _C:
    RESET = "\033[0m"
    DIM = "\033[2m"
    BOLD = "\033[1m"
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    RED = "\033[31m"
    YELLOW = "\033[33m"
    MAGENTA = "\033[35m"


def _fmt_money(x: float) -> str:
    if x >= 1_000_000:
        return f"${x / 1_000_000:.2f}M"
    if x >= 1_000:
        return f"${x / 1_000:.1f}K"
    return f"${x:.0f}"


def _pool_key(p: dict[str, Any]) -> str:
    return str(p.get("name") or p.get("pair") or "?")


def _summarize_pools(pools: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for p in pools:
        k = _pool_key(p)
        out[k] = {
            "price": float(p.get("price") or 0),
            "tick": float(p.get("tick") or 0),
            "tvl": float(p.get("tvl_usd") or 0),
        }
    return out


class _NoColor:
    RESET = DIM = BOLD = CYAN = GREEN = RED = YELLOW = MAGENTA = ""


def _delta_line(
    prev: dict[str, Any] | None,
    state: dict[str, Any],
    events: list[dict[str, Any]],
    use_color: bool,
) -> str:
    c = _C if use_color else _NoColor

    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    block = state.get("block_number", 0)
    tvl = float(state.get("total_tvl_usd") or 0)
    n_pools = len(state.get("pools") or [])
    dq = str(state.get("data_quality") or "")
    n_ev = len(events)

    parts = [
        f"{c.DIM}[{ts}]{c.RESET}",
        f"{c.CYAN}block{c.RESET}={block}",
        f"{c.CYAN}tvl{c.RESET}={_fmt_money(tvl)}",
        f"{c.CYAN}pools{c.RESET}={n_pools}",
    ]
    if dq:
        parts.append(f"{c.DIM}{dq}{c.RESET}")
    parts.append(f"{c.MAGENTA}events{c.RESET}={n_ev}")

    if prev is not None:
        pt = float(prev.get("total_tvl_usd") or 0)
        pb = int(prev.get("block_number") or 0)
        if block != pb:
            parts.append(f"{c.YELLOW}Δblock{c.RESET} {pb}→{block}")
        if tvl != pt and pt > 0:
            diff = tvl - pt
            col = c.GREEN if diff > 0 else c.RED
            parts.append(f"{col}Δtvl{c.RESET} {col}{diff:+.0f}{c.RESET}")

        prev_p = _summarize_pools(prev.get("pools") or [])
        cur_p = _summarize_pools(state.get("pools") or [])
        pool_deltas: list[str] = []
        for name, cur in cur_p.items():
            old = prev_p.get(name)
            if old is None:
                pool_deltas.append(f"{c.YELLOW}+{name}{c.RESET}")
                continue
            if abs(cur["price"] - old["price"]) > 1e-12:
                d = cur["price"] - old["price"]
                col = c.GREEN if d > 0 else c.RED
                pool_deltas.append(f"{name} {col}p{d:+.4g}{c.RESET}")
        if pool_deltas:
            parts.append(f"{c.DIM}|{c.RESET} " + f" {c.DIM}|{c.RESET} ".join(pool_deltas[:6]))
            if len(pool_deltas) > 6:
                parts.append(f"{c.DIM}+{len(pool_deltas) - 6} more{c.RESET}")

    if events:
        last = events[-1]
        msg = str(last.get("message") or last.get("category") or "")[:60]
        if msg:
            parts.append(f"{c.DIM}→ {msg}{c.RESET}")

    return " ".join(parts)


async def run_watch(
    *,
    ws_uri: str,
    mode: str,
    use_color: bool,
) -> None:
    try:
        import websockets
    except ImportError as e:
        print("Install websockets: pip install websockets", file=sys.stderr)
        raise SystemExit(1) from e

    prev_state: dict[str, Any] | None = None

    async with websockets.connect(ws_uri, max_size=10 * 1024 * 1024) as ws:
        while True:
            raw = await ws.recv()
            payload = json.loads(raw)
            state = payload.get("state") or {}
            events = payload.get("events") or []

            if mode == "raw":
                text = json.dumps(payload, indent=2 if sys.stdout.isatty() else None)
                if sys.stdout.isatty() and use_color:
                    print(f"{_C.CYAN}{text}{_C.RESET}")
                else:
                    print(text)
            elif mode == "jsonl":
                print(json.dumps(payload, separators=(",", ":")), flush=True)
            else:
                line = _delta_line(prev_state, state, events, use_color)
                print(line, flush=True)

            prev_state = state


def watch_main(ws_base: str, args: Any) -> int:
    path = getattr(args, "path", "/ws/public")
    if not path.startswith("/"):
        path = "/" + path
    if ws_base.startswith("https://"):
        uri = "wss://" + ws_base[8:].rstrip("/") + path
    elif ws_base.startswith("http://"):
        uri = "ws://" + ws_base[7:].rstrip("/") + path
    else:
        uri = ws_base.rstrip("/") + path

    mode = "summary"
    if getattr(args, "raw", False):
        mode = "raw"
    elif getattr(args, "jsonl", False):
        mode = "jsonl"

    use_color = not getattr(args, "no_color", False)
    if use_color and not sys.stdout.isatty():
        use_color = False

    try:
        asyncio.run(run_watch(ws_uri=uri, mode=mode, use_color=use_color))
    except KeyboardInterrupt:
        if use_color:
            print(f"\n{_C.DIM}sepolia-mm watch: stopped{_C.RESET}", file=sys.stderr)
        else:
            print("\nsepolia-mm watch: stopped", file=sys.stderr)
        return 0
    except Exception as exc:
        print(f"watch error: {exc}", file=sys.stderr)
        return 1
    return 0
