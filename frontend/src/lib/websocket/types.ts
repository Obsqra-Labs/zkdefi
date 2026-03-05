/**
 * WebSocket Event Types
 * 
 * TypeScript types for all WebSocket events from backend.
 */

export interface BaseEvent {
  type: string;
  timestamp: string;
}

export interface StrategyUpdateEvent extends BaseEvent {
  type: "strategy_update";
  data: {
    strategy_id: string;
    genome_composite: number;
    pool_id: string;
    pair: string;
    apy: number;
    risk_score: number;
  };
}

export interface MarketChangeEvent extends BaseEvent {
  type: "market_change";
  data: {
    change_type: "apy_spike" | "tvl_drain" | "new_opportunity";
    pool_id: string;
    old_value: number;
    new_value: number;
    change_pct: number;
  };
}

export interface AlertEvent extends BaseEvent {
  type: "alert";
  data: {
    user_address: string;
    severity: "low" | "medium" | "high";
    alert_type: "out_of_range" | "high_il" | "apy_drop" | "low_liquidity";
    message: string;
    action?: string;
  };
}

export interface ProofCompleteEvent extends BaseEvent {
  type: "proof_complete";
  data: {
    user_address: string;
    proof_type: "deposit" | "withdraw" | "zkml";
    proof_hash: string;
    success: boolean;
  };
}

export interface PositionUpdateEvent extends BaseEvent {
  type: "position_update";
  data: {
    user_address: string;
    position_id: string;
    current_value: number;
  };
}

export interface AgentStatusChangeEvent extends BaseEvent {
  type: "agent_status_change";
  data: {
    user_address: string;
    agent_id: string;
    status: "active" | "paused" | "rebalancing";
  };
}

export interface ConnectedEvent extends BaseEvent {
  type: "connected";
  message: string;
}

export interface PingEvent extends BaseEvent {
  type: "ping";
}

export interface PongEvent extends BaseEvent {
  type: "pong";
}

export type WebSocketEvent =
  | StrategyUpdateEvent
  | MarketChangeEvent
  | AlertEvent
  | ProofCompleteEvent
  | PositionUpdateEvent
  | AgentStatusChangeEvent
  | ConnectedEvent
  | PingEvent
  | PongEvent;

export type EventCallback = (data: any) => void;

export interface UseWebSocketReturn {
  connected: boolean;
  subscribe: (eventType: string, callback: EventCallback) => () => void;
  send: (data: any) => void;
}
