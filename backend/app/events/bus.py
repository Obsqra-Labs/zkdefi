"""
Event Bus - Internal Pub/Sub System

Simple event bus for service-to-service communication.
Services publish events, subscribers get notified.

Features:
- Async event handling
- Multiple subscribers per event
- Thread-safe
- Wildcard subscriptions
"""

import logging
import asyncio
from typing import Dict, Set, Callable, Awaitable, Any
from collections import defaultdict

logger = logging.getLogger(__name__)

EventHandler = Callable[[Dict[str, Any]], Awaitable[None]]


class EventBus:
    """Internal event bus for pub/sub communication."""
    
    def __init__(self):
        """Initialize event bus."""
        self.subscribers: Dict[str, Set[EventHandler]] = defaultdict(set)
        self._lock = asyncio.Lock()
    
    async def subscribe(self, event_name: str, handler: EventHandler):
        """
        Subscribe to an event.
        
        Args:
            event_name: Name of event to subscribe to (e.g., 'strategy.updated')
                       Use '*' to subscribe to all events
            handler: Async function to call when event is published
        """
        async with self._lock:
            self.subscribers[event_name].add(handler)
            logger.debug(f"Subscribed to event: {event_name}")
    
    async def unsubscribe(self, event_name: str, handler: EventHandler):
        """
        Unsubscribe from an event.
        
        Args:
            event_name: Name of event
            handler: Handler function to remove
        """
        async with self._lock:
            if event_name in self.subscribers:
                self.subscribers[event_name].discard(handler)
                if not self.subscribers[event_name]:
                    del self.subscribers[event_name]
                logger.debug(f"Unsubscribed from event: {event_name}")
    
    async def publish(self, event_name: str, data: Dict[str, Any]):
        """
        Publish an event to all subscribers.
        
        Args:
            event_name: Name of event (e.g., 'strategy.updated')
            data: Event data to pass to handlers
        """
        # Get handlers for this specific event
        handlers = self.subscribers.get(event_name, set()).copy()
        
        # Add wildcard subscribers
        handlers.update(self.subscribers.get("*", set()))
        
        if not handlers:
            logger.debug(f"No subscribers for event: {event_name}")
            return
        
        logger.info(f"Publishing event: {event_name} to {len(handlers)} subscribers")
        
        # Call all handlers concurrently
        tasks = []
        for handler in handlers:
            try:
                task = asyncio.create_task(handler(data))
                tasks.append(task)
            except Exception as e:
                logger.error(f"Failed to create task for handler {handler}: {e}")
        
        # Wait for all handlers to complete (with timeout)
        if tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True),
                    timeout=30.0
                )
            except asyncio.TimeoutError:
                logger.warning(f"Event {event_name} handlers timed out")
            except Exception as e:
                logger.error(f"Error publishing event {event_name}: {e}")
    
    def get_subscriber_count(self, event_name: str | None = None) -> int:
        """
        Get number of subscribers.
        
        Args:
            event_name: Optional event name. If None, returns total across all events.
        """
        if event_name:
            return len(self.subscribers.get(event_name, set()))
        return sum(len(handlers) for handlers in self.subscribers.values())
    
    def get_event_names(self) -> Set[str]:
        """Get set of all subscribed event names."""
        return set(self.subscribers.keys())


# Singleton instance
_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """Get the singleton event bus instance."""
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
