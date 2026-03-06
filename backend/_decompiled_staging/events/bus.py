# Source Generated with Decompyle++
# File: bus.cpython-312.pyc (Python 3.12)

'''
Event Bus - Internal Pub/Sub System

Simple event bus for service-to-service communication.
Services publish events, subscribers get notified.

Features:
- Async event handling
- Multiple subscribers per event
- Thread-safe
- Wildcard subscriptions
'''
import logging
import asyncio
from typing import Dict, Set, Callable, Awaitable, Any
from collections import defaultdict
logger = logging.getLogger(__name__)
EventHandler = Callable[([
    Dict[(str, Any)]], Awaitable[None])]

class EventBus:
    '''Internal event bus for pub/sub communication.'''
    
    def __init__(self):
        '''Initialize event bus.'''
        self.subscribers = defaultdict(set)
        self._lock = asyncio.Lock()

    
    async def subscribe(self = None, event_name = None, handler = None):
        """
        Subscribe to an event.
        
        Args:
            event_name: Name of event to subscribe to (e.g., 'strategy.updated')
                       Use '*' to subscribe to all events
            handler: Async function to call when event is published
        """
        pass
    # WARNING: Decompyle incomplete

    
    async def unsubscribe(self = None, event_name = None, handler = None):
        '''
        Unsubscribe from an event.
        
        Args:
            event_name: Name of event
            handler: Handler function to remove
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def publish(self = None, event_name = None, data = None):
        """
        Publish an event to all subscribers.
        
        Args:
            event_name: Name of event (e.g., 'strategy.updated')
            data: Event data to pass to handlers
        """
        pass
    # WARNING: Decompyle incomplete

    
    def get_subscriber_count(self = None, event_name = None):
        '''
        Get number of subscribers.
        
        Args:
            event_name: Optional event name. If None, returns total across all events.
        '''
        if event_name:
            return len(self.subscribers.get(event_name, set()))
        return (lambda .0: pass# WARNING: Decompyle incomplete
)(self.subscribers.values()())

    
    def get_event_names(self = None):
        '''Get set of all subscribed event names.'''
        return set(self.subscribers.keys())


_bus: EventBus | None = None

def get_event_bus():
    '''Get the singleton event bus instance.'''
    pass
# WARNING: Decompyle incomplete

