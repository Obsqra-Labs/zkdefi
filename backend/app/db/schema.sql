-- zkDeFi Decision Event Store Schema
-- PostgreSQL 14+
--
-- Stores per-user decision events for the predictive creditworthiness
-- model, behavioral risk scoring, and audit trail.

-- ─── Core events table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS decision_events (
    id              BIGSERIAL PRIMARY KEY,
    user_address    TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,     -- deposit, withdraw, rebalance, borrow, repay,
                                              -- early_exit, proof_generated, proof_failed,
                                              -- gate_allow, gate_block, gate_advisory,
                                              -- tier_upgrade, tier_downgrade, collateral_slash
    gate            TEXT,                     -- relayer, execution, lending (NULL for non-gate events)
    outcome         TEXT,                     -- allow, block, advisory, success, failure
    value_eth       DOUBLE PRECISION DEFAULT 0,
    proof_mode      TEXT,                     -- EZKL_ONLY, EZKL_BRIDGE, FULL_DUAL_PROVER
    model_name      TEXT,                     -- Which ML model was used (if any)
    model_hash      TEXT,                     -- Hash of model weights used
    metadata        JSONB       DEFAULT '{}', -- Flexible extra data
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices for query patterns
CREATE INDEX IF NOT EXISTS idx_events_user       ON decision_events (user_address);
CREATE INDEX IF NOT EXISTS idx_events_type       ON decision_events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_user_type  ON decision_events (user_address, event_type);
CREATE INDEX IF NOT EXISTS idx_events_created    ON decision_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_gate       ON decision_events (gate) WHERE gate IS NOT NULL;

-- ─── Materialized view: per-user behavioral stats ──────────────────────
-- Refreshed periodically by a background worker or on-demand.

CREATE MATERIALIZED VIEW IF NOT EXISTS user_behavior_stats AS
SELECT
    user_address,

    -- Action counts
    COUNT(*) FILTER (WHERE event_type IN ('deposit','withdraw','rebalance','borrow','repay'))
        AS total_actions,
    COUNT(*) FILTER (WHERE event_type = 'early_exit')
        AS early_exit_count,
    COUNT(*) FILTER (WHERE event_type = 'proof_generated')
        AS proof_success_count,
    COUNT(*) FILTER (WHERE event_type = 'proof_failed')
        AS proof_failure_count,
    COUNT(*) FILTER (WHERE event_type = 'collateral_slash')
        AS slash_count,

    -- Rates
    CASE
        WHEN COUNT(*) FILTER (WHERE event_type IN ('deposit','withdraw','rebalance')) > 0
        THEN COUNT(*) FILTER (WHERE event_type = 'early_exit')::FLOAT
             / COUNT(*) FILTER (WHERE event_type IN ('deposit','withdraw','rebalance'))
        ELSE 0
    END AS early_exit_rate,

    CASE
        WHEN (COUNT(*) FILTER (WHERE event_type IN ('proof_generated','proof_failed'))) > 0
        THEN COUNT(*) FILTER (WHERE event_type = 'proof_generated')::FLOAT
             / (COUNT(*) FILTER (WHERE event_type IN ('proof_generated','proof_failed')))
        ELSE 1.0
    END AS proof_success_rate,

    -- Value stats
    COALESCE(AVG(value_eth) FILTER (WHERE event_type IN ('deposit','withdraw','rebalance')), 0)
        AS avg_action_size_eth,
    COALESCE(MAX(value_eth) FILTER (WHERE event_type IN ('deposit','withdraw','rebalance')), 0)
        AS max_action_size_eth,
    COALESCE(SUM(value_eth) FILTER (WHERE event_type IN ('deposit','withdraw','rebalance')), 0)
        AS total_volume_eth,

    -- Time stats
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen,
    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 3600
        AS activity_span_hours,

    -- Proof mode usage
    COUNT(*) FILTER (WHERE proof_mode = 'EZKL_ONLY')       AS ezkl_only_count,
    COUNT(*) FILTER (WHERE proof_mode = 'EZKL_BRIDGE')     AS ezkl_bridge_count,
    COUNT(*) FILTER (WHERE proof_mode = 'FULL_DUAL_PROVER') AS full_dual_count,

    -- Gate outcomes
    COUNT(*) FILTER (WHERE outcome = 'allow')    AS gate_allow_count,
    COUNT(*) FILTER (WHERE outcome = 'block')    AS gate_block_count,
    COUNT(*) FILTER (WHERE outcome = 'advisory') AS gate_advisory_count,

    -- Tier events
    COUNT(*) FILTER (WHERE event_type = 'tier_upgrade')   AS tier_upgrade_count,
    COUNT(*) FILTER (WHERE event_type = 'tier_downgrade') AS tier_downgrade_count

FROM decision_events
GROUP BY user_address;

-- Index on the materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_ubs_user ON user_behavior_stats (user_address);

-- ─── Collaborative credit edges table ──────────────────────────────────
-- Tracks co-investment relationships between users for the credit graph.

CREATE TABLE IF NOT EXISTS credit_graph_edges (
    id              BIGSERIAL PRIMARY KEY,
    user_a          TEXT        NOT NULL,
    user_b          TEXT        NOT NULL,
    pool_id         TEXT        NOT NULL,
    overlap_hours   DOUBLE PRECISION DEFAULT 0,  -- Duration of co-investment
    combined_tvl    DOUBLE PRECISION DEFAULT 0,  -- Combined TVL in the pool
    weight          DOUBLE PRECISION DEFAULT 0,  -- Edge weight = overlap_hours * combined_tvl
    first_overlap   TIMESTAMPTZ,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_edge UNIQUE (user_a, user_b, pool_id)
);

CREATE INDEX IF NOT EXISTS idx_edges_user_a ON credit_graph_edges (user_a);
CREATE INDEX IF NOT EXISTS idx_edges_user_b ON credit_graph_edges (user_b);

-- ─── Adversarial robustness certificates ───────────────────────────────

CREATE TABLE IF NOT EXISTS robustness_certificates (
    id              BIGSERIAL PRIMARY KEY,
    model_name      TEXT        NOT NULL,
    model_hash      TEXT        NOT NULL,
    attack_suite_hash TEXT      NOT NULL,
    attack_count    INTEGER     NOT NULL,
    pass_count      INTEGER     NOT NULL,
    pass_rate_bps   INTEGER     NOT NULL,
    proof_hash      TEXT,
    certified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_certs_model ON robustness_certificates (model_name, model_hash);
