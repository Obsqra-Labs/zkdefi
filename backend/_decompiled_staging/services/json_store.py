# Source Generated with Decompyle++
# File: json_store.cpython-312.pyc (Python 3.12)

'''
Lightweight JSON file persistence layer.

Provides a dict-like store backed by a JSON file in the project ``data/``
directory.  Reads happen from an in-memory cache; writes flush to disk
immediately (safe for single-process services).

Usage
-----
    store = JsonStore("agents")        # → data/agents.json
    store.set("key", {...})
    store.get("key")  # → dict | None
    store.all()       # → dict[str, Any]
'''
from __future__ import annotations
import json
import logging
import threading
from pathlib import Path
from typing import Any
logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parent.parent.parent / 'data'
DATA_DIR.mkdir(exist_ok = True)

class JsonStore:
    '''Thread-safe JSON-file-backed key/value store.'''
    
    def __init__(self = None, name = None):
        self._path = DATA_DIR / f'''{name}.json'''
        self._lock = threading.Lock()
        self._cache = self._load()

    
    def get(self = None, key = None):
        pass
    # WARNING: Decompyle incomplete

    
    def set(self = None, key = None, value = None):
        pass
    # WARNING: Decompyle incomplete

    
    def delete(self = None, key = None):
        pass
    # WARNING: Decompyle incomplete

    
    def all(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    def values(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    def keys(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    def clear(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    def __len__(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    def _load(self = None):
        if not self._path.exists():
            return { }
    # WARNING: Decompyle incomplete

    
    def _flush(self = None):
        tmp = self._path.with_suffix('.tmp')
    # WARNING: Decompyle incomplete


