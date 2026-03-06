# Source Generated with Decompyle++
# File: strategy.cpython-312.pyc (Python 3.12)

'''
Strategy intelligence data models — persistent entities with computed genome factors.
'''
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class GenomeFactors(BaseModel):
    efficiency_score: 'float' = 'Computed genome factors for a strategy (0-100 scores).'
    composite_score = (lambda self = None: self.yield_score * 0.3 + (100 - self.risk_score) * 0.25 + (100 - self.volatility_score) * 0.15 + self.liquidity_score * 0.2 + self.efficiency_score * 0.1)()


class Strategy(BaseModel):
    genome: 'GenomeFactors' = 'Persistent strategy entity with computed intelligence.'
    zkml_risk_score: 'Optional[int]' = None
    first_seen: 'datetime' = []


class PerformanceSnapshot(BaseModel):
    volume_24h_usd: 'float' = 'Historical performance record (append-only).'

