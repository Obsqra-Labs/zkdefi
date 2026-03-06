# Source Generated with Decompyle++
# File: attack_generator.cpython-312.pyc (Python 3.12)

'''
Attack Generator — generates adversarial DeFi scenarios for model robustness testing.

Each attack is a modified input feature vector that simulates a specific
protocol attack. The model should correctly identify or handle these scenarios
(e.g., reject dangerous pools, flag anomalous prices, defer to human).

Attack types:
  1. RUG_PULL:       90% TVL drain in 1 block
  2. FLASH_LOAN:     Massive temporary TVL spike → immediate withdrawal
  3. ORACLE_MANIP:   Price feed deviation > 50% from TWAP
  4. SANDWICH:       Front-run + back-run pattern around a large trade
  5. LIQUIDITY_DRAIN: Gradual TVL decrease (slow rug)
'''
from __future__ import annotations
import hashlib
import json
import random
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any
import logging
logger = logging.getLogger(__name__)

class AttackType(Enum):
    RUG_PULL = auto()
    FLASH_LOAN = auto()
    ORACLE_MANIPULATION = auto()
    SANDWICH = auto()
    LIQUIDITY_DRAIN = auto()

AttackScenario = <NODE:12>()
AttackSuite = <NODE:12>()

class AttackGenerator:
    '''
    Generates adversarial DeFi attack scenarios.

    Each attack modifies a baseline feature dict to simulate the attack,
    along with the expected correct model behavior.
    '''
    
    def __init__(self = None, seed = None):
        self._rng = random.Random(seed)

    
    def generate_suite(self = None, *, attacks_per_type, types):
        '''Generate a full attack suite.'''
        pass
    # WARNING: Decompyle incomplete

    
    def _gen_rug_pull(self = None, idx = None):
        '''90% TVL drain in 1 block.'''
        drain_pct = self._rng.uniform(0.8, 0.99)
        tvl_before = self._rng.uniform(100000, 10000000)
        tvl_after = tvl_before * (1 - drain_pct)
        return AttackScenario(attack_type = AttackType.RUG_PULL, name = f'''rug_pull_{idx}''', description = f'''TVL drops {drain_pct * 100:.0f}% in 1 block (${tvl_before:,.0f} → ${tvl_after:,.0f})''', modified_inputs = {
            'tvl_usd': tvl_after,
            'tvl_change_1block_pct': -drain_pct * 100,
            'pool_risk_score': 95,
            'num_holders_change': -self._rng.randint(50, 200) }, expected_action = 'reject', severity = 'critical', metadata = {
            'drain_pct': drain_pct,
            'tvl_before': tvl_before })

    
    def _gen_flash_loan(self = None, idx = None):
        '''Massive TVL spike followed by drain within same or next block.'''
        spike_mult = self._rng.uniform(5, 100)
        base_tvl = self._rng.uniform(50000, 2000000)
        return AttackScenario(attack_type = AttackType.FLASH_LOAN, name = f'''flash_loan_{idx}''', description = f'''TVL spikes {spike_mult:.0f}x then returns to baseline in 1 block''', modified_inputs = {
            'tvl_usd': base_tvl * spike_mult,
            'tvl_change_1block_pct': (spike_mult - 1) * 100,
            'is_flash_loan_candidate': True,
            'pool_age_hours': self._rng.uniform(1, 48) }, expected_action = 'reject', severity = 'critical', metadata = {
            'spike_mult': spike_mult,
            'base_tvl': base_tvl })

    
    def _gen_oracle_manipulation(self = None, idx = None):
        '''Price feed deviates > 50% from TWAP.'''
        deviation_pct = self._rng.uniform(50, 300)
        direction = self._rng.choice([
            -1,
            1])
        base_price = self._rng.uniform(0.5, 5000)
        spot_price = base_price * (1 + direction * deviation_pct / 100)
        return AttackScenario(attack_type = AttackType.ORACLE_MANIPULATION, name = f'''oracle_manip_{idx}''', description = f'''Spot price deviates {deviation_pct:.0f}% from TWAP (${base_price:.2f} → ${spot_price:.2f})''', modified_inputs = {
            'current_price': spot_price,
            'twap_price': base_price,
            'price_deviation_pct': deviation_pct * direction,
            'oracle_staleness_seconds': self._rng.randint(0, 300) }, expected_action = 'reject', severity = 'high', metadata = {
            'deviation_pct': deviation_pct,
            'direction': direction })

    
    def _gen_sandwich(self = None, idx = None):
        """Front-run/back-run pattern around user's trade."""
        slippage_bps = self._rng.randint(100, 2000)
        trade_size = self._rng.uniform(1000, 500000)
        return AttackScenario(attack_type = AttackType.SANDWICH, name = f'''sandwich_{idx}''', description = f'''Sandwich attack: {slippage_bps}bps slippage on ${trade_size:,.0f} trade''', modified_inputs = {
            'expected_slippage_bps': slippage_bps,
            'mempool_suspicious_tx_count': self._rng.randint(2, 10),
            'trade_amount_usd': trade_size,
            'gas_price_gwei': self._rng.uniform(50, 500) }, expected_action = 'defer' if slippage_bps < 500 else 'reject', severity = 'high' if slippage_bps >= 500 else 'medium', metadata = {
            'slippage_bps': slippage_bps })

    
    def _gen_liquidity_drain(self = None, idx = None):
        '''Gradual TVL decrease (slow rug).'''
        drain_days = self._rng.randint(3, 30)
        daily_drain_pct = self._rng.uniform(5, 20)
        total_drain_pct = min(95, daily_drain_pct * drain_days)
        tvl_before = self._rng.uniform(200000, 5000000)
        return AttackScenario(attack_type = AttackType.LIQUIDITY_DRAIN, name = f'''liq_drain_{idx}''', description = f'''Gradual drain: {daily_drain_pct:.1f}%/day for {drain_days}d ({total_drain_pct:.0f}% total)''', modified_inputs = {
            'tvl_usd': tvl_before * (1 - total_drain_pct / 100),
            'tvl_trend_7d_pct': -min(100, daily_drain_pct * 7),
            'holder_count_trend': -self._rng.randint(10, 100),
            'pool_age_hours': drain_days * 24 }, expected_action = 'reject' if total_drain_pct > 50 else 'defer', severity = 'high' if total_drain_pct > 50 else 'medium', metadata = {
            'drain_days': drain_days,
            'total_drain_pct': total_drain_pct })

    _generators = {
        AttackType.LIQUIDITY_DRAIN: _gen_liquidity_drain,
        AttackType.SANDWICH: _gen_sandwich,
        AttackType.ORACLE_MANIPULATION: _gen_oracle_manipulation,
        AttackType.FLASH_LOAN: _gen_flash_loan,
        AttackType.RUG_PULL: _gen_rug_pull }

