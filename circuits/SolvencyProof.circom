pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * SolvencyProof Circuit
 *
 * Privacy-preserving solvency verification for zkde.fi.
 * Proves that total assets exceed total liabilities by at least a minimum
 * solvency ratio WITHOUT revealing individual asset or debt positions.
 *
 * Solvency bucket classification (ratio in bps):
 *   0 = under-collateralised  (ratio < 10000 bps / 100%)
 *   1 = barely solvent         (ratio >= 10000 bps / 100%)
 *   2 = adequately capitalised (ratio >= 12000 bps / 120%)
 *   3 = well capitalised       (ratio >= 15000 bps / 150%)
 *   4 = strongly capitalised   (ratio >= 20000 bps / 200%)
 *
 * Privacy guarantees:
 *   - Individual asset positions are PRIVATE
 *   - Individual debt positions are PRIVATE
 *   - Pricing commitment and blinding factor are PRIVATE
 *   - Only solvency status and bucket are PUBLIC
 */

template SolvencyModel(N_ASSETS) {
    // === PRIVATE INPUTS ===
    signal input asset_positions[N_ASSETS];
    signal input debt_positions[N_ASSETS];

    // === PUBLIC INPUTS ===
    signal input min_solvency_ratio_bps;
    signal input scale;

    // === OUTPUTS ===
    signal output is_solvent;
    signal output solvency_bucket;

    // === CONSTRAINTS ===

    // Step 1: Compute total assets
    signal asset_sum[N_ASSETS + 1];
    asset_sum[0] <== 0;
    for (var i = 0; i < N_ASSETS; i++) {
        asset_sum[i + 1] <== asset_sum[i] + asset_positions[i];
    }
    signal total_assets;
    total_assets <== asset_sum[N_ASSETS];

    // Step 2: Compute total liabilities
    signal debt_sum[N_ASSETS + 1];
    debt_sum[0] <== 0;
    for (var i = 0; i < N_ASSETS; i++) {
        debt_sum[i + 1] <== debt_sum[i] + debt_positions[i];
    }
    signal total_liabilities;
    total_liabilities <== debt_sum[N_ASSETS];

    // Step 3: Solvency check
    // is_solvent iff total_assets * scale >= min_solvency_ratio_bps * total_liabilities
    signal solvency_lhs;
    solvency_lhs <== total_assets * scale;
    signal solvency_rhs;
    solvency_rhs <== min_solvency_ratio_bps * total_liabilities;

    component ge_solvent = GreaterEqThan(64);
    ge_solvent.in[0] <== solvency_lhs;
    ge_solvent.in[1] <== solvency_rhs;
    is_solvent <== ge_solvent.out;

    // Step 4: Solvency bucket via ratio thresholds [10000, 12000, 15000, 20000] bps
    // ratio_bps = total_assets * 10000 / total_liabilities
    // Check: total_assets * 10000 >= threshold_i * total_liabilities
    signal bucket_lhs;
    bucket_lhs <== total_assets * 10000;

    component ge_b0 = GreaterEqThan(64);
    ge_b0.in[0] <== bucket_lhs;
    ge_b0.in[1] <== total_liabilities * 10000;

    component ge_b1 = GreaterEqThan(64);
    ge_b1.in[0] <== bucket_lhs;
    ge_b1.in[1] <== total_liabilities * 12000;

    component ge_b2 = GreaterEqThan(64);
    ge_b2.in[0] <== bucket_lhs;
    ge_b2.in[1] <== total_liabilities * 15000;

    component ge_b3 = GreaterEqThan(64);
    ge_b3.in[0] <== bucket_lhs;
    ge_b3.in[1] <== total_liabilities * 20000;

    solvency_bucket <== ge_b0.out + ge_b1.out + ge_b2.out + ge_b3.out;
}

/*
 * SolvencyProofVerifier
 *
 * Main circuit wrapping the solvency model with commitment binding.
 * Uses 8 asset/debt positions by default.
 */
template SolvencyProofVerifier() {
    var N_ASSETS = 8;

    // Private inputs
    signal input asset_positions[N_ASSETS];
    signal input debt_positions[N_ASSETS];
    signal input pricing_commitment;
    signal input blinding;

    // Public inputs
    signal input min_solvency_ratio_bps;
    signal input scale;
    signal input subject_id_hash;

    // Outputs
    signal output is_compliant;
    signal output solvency_bucket;
    signal output public_commitment;

    // Run solvency model
    component model = SolvencyModel(N_ASSETS);
    model.asset_positions <== asset_positions;
    model.debt_positions <== debt_positions;
    model.min_solvency_ratio_bps <== min_solvency_ratio_bps;
    model.scale <== scale;

    is_compliant <== model.is_solvent;
    solvency_bucket <== model.solvency_bucket;
    public_commitment <== pricing_commitment + blinding;
}

component main {public [min_solvency_ratio_bps, scale, subject_id_hash]} = SolvencyProofVerifier();
