/**
 * useWebSocket Hook
 * 
 * React hook for WebSocket connection to Capital OS real-time updates.
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Subscribe to specific event types
 * - Handles connection lifecycle
 * - Graceful disconnection
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { WebSocketEvent, EventCallback, UseWebSocketReturn } from "@/lib/websocket/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

interface UseWebSocketOptions {
  enabled?: boolean;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(
  address: string | undefined,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const {
    enabled = true,
    reconnect = true,
    reconnectInterval = 1000,
    maxReconnectAttempts = 10,
  } = options;

  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const subscribersRef = useRef<Map<string, Set<EventCallback>>>(new Map());
  const intentionalDisconnectRef = useRef(false);

  const subscribe = useCallback((eventType: string, callback: EventCallback) => {
    if (!subscribersRef.current.has(eventType)) {
      subscribersRef.current.set(eventType, new Set());
    }
    subscribersRef.current.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      subscribersRef.current.get(eventType)?.delete(callback);
      if (subscribersRef.current.get(eventType)?.size === 0) {
        subscribersRef.current.delete(eventType);
      }
    };
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketEvent = JSON.parse(event.data);

      // Handle ping/pong
      if (message.type === "ping") {
        wsRef.current?.send("pong");
        return;
      }

      // Notify subscribers for this event type
      const callbacks = subscribersRef.current.get(message.type);
      if (callbacks) {
        callbacks.forEach((callback) => {
          try {
            callback(message.data);
          } catch (err) {
            console.error(`Error in WebSocket callback for ${message.type}:`, err);
          }
        });
      }

      // Also notify wildcard subscribers
      const wildcardCallbacks = subscribersRef.current.get("*");
      if (wildcardCallbacks) {
        wildcardCallbacks.forEach((callback) => {
          try {
            callback(message);
          } catch (err) {
            console.error("Error in WebSocket wildcard callback:", err);
          }
        });
      }
    } catch (err) {
      console.error("Failed to parse WebSocket message:", err);
    }
  }, []);

  const connect = useCallback(() => {
    if (!address || !enabled || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(`${WS_URL}/ws/${address}`);

      ws.onopen = () => {
        console.log("WebSocket connected");
        setConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected:", event.code, event.reason);
        setConnected(false);
        wsRef.current = null;

        // Attempt reconnect if not intentional disconnect
        if (
          !intentionalDisconnectRef.current &&
          reconnect &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          const backoff = Math.min(
            reconnectInterval * Math.pow(2, reconnectAttemptsRef.current),
            30000 // Max 30 seconds
          );

          reconnectAttemptsRef.current += 1;
          console.log(
            `Reconnecting in ${backoff}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, backoff);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
    }
  }, [address, enabled, reconnect, reconnectInterval, maxReconnectAttempts, handleMessage]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);
  }, []);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === "string" ? data : JSON.stringify(data));
    } else {
      console.warn("WebSocket not connected, cannot send:", data);
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    if (address && enabled) {
      intentionalDisconnectRef.current = false;
      connect();
    }

    return () => {
      disconnect();
    };
  }, [address, enabled, connect, disconnect]);

  return {
    connected,
    subscribe,
    send,
  };
}
