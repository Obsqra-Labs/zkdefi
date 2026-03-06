# Source Generated with Decompyle++
# File: action_intent.cpython-312.pyc (Python 3.12)

'''ActionIntent + GuardResult — canonical types for the execution guard pipeline.

Every strategy bot / rebalancer / manual route builds an ActionIntent before
any on-chain call.  execution_guard.check(intent) returns a GuardResult that
must be ``allowed`` before the backend signs or forwards the transaction.
'''
from __future__ import annotations
import hashlib
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
ActionIntent = <NODE:12>()
GuardResult = <NODE:12>()
