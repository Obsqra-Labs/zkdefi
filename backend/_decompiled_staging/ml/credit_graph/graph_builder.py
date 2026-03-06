# Source Generated with Decompyle++
# File: graph_builder.cpython-312.pyc (Python 3.12)

'''
Credit Graph Builder.

Constructs and updates a co-investment graph from on-chain position data.
Edges represent users who share liquidity in the same pool during overlapping
time windows. Edge weights are proportional to overlap duration × combined TVL.

Graph structure:
  - Nodes: user addresses (Starknet felt)
  - Edges: co-investment in a shared pool
  - Node features: 18-dimensional CreditFeatures vector (from creditworthiness)
  - Edge weight: overlap_hours × combined_tvl (from credit_graph_edges table)

The graph is recomputed periodically (e.g., every 4 hours) and persisted to
PostgreSQL via the credit_graph_edges table.
'''
from __future__ import annotations
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
logger = logging.getLogger(__name__)
GraphNode = <NODE:12>()
GraphEdge = <NODE:12>()

class CreditGraphBuilder:
    '''
    Builds and maintains the collaborative credit graph.

    Data sources:
      - Active positions (from position tracker / pool state)
      - Historical co-investment windows (from PostgreSQL credit_graph_edges)
      - CreditFeatures per user (from creditworthiness pipeline)
    '''
    
    def __init__(self = None):
        self.nodes = { }
        self.edges = []
        self._adjacency = defaultdict(list)

    
    async def build_from_positions(self = None, active_positions = None):
        '''
        Build co-investment edges from active position data.

        Each position dict should contain:
          - user_address: str
          - pool_id: str
          - tvl_usd: float
          - entry_timestamp: str (ISO)
          - (optional) exit_timestamp: str (ISO) or None if still active
        '''
        pass
    # WARNING: Decompyle incomplete

    
    def _rebuild_adjacency(self = None):
        self._adjacency.clear()
        addr_set = set()
        for e in self.edges:
            self._adjacency[e.user_a].append(e.user_b)
            self._adjacency[e.user_b].append(e.user_a)
            addr_set.add(e.user_a)
            addr_set.add(e.user_b)
        for addr in addr_set:
            if not addr not in self.nodes:
                continue
            self.nodes[addr] = GraphNode(address = addr, features = [
                0] * 18)

    
    def set_node_features(self = None, address = None, features = None, grade = ('C',)):
        '''Set credit features for a node.'''
        if address in self.nodes:
            self.nodes[address].features = features
            self.nodes[address].credit_grade = grade
            return None
        self.nodes[address] = GraphNode(address = address, features = features, credit_grade = grade)

    
    def get_neighbors(self = None, address = None):
        return list(set(self._adjacency.get(address, [])))

    
    def get_neighbor_edges(self = None, address = None):
        pass
    # WARNING: Decompyle incomplete

    
    def compute_collaborative_multiplier(self = None, address = None):
        """
        Compute the collaborative multiplier for a user based on their
        neighbors' credit quality and edge weights.

        Formula:
          multiplier = 1.0 + sum(neighbor_grade_bonus * normalized_weight) / max_possible
          Capped at [1.0, 2.0]

        Grade bonuses: AAA=0.5, AA=0.4, A=0.3, B=0.1, C=0.0
        """
        grade_bonus = {
            'AAA': 0.5,
            'AA': 0.4,
            'A': 0.3,
            'B': 0.1,
            'C': 0 }
        neighbor_edges = self.get_neighbor_edges(address)
        if not neighbor_edges:
            return 1
        total_weight = (lambda .0: pass# WARNING: Decompyle incomplete
)(neighbor_edges())
        if total_weight <= 0:
            return 1
        weighted_bonus = 0
        for edge in neighbor_edges:
            neighbor_addr = edge.user_b if edge.user_a == address else edge.user_a
            neighbor_node = self.nodes.get(neighbor_addr)
            if not neighbor_node:
                continue
            bonus = grade_bonus.get(neighbor_node.credit_grade, 0)
            normalized_weight = edge.weight / total_weight
            weighted_bonus += bonus * normalized_weight
        network_size_bonus = min(0.5, len(neighbor_edges) * 0.05)
        multiplier = 1 + weighted_bonus + network_size_bonus
        return round(min(2, max(1, multiplier)), 3)

    
    async def persist_edges(self = None):
        '''Persist current edges to PostgreSQL.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def load_edges(self = None):
        '''Load edges from PostgreSQL.'''
        pass
    # WARNING: Decompyle incomplete



def _parse_ts(val = dataclass):
    '''Parse an ISO timestamp or return None.'''
    pass
# WARNING: Decompyle incomplete

_builder: 'CreditGraphBuilder | None' = None

def get_credit_graph_builder():
    pass
# WARNING: Decompyle incomplete

