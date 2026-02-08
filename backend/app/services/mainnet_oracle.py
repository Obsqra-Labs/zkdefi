"""
Mainnet Oracle Service

Fetches real market data from JediSwap and Ekubo mainnet APIs.
Stores snapshots for testnet app to react to real market conditions.

Cron: Every 15 minutes
"""
import asyncio
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

# Data storage path
DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
SNAPSHOTS_FILE = DATA_DIR / "market_snapshots.json"

# API endpoints (mainnet)
JEDISWAP_API = "https://api.jediswap.xyz"
EKUBO_API = "https://mainnet-api.ekubo.org"

# Fallback/mock data for when APIs are unavailable
FALLBACK_DATA = {
    "jediswap": {
        "tvl": 45_000_000,  # $45M
        "apy_bps": 420,  # 4.2%
        "volume_24h": 2_500_000,  # $2.5M
        "volatility_bps": 210,  # 2.1%
    },
    "ekubo": {
        "tvl": 78_000_000,  # $78M
        "apy_bps": 780,  # 7.8%
        "volume_24h": 5_800_000,  # $5.8M
        "volatility_bps": 430,  # 4.3%
    },
}


class MarketSnapshot:
    """Represents a point-in-time market snapshot."""
    
    def __init__(
        self,
        jediswap: dict[str, Any],
        ekubo: dict[str, Any],
        timestamp: int | None = None
    ):
        self.jediswap = jediswap
        self.ekubo = ekubo
        self.timestamp = timestamp or int(time.time())
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "jediswap": self.jediswap,
            "ekubo": self.ekubo,
            "timestamp": self.timestamp,
            "datetime": datetime.fromtimestamp(self.timestamp).isoformat(),
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MarketSnapshot":
        return cls(
            jediswap=data["jediswap"],
            ekubo=data["ekubo"],
            timestamp=data.get("timestamp"),
        )
    
    def get_recommended_allocation(self, risk_tolerance: int) -> dict[str, int]:
        """
        Recommend allocation based on current market conditions and risk tolerance.
        
        Returns jediswap_bps, ekubo_bps (basis points, sum to 10000)
        """
        # Higher Ekubo APY but also higher volatility
        jedi_apy = self.jediswap.get("apy_bps", 0)
        ekubo_apy = self.ekubo.get("apy_bps", 0)
        ekubo_vol = self.ekubo.get("volatility_bps", 0)
        
        # Risk-adjusted return: APY - (volatility * risk_factor)
        # Lower risk tolerance = more penalty for volatility
        risk_factor = (100 - risk_tolerance) / 50  # 0-2 range
        
        jedi_score = jedi_apy
        ekubo_score = ekubo_apy - (ekubo_vol * risk_factor)
        
        total_score = jedi_score + ekubo_score
        if total_score <= 0:
            return {"jediswap_bps": 5000, "ekubo_bps": 5000}
        
        jedi_pct = int((jedi_score / total_score) * 10000)
        ekubo_pct = 10000 - jedi_pct
        
        # Clamp to reasonable bounds
        jedi_pct = max(2000, min(8000, jedi_pct))
        ekubo_pct = 10000 - jedi_pct
        
        return {"jediswap_bps": jedi_pct, "ekubo_bps": ekubo_pct}
    
    def get_pool_apy(self, pool_type: str) -> int:
        """Get projected APY for a pool type (in basis points)."""
        allocations = {
            "conservative": {"jediswap_bps": 8000, "ekubo_bps": 2000},
            "neutral": {"jediswap_bps": 5000, "ekubo_bps": 5000},
            "aggressive": {"jediswap_bps": 2000, "ekubo_bps": 8000},
        }
        
        alloc = allocations.get(pool_type.lower(), allocations["neutral"])
        
        jedi_apy = self.jediswap.get("apy_bps", 0)
        ekubo_apy = self.ekubo.get("apy_bps", 0)
        
        weighted_apy = (
            (jedi_apy * alloc["jediswap_bps"]) +
            (ekubo_apy * alloc["ekubo_bps"])
        ) // 10000
        
        return weighted_apy


class MainnetOracle:
    """
    Fetches and caches mainnet market data for JediSwap and Ekubo.
    """
    
    def __init__(self):
        self._snapshots: list[MarketSnapshot] = []
        self._load_snapshots()
    
    def _load_snapshots(self):
        """Load snapshots from disk."""
        if SNAPSHOTS_FILE.exists():
            try:
                with open(SNAPSHOTS_FILE, "r") as f:
                    data = json.load(f)
                    self._snapshots = [
                        MarketSnapshot.from_dict(s) for s in data.get("snapshots", [])
                    ]
            except Exception as e:
                print(f"[MainnetOracle] Error loading snapshots: {e}")
                self._snapshots = []
    
    def _save_snapshots(self):
        """Save snapshots to disk."""
        try:
            # Keep last 100 snapshots (about 25 hours at 15-min intervals)
            self._snapshots = self._snapshots[-100:]
            with open(SNAPSHOTS_FILE, "w") as f:
                json.dump({
                    "snapshots": [s.to_dict() for s in self._snapshots],
                    "updated_at": datetime.now().isoformat(),
                }, f, indent=2)
        except Exception as e:
            print(f"[MainnetOracle] Error saving snapshots: {e}")
    
    async def fetch_jediswap_data(self) -> dict[str, Any]:
        """Fetch JediSwap mainnet stats."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Try to get pool data
                response = await client.get(f"{JEDISWAP_API}/v1/stats")
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "tvl": data.get("tvl", FALLBACK_DATA["jediswap"]["tvl"]),
                        "apy_bps": int(data.get("avg_apy", 4.2) * 100),
                        "volume_24h": data.get("volume_24h", FALLBACK_DATA["jediswap"]["volume_24h"]),
                        "volatility_bps": 210,  # Would need price history
                    }
        except Exception as e:
            print(f"[MainnetOracle] JediSwap fetch failed: {e}")
        
        return FALLBACK_DATA["jediswap"]
    
    async def fetch_ekubo_data(self) -> dict[str, Any]:
        """Fetch Ekubo mainnet stats."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Try to get overview data
                response = await client.get(f"{EKUBO_API}/overview")
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "tvl": int(data.get("tvl_usd", FALLBACK_DATA["ekubo"]["tvl"])),
                        "apy_bps": int(data.get("avg_fee_apy", 7.8) * 100),
                        "volume_24h": int(data.get("volume_24h_usd", FALLBACK_DATA["ekubo"]["volume_24h"])),
                        "volatility_bps": 430,  # Would need price history
                    }
        except Exception as e:
            print(f"[MainnetOracle] Ekubo fetch failed: {e}")
        
        return FALLBACK_DATA["ekubo"]
    
    async def sync_market_data(self) -> MarketSnapshot:
        """
        Fetch fresh data from both protocols and store snapshot.
        """
        print(f"[MainnetOracle] Syncing market data at {datetime.now().isoformat()}")
        
        # Fetch in parallel
        jediswap_data, ekubo_data = await asyncio.gather(
            self.fetch_jediswap_data(),
            self.fetch_ekubo_data(),
        )
        
        snapshot = MarketSnapshot(
            jediswap=jediswap_data,
            ekubo=ekubo_data,
        )
        
        self._snapshots.append(snapshot)
        self._save_snapshots()
        
        print(f"[MainnetOracle] Snapshot saved: JediSwap APY={jediswap_data['apy_bps']}bps, Ekubo APY={ekubo_data['apy_bps']}bps")
        
        return snapshot
    
    def get_latest_snapshot(self) -> MarketSnapshot | None:
        """Get the most recent snapshot."""
        if not self._snapshots:
            return None
        return self._snapshots[-1]
    
    def get_snapshot_history(self, limit: int = 10) -> list[MarketSnapshot]:
        """Get recent snapshot history."""
        return self._snapshots[-limit:]
    
    def get_current_recommendation(self, risk_tolerance: int = 50) -> dict[str, Any]:
        """
        Get current allocation recommendation based on latest market data.
        """
        snapshot = self.get_latest_snapshot()
        if not snapshot:
            # Return neutral if no data
            return {
                "jediswap_bps": 5000,
                "ekubo_bps": 5000,
                "pool_type": "neutral",
                "reason": "No market data available",
            }
        
        alloc = snapshot.get_recommended_allocation(risk_tolerance)
        
        # Determine pool type
        if alloc["jediswap_bps"] >= 7000:
            pool_type = "conservative"
        elif alloc["ekubo_bps"] >= 7000:
            pool_type = "aggressive"
        else:
            pool_type = "neutral"
        
        # Generate reason
        jedi_apy = snapshot.jediswap.get("apy_bps", 0) / 100
        ekubo_apy = snapshot.ekubo.get("apy_bps", 0) / 100
        ekubo_vol = snapshot.ekubo.get("volatility_bps", 0) / 100
        
        if pool_type == "aggressive":
            reason = f"Ekubo APY ({ekubo_apy:.1f}%) significantly higher, volatility ({ekubo_vol:.1f}%) acceptable"
        elif pool_type == "conservative":
            reason = f"JediSwap APY ({jedi_apy:.1f}%) competitive with lower risk"
        else:
            reason = f"Balanced allocation: JediSwap {jedi_apy:.1f}% vs Ekubo {ekubo_apy:.1f}% APY"
        
        return {
            **alloc,
            "pool_type": pool_type,
            "reason": reason,
            "jediswap_apy_pct": jedi_apy,
            "ekubo_apy_pct": ekubo_apy,
            "ekubo_volatility_pct": ekubo_vol,
            "snapshot_timestamp": snapshot.timestamp,
        }


# Singleton instance
_oracle_instance: MainnetOracle | None = None


def get_oracle() -> MainnetOracle:
    """Get or create the oracle singleton."""
    global _oracle_instance
    if _oracle_instance is None:
        _oracle_instance = MainnetOracle()
    return _oracle_instance


async def run_oracle_sync():
    """Run a single sync (for cron jobs)."""
    oracle = get_oracle()
    await oracle.sync_market_data()


if __name__ == "__main__":
    # Manual sync for testing
    asyncio.run(run_oracle_sync())
