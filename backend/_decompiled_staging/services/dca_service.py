# Source Generated with Decompyle++
# File: dca_service.cpython-312.pyc (Python 3.12)

'''
DCA (Dollar Cost Averaging) strategy service.

Handles interval scheduling, token decimal conversion, signal-gated
swap execution, and state persistence.
'''
import logging
import time
from typing import Any
from app.services.ekubo_config import SEPOLIA_STRKBTC
logger = logging.getLogger(__name__)
_TOKEN_DECIMALS: dict[(str, int)] = {
    SEPOLIA_STRKBTC: 18,
    '0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080': 6,
    '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7': 18,
    '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d': 18 }

def get_token_decimals(token_address = None):
    return _TOKEN_DECIMALS.get(token_address.lower(), _TOKEN_DECIMALS.get(token_address, 18))


def amount_to_wei(amount_human = None, decimals = None):
    return int(amount_human * 10 ** decimals)


def should_run_dca(now = None, last_run = None, interval_secs = None):
    pass
# WARNING: Decompyle incomplete


async def _submit_swap(token_in = None, token_out = None, amount_wei = None, max_slippage_bps = ('token_in', str, 'token_out', str, 'amount_wei', int, 'max_slippage_bps', int, 'return', dict)):
    '''Build and submit swap calldata via Ekubo. Returns tx result.'''
    pass
# WARNING: Decompyle incomplete


async def execute_dca_step(user_address = None, config = None, state = None):
    '''
    Execute a single DCA step.

    State is passed in and must be persisted by the caller (autonomous_agent).
    '''
    pass
# WARNING: Decompyle incomplete

