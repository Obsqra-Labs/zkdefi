pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * RiskPassportTier Circuit
 *
 * Privacy-preserving risk tier assignment for zkde.fi.
 * Computes a weighted risk score from multiple metrics and assigns a tier 1-5.
 * Proves the subject meets a required tier WITHOUT revealing individual metrics.
 *
 * Raw score formula:
 *   raw_score = volatility + max_drawdown + concentration + leverage
 *             + liquidation_events * 500 + (365 - tenure_days) * 100
 *
 * Tier assignment (lower score = lower risk = lower tier number):
 *   Tier 1: score <= threshold[0]
 *   Tier 2: threshold[0] < score <= threshold[1]
 *   Tier 3: threshold[1] < score <= threshold[2]
 *   Tier 4: threshold[2] < score <= threshold[3]
 *   Tier 5: threshold[3] < score <= threshold[4]
 *
 * Privacy guarantees:
 *   - Individual risk metrics are PRIVATE
 *   - Computed risk score is PRIVATE
 *   - Only tier compliance (boolean) and computed tier are PUBLIC
 */

template RiskPassportModel() {
    // === PRIVATE INPUTS ===
    signal input volatility_bps;
    signal input max_drawdown_bps;
    signal input concentration_bps;
    signal input effective_leverage_bps;
    signal input liquidation_events_lookback;
    signal input tenure_days;
    signal input computed_risk_score;

    // === PUBLIC INPUTS ===
    signal input tier_thresholds[5];
    signal input required_tier;
    signal input scale;

    // === OUTPUTS ===
    signal output is_compliant;
    signal output computed_tier;

    // === CONSTRAINTS ===

    // Step 1: Enforce tenure_days <= 365
    component le_tenure = LessEqThan(64);
    le_tenure.in[0] <== tenure_days;
    le_tenure.in[1] <== 365;
    le_tenure.out === 1;

    // Step 2: Compute raw risk score
    signal raw_score;
    raw_score <== volatility_bps + max_drawdown_bps + concentration_bps
               + effective_leverage_bps
               + liquidation_events_lookback * 500
               + 36500 - tenure_days * 100;

    // Step 3: Verify computed_risk_score = raw_score / scale (integer division)
    // computed_risk_score * scale <= raw_score < (computed_risk_score + 1) * scale
    signal lower_bound;
    lower_bound <== computed_risk_score * scale;
    signal upper_bound;
    upper_bound <== lower_bound + scale;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== raw_score;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== raw_score;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Step 4: Enforce tier_thresholds monotonically increasing
    component lt_mono[4];
    for (var i = 0; i < 4; i++) {
        lt_mono[i] = LessThan(64);
        lt_mono[i].in[0] <== tier_thresholds[i];
        lt_mono[i].in[1] <== tier_thresholds[i + 1];
        lt_mono[i].out === 1;
    }

    // Step 5: Enforce computed_risk_score <= tier_thresholds[4]
    component le_max_tier = LessEqThan(64);
    le_max_tier.in[0] <== computed_risk_score;
    le_max_tier.in[1] <== tier_thresholds[4];
    le_max_tier.out === 1;

    // Step 6: Determine computed_tier
    // tier = 1 + (score > threshold[0]) + (score > threshold[1])
    //          + (score > threshold[2]) + (score > threshold[3])
    component gt_thresh[4];
    for (var i = 0; i < 4; i++) {
        gt_thresh[i] = LessThan(64);
        gt_thresh[i].in[0] <== tier_thresholds[i];
        gt_thresh[i].in[1] <== computed_risk_score;
    }

    computed_tier <== 1 + gt_thresh[0].out + gt_thresh[1].out
                        + gt_thresh[2].out + gt_thresh[3].out;

    // Step 7: Check compliance — computed_tier <= required_tier
    component le_tier = LessEqThan(64);
    le_tier.in[0] <== computed_tier;
    le_tier.in[1] <== required_tier;
    is_compliant <== le_tier.out;
}

/*
 * RiskPassportTierVerifier
 *
 * Main circuit wrapping the risk passport model with commitment binding.
 */
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
    signal output is_compliant;
    signal output computed_tier;
    signal output public_commitment;

    // Run risk passport model
    component model = RiskPassportModel();
    model.volatility_bps <== volatility_bps;
    model.max_drawdown_bps <== max_drawdown_bps;
    model.concentration_bps <== concentration_bps;
    model.effective_leverage_bps <== effective_leverage_bps;
    model.liquidation_events_lookback <== liquidation_events_lookback;
    model.tenure_days <== tenure_days;
    model.computed_risk_score <== computed_risk_score;
    model.tier_thresholds <== tier_thresholds;
    model.required_tier <== required_tier;
    model.scale <== scale;

    is_compliant <== model.is_compliant;
    computed_tier <== model.computed_tier;
    public_commitment <== computed_risk_score + blinding;
}

component main {public [tier_thresholds, required_tier, scale, subject_id_hash, policy_hash]} = RiskPassportTierVerifier();
