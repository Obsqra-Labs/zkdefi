#!/usr/bin/env python3
"""DEX API smoke: pairs (required), quote + swap-calldata (best-effort). BACKEND_URL=http://localhost:8003 python3 tests/test_dex_smoke.py"""
import asyncio
import os
import sys
import httpx

BASE = os.getenv("BACKEND_URL", "http://localhost:8003")

async def main():
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(BASE + "/api/v1/zkdefi/dex/pairs", params={"min_tvl_usd": 0})
        print("pairs", r.status_code)
        if r.status_code != 200:
            print(r.text[:200])
            sys.exit(1)
        d = r.json()
        lst = d.get("topPairs") or d.get("pairs") or (d if isinstance(d, list) else [])
        if not lst:
            print("no pairs")
            sys.exit(1)
        p = lst[0]
        t0 = str(p.get("token0") or p.get("token_0") or "")
        t1 = str(p.get("token1") or p.get("token_1") or "")
        amt = "1000000000000000000"
        try:
            q = await c.post(BASE + "/api/v1/zkdefi/dex/quote", json={"token_in": t0, "token_out": t1, "amount_in": amt})
            print("quote", q.status_code)
        except Exception as e:
            print("quote", type(e).__name__)
        try:
            s = await c.post(BASE + "/api/v1/zkdefi/dex/swap-calldata", json={"token_in": t0, "token_out": t1, "amount_in": amt, "slippage_bps": 50})
            print("swap-calldata", s.status_code)
            if s.status_code == 200:
                j = s.json()
                calldata = j.get("calldata") or []
                print("entrypoint", j.get("entrypoint"), "calldata len", len(calldata))
            elif s.status_code != 503:
                print(s.text[:150])
        except Exception as e:
            print("swap-calldata", type(e).__name__)
    print("DEX smoke OK")

if __name__ == "__main__":
    asyncio.run(main())
