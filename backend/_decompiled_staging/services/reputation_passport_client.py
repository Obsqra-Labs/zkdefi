# Source Generated with Decompyle++
# File: reputation_passport_client.cpython-312.pyc (Python 3.12)

"""
Reputation Passport Client — zkdefi → obsqra aggregation bridge.

Calls the parent Obsqra backend's POST /api/v1/aggregation/passport to generate
STARK-proven reputation passports. Used by the zkdefi proof pipeline and
risk passport API.
"""
from __future__ import annotations
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional
import httpx
logger = logging.getLogger(__name__)
PARENT_LOCAL_URL = os.getenv('OBSQRA_LOCAL_API_URL', 'http://127.0.0.1:8002/api/v1')
PARENT_API_URL = os.getenv('OBSQRA_API_URL', 'https://starknet.obsqra.fi/api/v1')
PassportResult = <NODE:12>()

class ReputationPassportClient:
    """
    HTTP client that calls obsqra's POST /api/v1/aggregation/passport
    to generate STARK-proven reputation passports.
    """
    
    def __init__(self):
        self._client = None

    
    async def _get_client(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    async def close(self):
        pass
    # WARNING: Decompyle incomplete

    
    async def aggregate_passport(self = None, badge_fact_hashes = None, tier_thresholds = None, timestamp = (None, None)):
        '''
        Request a STARK-proven reputation passport from the obsqra backend.

        Args:
            badge_fact_hashes: Map of badge_type → fact_hash (hex string).
            tier_thresholds: Override tier thresholds [bronze, silver, gold, diamond].
            timestamp: Unix epoch. Defaults to server time.

        Returns:
            PassportResult with STARK proof details.
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def get_passport_config(self = None):
        '''Fetch passport configuration (badge weights, tier thresholds).'''
        pass
    # WARNING: Decompyle incomplete


_client: 'ReputationPassportClient | None' = None

def get_reputation_passport_client():
    pass
# WARNING: Decompyle incomplete

