# Source Generated with Decompyle++
# File: features.cpython-312.pyc (Python 3.12)

'''
Feature engineering for the creditworthiness model.

Combines three data sources into an 18-feature vector:
  1. Cross-chain activity (from cross_chain_fetcher.py)
  2. Behavioral stats (from decision_store / user_behavior_stats)
  3. On-chain reputation (from reputation_registry via API)

Feature vector is designed to be fed into:
  - XGBoost classifier for credit class prediction
  - EZKL prover for verifiable inference
'''
from __future__ import annotations
import logging
from dataclasses import dataclass, asdict
from typing import Any
logger = logging.getLogger(__name__)
FEATURE_NAMES: 'list[str]' = [
    'chains_active',
    'total_tx_count',
    'total_value_usd',
    'account_age_days',
    'protocol_diversity',
    'success_rate',
    'unique_contracts',
    'early_exit_rate',
    'avg_hold_duration_hours',
    'proof_success_rate',
    'rebalance_frequency',
    'avg_action_size_eth',
    'max_single_loss_pct',
    'time_since_last_action_hours',
    'tier',
    'tenure_days',
    'collateral_eth',
    'on_chain_reputation_score']
CREDIT_CLASSES: 'list[str]' = [
    'AAA',
    'AA',
    'A',
    'B',
    'C']
CreditFeatures = <NODE:12>()

async def build_features(user_address = None, cross_chain_data = None, behavior_stats = dataclass, reputation_data = (None, None, None)):
    '''
    Build a CreditFeatures vector from available data sources.

    Args:
        user_address: For logging / fallback queries.
        cross_chain_data: Output of cross_chain_fetcher.fetch_all_chains()
        behavior_stats: Output of decision_store.get_behavior_stats()
        reputation_data: Dict with tier, tenure_days, collateral_eth, reputation_score

    Returns:
        CreditFeatures ready for model inference.
    '''
    pass
# WARNING: Decompyle incomplete


def features_to_onnx_input(features = None):
    '''Convert CreditFeatures to the nested list format EZKL expects.'''
    return [
        features.to_vector()]

