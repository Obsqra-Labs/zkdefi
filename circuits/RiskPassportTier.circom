pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";

/*
 * RiskPassportTier Circuit
 *
 * Deterministic risk-tier proof with configurable tier thresholds.
 * Lower score => lower risk tier.
 */

template RiskPassportModel() {
    // Private inputs
    signal input volatility_bps;
    signal input max_drawdown_bps;
    signal input concentration_bps;
    signal input effective_leverage_bps;
    signal input liquidation_events_lookback;
    signal input tenure_days;
    signal input computed_risk_score;
    signal input blinding;

    // Public inputs
    signal input tier_thresholds[5];
    signal input required_tier;
    signal input scale;

    // Outputs
    signal output risk_tier;                 // 1..5
    signal output is_within_required_tier;   // 0/1
    signal output risk_score;
    signal output data_binding;

    // Guard tenure_days range for stable scoring.
    component tenure_le_365 = LessEqThan(64);
    tenure_le_365.in[0] <== tenure_days;
    tenure_le_365.in[1] <== 365;
    tenure_le_365.out === 1;

    // Weighted score components.
    signal tenure_risk;
    tenure_risk <== 365 - tenure_days;

    signal liquidation_penalty;
    liquidation_penalty <== liquidation_events_lookback * 500;

    signal tenure_penalty;
    tenure_penalty <== tenure_risk * 100;

    signal raw_score;
    raw_score <==
        volatility_bps +
        max_drawdown_bps +
        concentration_bps +
        effective_leverage_bps +
        liquidation_penalty +
        tenure_penalty;

    // Integer quotient check:
    // computed_risk_score * scale <= raw_score < (computed_risk_score + 1) * scale
    signal lower_bound;
    signal upper_bound;
    lower_bound <== computed_risk_score * scale;
    upper_bound <== (computed_risk_score + 1) * scale;

    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== raw_score;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(128);
    lt_upper.in[0] <== raw_score;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Threshold monotonicity checks.
    component th01 = LessEqThan(64);
    th01.in[0] <== tier_thresholds[0];
    th01.in[1] <== tier_thresholds[1];
    th01.out === 1;

    component th12 = LessEqThan(64);
    th12.in[0] <== tier_thresholds[1];
    th12.in[1] <== tier_thresholds[2];
    th12.out === 1;

    component th23 = LessEqThan(64);
    th23.in[0] <== tier_thresholds[2];
    th23.in[1] <== tier_thresholds[3];
    th23.out === 1;

    component th34 = LessEqThan(64);
    th34.in[0] <== tier_thresholds[3];
    th34.in[1] <== tier_thresholds[4];
    th34.out === 1;

    // Tier mapping using first 4 boundaries.
    component le_t1 = LessEqThan(64);
    le_t1.in[0] <== computed_risk_score;
    le_t1.in[1] <== tier_thresholds[0];

    component le_t2 = LessEqThan(64);
    le_t2.in[0] <== computed_risk_score;
    le_t2.in[1] <== tier_thresholds[1];

    component le_t3 = LessEqThan(64);
    le_t3.in[0] <== computed_risk_score;
    le_t3.in[1] <== tier_thresholds[2];

    component le_t4 = LessEqThan(64);
    le_t4.in[0] <== computed_risk_score;
    le_t4.in[1] <== tier_thresholds[3];

    // Cap check against last threshold.
    component le_t5 = LessEqThan(64);
    le_t5.in[0] <== computed_risk_score;
    le_t5.in[1] <== tier_thresholds[4];
    le_t5.out === 1;

    signal gt_t1;
    signal gt_t2;
    signal gt_t3;
    signal gt_t4;
    gt_t1 <== 1 - le_t1.out;
    gt_t2 <== 1 - le_t2.out;
    gt_t3 <== 1 - le_t3.out;
    gt_t4 <== 1 - le_t4.out;

    risk_tier <== 1 + gt_t1 + gt_t2 + gt_t3 + gt_t4;

    // Required tier range checks.
    component ge_req1 = GreaterEqThan(8);
    ge_req1.in[0] <== required_tier;
    ge_req1.in[1] <== 1;
    ge_req1.out === 1;

    component le_req5 = LessEqThan(8);
    le_req5.in[0] <== required_tier;
    le_req5.in[1] <== 5;
    le_req5.out === 1;

    component le_required = LessEqThan(8);
    le_required.in[0] <== risk_tier;
    le_required.in[1] <== required_tier;

    is_within_required_tier <== le_required.out;
    risk_score <== computed_risk_score;

    // Deterministic binding over private payload.
    data_binding <==
        blinding +
        volatility_bps * 3 +
        max_drawdown_bps * 5 +
        concentration_bps * 7 +
        effective_leverage_bps * 11 +
        liquidation_events_lookback * 13 +
        tenure_days * 17 +
        computed_risk_score * 19;
}

template RiskPassportTierVerifier() {
    // Private inputs
    signal input volatility_bps;
    signal input max_drawdown_bps;
    signal input concentration_bps;
    signal input effective_leverage_bps;
    signal input liquidation_events_lookback;
    signal input tenure_days;
    signal input computed_risk_score;
    signal input blinding;

    // Public inputs
    signal input tier_thresholds[5];
    signal input required_tier;
    signal input scale;
    signal input subject_id_hash;
    signal input policy_hash;

    // Outputs
    signal output risk_tier;
    signal output is_within_required_tier;
    signal output risk_score;
    signal output public_commitment;

    component model = RiskPassportModel();
    model.volatility_bps <== volatility_bps;
    model.max_drawdown_bps <== max_drawdown_bps;
    model.concentration_bps <== concentration_bps;
    model.effective_leverage_bps <== effective_leverage_bps;
    model.liquidation_events_lookback <== liquidation_events_lookback;
    model.tenure_days <== tenure_days;
    model.computed_risk_score <== computed_risk_score;
    model.blinding <== blinding;

    model.tier_thresholds <== tier_thresholds;
    model.required_tier <== required_tier;
    model.scale <== scale;

    risk_tier <== model.risk_tier;
    is_within_required_tier <== model.is_within_required_tier;
    risk_score <== model.risk_score;
    public_commitment <== model.data_binding + subject_id_hash + policy_hash;
}

component main {public [tier_thresholds, required_tier, scale, subject_id_hash, policy_hash]} = RiskPassportTierVerifier();
