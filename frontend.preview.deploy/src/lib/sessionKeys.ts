/**
 * Session Keys Library
 * 
 * Utilities for managing session keys with Starknet account abstraction.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";

export interface SessionKeyConfig {
  sessionKeyAddress: string;
  maxPosition: number;
  allowedProtocols: string[];
  durationHours: number;
}

export interface Session {
  sessionId: string;
  sessionKey: string;
  maxPosition: number;
  allowedProtocols: string[];
  durationHours: number;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
  isExpired: boolean;
}

/**
 * Generate a session key grant request
 */
export async function generateSessionRequest(
  ownerAddress: string,
  config: SessionKeyConfig
): Promise<{
  sessionId: string;
  calldata: Record<string, any>;
  contractAddress: string;
  entrypoint: string;
}> {
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_address: ownerAddress,
      session_key_address: config.sessionKeyAddress,
      max_position: config.maxPosition,
      allowed_protocols: config.allowedProtocols,
      duration_hours: config.durationHours,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to generate session request");
  }

  const data = await response.json();
  return {
    sessionId: data.session_id,
    calldata: data.calldata,
    contractAddress: data.contract_address,
    entrypoint: data.entrypoint,
  };
}

/**
 * Confirm session grant on-chain
 */
export async function confirmSessionGrant(
  sessionId: string,
  txHash: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/grant/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      tx_hash: txHash,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to confirm session grant");
  }
}

/**
 * Revoke a session key
 */
export async function revokeSession(
  sessionId: string,
  ownerAddress: string
): Promise<{
  calldata: Record<string, any>;
  contractAddress: string;
  entrypoint: string;
}> {
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      owner_address: ownerAddress,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to revoke session");
  }

  const data = await response.json();
  return {
    calldata: data.calldata,
    contractAddress: data.contract_address,
    entrypoint: data.entrypoint,
  };
}

/**
 * Get all sessions for a user
 */
export async function getUserSessions(ownerAddress: string): Promise<Session[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/zkdefi/session_keys/list/${ownerAddress}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch sessions");
  }

  const data = await response.json();
  return (data.sessions || []).map((s: any) => ({
    sessionId: s.session_id,
    sessionKey: s.session_key,
    maxPosition: s.max_position,
    allowedProtocols: s.allowed_protocols,
    durationHours: s.duration_hours,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    isActive: s.is_active,
    isExpired: s.is_expired,
  }));
}

/**
 * Validate if an action is allowed under a session
 */
export async function validateSession(
  sessionId: string,
  protocolId: number,
  amount: number
): Promise<{
  isValid: boolean;
  reason?: string;
  remainingTimeSeconds?: number;
}> {
  const response = await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      protocol_id: protocolId,
      amount: amount,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to validate session");
  }

  const data = await response.json();
  return {
    isValid: data.is_valid,
    reason: data.reason,
    remainingTimeSeconds: data.remaining_time_seconds,
  };
}

/**
 * Calculate time remaining for a session
 */
export function getTimeRemaining(expiresAt: string): {
  hours: number;
  minutes: number;
  isExpired: boolean;
} {
  const expires = new Date(expiresAt);
  const now = new Date();
  const diff = expires.getTime() - now.getTime();

  if (diff <= 0) {
    return { hours: 0, minutes: 0, isExpired: true };
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return { hours, minutes, isExpired: false };
}

/**
 * Format time remaining as string
 */
export function formatTimeRemaining(expiresAt: string): string {
  const { hours, minutes, isExpired } = getTimeRemaining(expiresAt);

  if (isExpired) return "Expired";
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Convert protocol names to bitmap
 */
export function protocolsToBitmap(protocols: string[]): number {
  const protocolMap: Record<string, number> = {
    pools: 1,
    ekubo: 2,
    jediswap: 4,
  };

  return protocols.reduce((bitmap, protocol) => {
    return bitmap | (protocolMap[protocol.toLowerCase()] || 0);
  }, 0);
}

/**
 * Convert bitmap to protocol names
 */
export function bitmapToProtocols(bitmap: number): string[] {
  const protocols: string[] = [];
  if (bitmap & 1) protocols.push("pools");
  if (bitmap & 2) protocols.push("ekubo");
  if (bitmap & 4) protocols.push("jediswap");
  return protocols;
}
