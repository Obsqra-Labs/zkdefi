export interface SessionKeySummary {
  session_id: string;
  is_active: boolean;
  is_expired: boolean;
  expires_at: string;
}

export interface SessionKeyListResponse {
  sessions: SessionKeySummary[];
}
