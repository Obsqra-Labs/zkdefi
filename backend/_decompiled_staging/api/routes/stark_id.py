# Source Generated with Decompyle++
# File: stark_id.cpython-312.pyc (Python 3.12)

'''
Stark ID API Routes

Store and retrieve .stark name bindings for addresses.
'''
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.services.json_store import JsonStore
router = APIRouter(prefix = '/stark_id', tags = [
    'stark_id'])
_stark_id_store = JsonStore('stark_id_bindings')

class StarkIdBinding(BaseModel):
    address: str = 'StarkIdBinding'
    stark_name: Optional[str] = None

get_stark_id = (lambda address = None: pass# WARNING: Decompyle incomplete
)()
set_stark_id = (lambda address = None, req = None: pass# WARNING: Decompyle incomplete
)()
