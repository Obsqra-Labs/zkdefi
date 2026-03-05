"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Key, Clock, Shield, X, Check, AlertTriangle, Loader2 } from "lucide-react";
import { useAccount } from "@starknet-react/core";
import { executeCalls } from "@/lib/tx/executeCalls";

import { API_BASE } from "@/lib/api/client";

/** Convert a BigInt-ish value to Starknet u256 calldata [low, high] */
function toU256Calldata(value: bigint): [string, string] {
  const U128_MOD = BigInt(1) << BigInt(128);
  return [(value % U128_MOD).toString(), (value / U128_MOD).toString()];
}

interface Session {
  session_id: string;
  session_key: string;
  max_position: number;
  allowed_protocols: string[];
  duration_hours: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  is_expired: boolean;
  pending_grant: boolean;
  pending_revoke: boolean;
}

interface SessionKeyManagerProps {
  userAddress: string;
  onSessionGranted?: (sessionId: string) => void;
  /** Lifts active session info to parent for header chip display */
  onSessionInfo?: (info: { sessionId: string | null; expiresAt: string | null }) => void;
}

export function SessionKeyManager({ userAddress, onSessionGranted, onSessionInfo }: SessionKeyManagerProps) {
  const { account } = useAccount();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showGrantModal, setShowGrantModal] = useState(false);
  
  // Grant form state
  const [sessionKeyAddress, setSessionKeyAddress] = useState("");
  const [maxPosition, setMaxPosition] = useState(10000);
  const [allowedProtocols, setAllowedProtocols] = useState<string[]>(["pools", "ekubo", "jediswap"]);
  const [durationHours, setDurationHours] = useState(24);
  
  useEffect(() => {
    if (userAddress) {
      fetchSessions();
    }
  }, [userAddress]);
  
  const fetchSessions = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/list/${userAddress}`);
      if (response.ok) {
        const data = await response.json();
        const list: Session[] = data.sessions || [];
        setSessions(list);
        // Lift active session info to parent
        const active = list.find(s => s.is_active && !s.is_expired);
        onSessionInfo?.({
          sessionId: active?.session_id ?? null,
          expiresAt: active?.expires_at ?? null,
        });
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleGrantSession = async () => {
    if (!sessionKeyAddress || !account) return;
    
    setGranting(true);
    try {
      // Step 1: Register session intent with backend → get calldata + contract_address
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner_address: userAddress,
          session_key_address: sessionKeyAddress,
          max_position: maxPosition,
          allowed_protocols: allowedProtocols,
          duration_hours: durationHours
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const contractAddress = data.contract_address as string;
        const calldata = data.calldata;

        // Step 2: Execute on-chain grant_session via wallet
        // grant_session(session_key, max_position_u256, allowed_protocols, duration_seconds)
        const [posLow, posHigh] = toU256Calldata(BigInt(calldata.max_position));
        const result = await executeCalls({
          account,
          calls: [
            {
              contractAddress: contractAddress as `0x${string}`,
              entrypoint: "grant_session",
              calldata: [
                calldata.session_key,       // session_key: ContractAddress
                posLow,                     // max_position.low: u128
                posHigh,                    // max_position.high: u128
                String(calldata.allowed_protocols), // allowed_protocols: u8
                String(calldata.duration_seconds),  // duration_seconds: u64
              ],
            },
          ],
        });

        // Step 3: Confirm with backend using real tx_hash
        await confirmGrant(data.session_id, result.transaction_hash);
        setShowGrantModal(false);
        await fetchSessions(); // Refresh session list so new key appears immediately
        onSessionGranted?.(data.session_id);
      }
    } catch (error) {
      console.error("Failed to grant session:", error);
    } finally {
      setGranting(false);
    }
  };
  
  const confirmGrant = async (sessionId: string, txHash: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/grant/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, tx_hash: txHash })
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to confirm grant:", error);
    }
  };
  
  const handleRevokeSession = async (sessionId: string) => {
    if (!account) return;
    
    setRevoking(sessionId);
    try {
      // Step 1: Register revoke intent with backend → get calldata + contract_address
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          owner_address: userAddress
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const contractAddress = data.contract_address as string;

        // Step 2: Execute on-chain revoke_session via wallet
        // revoke_session(session_id: felt252)
        // Truncate to felt252 (max 252 bits = 63 hex chars)
        const sessionIdFelt = sessionId.startsWith("0x")
          ? "0x" + sessionId.slice(2, 65)
          : sessionId;

        const result = await executeCalls({
          account,
          calls: [
            {
              contractAddress: contractAddress as `0x${string}`,
              entrypoint: "revoke_session",
              calldata: [sessionIdFelt],
            },
          ],
        });

        // Step 3: Confirm revocation with backend using real tx_hash
        await fetch(`${API_BASE}/api/v1/zkdefi/session_keys/revoke/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, tx_hash: result.transaction_hash })
        });
        await fetchSessions();
      }
    } catch (error) {
      console.error("Failed to revoke session:", error);
    } finally {
      setRevoking(null);
    }
  };
  
  const toggleProtocol = (protocol: string) => {
    if (allowedProtocols.includes(protocol)) {
      setAllowedProtocols(allowedProtocols.filter(p => p !== protocol));
    } else {
      setAllowedProtocols([...allowedProtocols, protocol]);
    }
  };
  
  const formatTimeRemaining = (expiresAt: string) => {
    const expires = new Date(expiresAt);
    const now = new Date();
    const diff = expires.getTime() - now.getTime();
    
    if (diff <= 0) return "Expired";
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };
  
  const activeSessions = sessions.filter(s => s.is_active && !s.is_expired);
  const expiredSessions = sessions.filter(s => s.is_expired);
  const pendingSessions = sessions.filter(s => s.pending_grant || s.pending_revoke);
  const hasActiveSession = activeSessions.length > 0;
  const activeSession = activeSessions[0] ?? null;
  
  const totalSessions = sessions.length;
  const sessionSummary = totalSessions === 0
    ? "No sessions"
    : activeSessions.length > 0
      ? `${activeSessions.length} active`
      : expiredSessions.length > 0
        ? `${expiredSessions.length} expired`
        : `${pendingSessions.length} pending`;
  
  return (
    <div className="glass rounded-2xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center">
            <Key className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Session Keys</h3>
            <p className="text-xs text-zinc-500">
              {sessionSummary}
              {totalSessions > 0 && expiredSessions.length > 0 && activeSessions.length === 0 && (
                <span className="ml-2 text-orange-400">(needs renewal)</span>
              )}
            </p>
          </div>
        </div>
        
        <button
          onClick={() => setShowGrantModal(true)}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Key className="w-4 h-4" />
          Grant Session
        </button>
      </div>

      {hasActiveSession && activeSession && (
        <div className="rounded-lg border border-emerald-700/30 bg-emerald-950/10 px-3 py-2 text-xs flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-emerald-400/80">
            <Key className="w-3.5 h-3.5" />
            <span>Session active — agent can execute within your constraints</span>
          </div>
          <span className="text-zinc-500">
            Expires: {activeSession.expires_at ? new Date(activeSession.expires_at).toLocaleString() : "—"}
          </span>
        </div>
      )}

      {!hasActiveSession && !loading && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/20 p-4 space-y-3 mb-4">
          <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Key className="w-4 h-4 text-cyan-400" />
            What you&apos;re granting
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-zinc-900/50 border border-zinc-700 p-3">
              <p className="text-zinc-400 mb-1 font-medium">Scope</p>
              <p className="text-zinc-300">The agent can execute rebalances and yield actions within your vault — it cannot withdraw to external addresses or change your risk profile.</p>
            </div>
            <div className="rounded-lg bg-zinc-900/50 border border-zinc-700 p-3">
              <p className="text-zinc-400 mb-1 font-medium">Duration</p>
              <p className="text-zinc-300">Session keys expire after the duration you set (default: 24 hours). You can revoke at any time from this panel.</p>
            </div>
            <div className="rounded-lg bg-zinc-900/50 border border-zinc-700 p-3">
              <p className="text-zinc-400 mb-1 font-medium">Constraints</p>
              <p className="text-zinc-300">Max position size, risk profile, and allowed adapters are enforced on-chain. Every action requires a zkML proof that satisfies these bounds.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <Shield className="w-3 h-3 flex-shrink-0" />
            <span>Session keys use Starknet&apos;s native account abstraction — no separate approval transaction needed.</span>
          </div>
        </div>
      )}
      
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <Key className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No session keys granted</p>
          <p className="text-xs mt-1">Grant a session key to enable autonomous agent execution</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.session_id}
              className={`rounded-xl border p-4 ${
                session.is_active && !session.is_expired
                  ? "border-violet-500/30 bg-violet-950/20"
                  : "border-zinc-700/50 bg-zinc-800/30 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {session.is_active && !session.is_expired ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : session.is_expired ? (
                      <Clock className="w-4 h-4 text-amber-400" />
                    ) : (
                      <X className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-sm font-medium">
                      {session.is_active && !session.is_expired
                        ? "Active"
                        : session.is_expired
                        ? "Expired"
                        : "Revoked"}
                    </span>
                    {session.is_active && !session.is_expired && (
                      <span className="text-xs text-zinc-500">
                        • {formatTimeRemaining(session.expires_at)} remaining
                      </span>
                    )}
                  </div>
                  
                  <div className="text-xs text-zinc-400 font-mono mb-2">
                    {session.session_id.slice(0, 10)}...{session.session_id.slice(-8)}
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(session.allowed_protocols ?? []).map((protocol) => (
                      <span
                        key={protocol}
                        className="px-2 py-0.5 bg-zinc-700/50 rounded text-xs text-zinc-300"
                      >
                        {protocol}
                      </span>
                    ))}
                  </div>
                  
                  <div className="text-xs text-zinc-500">
                    Max position: {(session.max_position ?? 0).toLocaleString()} • Duration: {session.duration_hours ?? 0}h
                  </div>
                </div>
                
                {session.is_active && !session.is_expired && (
                  <button
                    onClick={() => handleRevokeSession(session.session_id)}
                    disabled={revoking === session.session_id}
                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-red-400 disabled:opacity-50"
                    title="Revoke session"
                  >
                    {revoking === session.session_id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Grant Modal - portaled to body so it always appears above other content */}
      {showGrantModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4" onClick={(e) => e.target === e.currentTarget && setShowGrantModal(false)}>
          <div className="bg-zinc-900 rounded-2xl border border-zinc-700 p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Grant Session Key</h3>
              <button
                onClick={() => setShowGrantModal(false)}
                className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Session Key Address</label>
                <input
                  type="text"
                  value={sessionKeyAddress}
                  onChange={(e) => setSessionKeyAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                />
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Max Position Size</label>
                <input
                  type="number"
                  value={maxPosition}
                  onChange={(e) => setMaxPosition(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Allowed Protocols</label>
                <div className="flex gap-2">
                  {["pools", "ekubo", "jediswap", "lending"].map((protocol) => (
                    <button
                      key={protocol}
                      onClick={() => toggleProtocol(protocol)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        allowedProtocols.includes(protocol)
                          ? "bg-violet-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {protocol}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Duration (hours)</label>
                <select
                  value={durationHours}
                  onChange={(e) => setDurationHours(parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-violet-500"
                >
                  <option value={1}>1 hour</option>
                  <option value={6}>6 hours</option>
                  <option value={12}>12 hours</option>
                  <option value={24}>24 hours</option>
                  <option value={168}>7 days</option>
                </select>
              </div>
              
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200">
                  This session key will allow the agent to execute transactions on your behalf within the specified constraints.
                </p>
              </div>
              
              <button
                onClick={handleGrantSession}
                disabled={granting || !sessionKeyAddress || allowedProtocols.length === 0 || !account}
                className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {granting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Granting...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    Grant Session Key
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
