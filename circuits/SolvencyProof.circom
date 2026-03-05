pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";

/*
 * SolvencyProof Circuit
 *
 * Proves total assets are greater than or equal to total liabilities
 * without revealing individual position values.
 */

template SolvencyModel(N_ASSETS, N_DEBTS) {
    // Private inputs
    signal input asset_positions[N_ASSETS];
    signal input debt_positions[N_DEBTS];
    signal input pricing_commitment;
    signal input blinding;

    // Public inputs
    signal input min_solvency_ratio_bps;
    signal input scale;

    // Outputs
    signal output is_solvent;
    signal output solvency_ratio_bps_bucket; // 0-4 bucket
    signal output data_binding;

    // Sum assets
    signal sum_assets[N_ASSETS + 1];
    sum_assets[0] <== 0;
    for (var i = 0; i < N_ASSETS; i++) {
        sum_assets[i + 1] <== sum_assets[i] + asset_positions[i];
    }

    // Sum liabilities
    signal sum_liabilities[N_DEBTS + 1];
    sum_liabilities[0] <== 0;
    for (var j = 0; j < N_DEBTS; j++) {
        sum_liabilities[j + 1] <== sum_liabilities[j] + debt_positions[j];
    }

    signal total_assets;
    signal total_liabilities;
    total_assets <== sum_assets[N_ASSETS];
    total_liabilities <== sum_liabilities[N_DEBTS];

    // Compare: total_assets * scale >= min_solvency_ratio_bps * total_liabilities
    signal lhs;
    signal rhs;
    lhs <== total_assets * scale;
    rhs <== min_solvency_ratio_bps * total_liabilities;

    component liab_zero = IsZero();
    liab_zero.in <== total_liabilities;

    component ge_ratio = GreaterEqThan(128);
    ge_ratio.in[0] <== lhs;
    ge_ratio.in[1] <== rhs;

    signal non_zero_selector;
    non_zero_selector <== 1 - liab_zero.out;

    // Liabilities=0 => solvent by definition
    is_solvent <== liab_zero.out + non_zero_selector * ge_ratio.out;

    // Bucket by ratio thresholds: 10000, 12000, 15000, 20000 bps
    signal rhs10000;
    signal rhs12000;
    signal rhs15000;
    signal rhs20000;

    rhs10000 <== 10000 * total_liabilities;
    rhs12000 <== 12000 * total_liabilities;
    rhs15000 <== 15000 * total_liabilities;
    rhs20000 <== 20000 * total_liabilities;

    component ge10000 = GreaterEqThan(128);
    ge10000.in[0] <== lhs;
    ge10000.in[1] <== rhs10000;

    component ge12000 = GreaterEqThan(128);
    ge12000.in[0] <== lhs;
    ge12000.in[1] <== rhs12000;

    component ge15000 = GreaterEqThan(128);
    ge15000.in[0] <== lhs;
    ge15000.in[1] <== rhs15000;

    component ge20000 = GreaterEqThan(128);
    ge20000.in[0] <== lhs;
    ge20000.in[1] <== rhs20000;

    signal non_zero_bucket;
    non_zero_bucket <== ge10000.out + ge12000.out + ge15000.out + ge20000.out;

    // If liabilities are zero, assign max bucket 4
    solvency_ratio_bps_bucket <== liab_zero.out * 4 + non_zero_selector * non_zero_bucket;

    // Bind all private inputs to a deterministic public commitment output.
    signal bind_assets[N_ASSETS + 1];
    bind_assets[0] <== pricing_commitment + blinding;
    for (var k = 0; k < N_ASSETS; k++) {
        bind_assets[k + 1] <== bind_assets[k] + asset_positions[k] * (k + 11);
    }

    signal bind_debts[N_DEBTS + 1];
    bind_debts[0] <== bind_assets[N_ASSETS];
    for (var m = 0; m < N_DEBTS; m++) {
        bind_debts[m + 1] <== bind_debts[m] + debt_positions[m] * (m + 97);
    }

    data_binding <== bind_debts[N_DEBTS];
}

template SolvencyProofVerifier() {
    var N_ASSETS = 8;
    var N_DEBTS = 8;

    // Private inputs
    signal input asset_positions[N_ASSETS];
    signal input debt_positions[N_DEBTS];
    signal input pricing_commitment;
    signal input blinding;

    // Public inputs
    signal input min_solvency_ratio_bps;
    signal input scale;
    signal input subject_id_hash;

    // Outputs
    signal output is_compliant;
    signal output solvency_tier_bucket;
    signal output public_commitment;

    component model = SolvencyModel(N_ASSETS, N_DEBTS);
    model.asset_positions <== asset_positions;
    model.debt_positions <== debt_positions;
    model.pricing_commitment <== pricing_commitment;
    model.blinding <== blinding;
    model.min_solvency_ratio_bps <== min_solvency_ratio_bps;
    model.scale <== scale;

    is_compliant <== model.is_solvent;
    solvency_tier_bucket <== model.solvency_ratio_bps_bucket;
    public_commitment <== model.data_binding + subject_id_hash;
}

component main {public [min_solvency_ratio_bps, scale, subject_id_hash]} = SolvencyProofVerifier();
