"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsEvent<T = Record<string, unknown>> {
  type: string;
  data?: T;
  message?: string;
  timestamp?: string;
}

export type WsStatus = "connecting" | "open" | "closed" | "error";

export interface UseWebSocketOptions {
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Reconnect on close (default: true) */
  reconnect?: boolean;
  /** Max reconnect attempts (default: 10) */
  maxRetries?: number;
  /** Base reconnect delay in ms (default: 1000). Doubles each attempt. */
  reconnectDelay?: number;
  /** Ping interval in ms (default: 30 000) */
  pingInterval?: number;
  /** Event handler called for every incoming event */
  onEvent?: (event: WsEvent) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket(
  address: string | undefined,
  options: UseWebSocketOptions = {},
) {
  const {
    autoConnect = true,
    reconnect = true,
    maxRetries = 10,
    reconnectDelay = 1000,
    pingInterval = 30_000,
    onEvent,
  } = options;

  const [status, setStatus] = useState<WsStatus>("closed");
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Derive WS URL from existing API_BASE (http→ws, https→wss)
  const wsBase = API_BASE.replace(/^http/, "ws");

  const cleanup = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    pingRef.current = null;
    reconnectTimerRef.current = null;
  }, []);

  const connect = useCallback(() => {
    if (!address) return;
    cleanup();

    const url = `${wsBase}/ws/${address}`;
    setStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      retriesRef.current = 0;
      // Start keep-alive ping
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, pingInterval);
    };

    ws.onmessage = (evt) => {
      try {
        const event: WsEvent = JSON.parse(evt.data);
        setLastEvent(event);
        onEventRef.current?.(event);
      } catch {
        // Non-JSON payload — ignore
      }
    };

    ws.onerror = () => setStatus("error");

    ws.onclose = () => {
      setStatus("closed");
      cleanup();
      if (reconnect && retriesRef.current < maxRetries) {
        const delay = reconnectDelay * 2 ** retriesRef.current;
        retriesRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, [address, wsBase, pingInterval, reconnect, maxRetries, reconnectDelay, cleanup]);

  const disconnect = useCallback(() => {
    cleanup();
    retriesRef.current = maxRetries; // prevent auto-reconnect
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("closed");
  }, [cleanup, maxRetries]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // Auto-connect / reconnect on address change
  useEffect(() => {
    if (autoConnect && address) {
      connect();
    }
    return () => {
      cleanup();
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, autoConnect]);

  return { status, lastEvent, connect, disconnect, send } as const;
}
