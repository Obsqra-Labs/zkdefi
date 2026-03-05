pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * HistoricalPerformanceAttestation Circuit
 *
 * Privacy-preserving historical performance verification.
 * Proves an agent's historical performance meets minimum criteria
 * WITHOUT revealing individual period returns or balances.
 *
 * Model:
 *   mean_return = Σ(period_returns[i]) / num_periods
 *   max_drawdown = max drop from peak across periods
 *   meets_criteria = mean_return >= min_mean_return AND drawdown <= max_drawdown_limit
 *
 * Privacy guarantees:
 *   - Individual period returns are PRIVATE
 *   - Period balances are PRIVATE
 *   - Only meets_criteria (boolean) is PUBLIC
 */

template PerformanceModel(N_PERIODS) {
    // === PRIVATE INPUTS ===
    signal input period_returns[N_PERIODS];   // Return in bps per period (private)
    signal input period_balances[N_PERIODS];  // End-of-period balance (private)
    signal input computed_mean_return;        // Pre-computed mean return in bps (private)
    signal input computed_max_drawdown;       // Pre-computed max drawdown in bps (private)
    signal input peak_balance;               // Highest balance observed (private)

    // === PUBLIC INPUTS ===
    signal input min_mean_return_bps;   // Required minimum mean return (public)
    signal input max_drawdown_bps;      // Maximum allowable drawdown (public)
    signal input num_periods;           // Number of periods with data (public, <= N_PERIODS)
    signal input scale;                 // Scaling factor (public)

    // === OUTPUT ===
    signal output meets_criteria;       // 1 if performance meets requirements

    // === CONSTRAINTS ===

    // Verify num_periods <= N_PERIODS
    component le_periods = LessEqThan(8);
    le_periods.in[0] <== num_periods;
    le_periods.in[1] <== N_PERIODS;
    le_periods.out === 1;

    // Step 1: Verify computed_mean_return
    // mean = Σ(returns) / num_periods
    // → mean * num_periods <= Σ(returns) < (mean + 1) * num_periods
    signal return_sum[N_PERIODS + 1];
    return_sum[0] <== 0;
    for (var i = 0; i < N_PERIODS; i++) {
        return_sum[i + 1] <== return_sum[i] + period_returns[i];
    }
    signal total_return;
    total_return <== return_sum[N_PERIODS];

    signal mean_lower;
    mean_lower <== computed_mean_return * num_periods;

    signal mean_upper;
    mean_upper <== (computed_mean_return + 1) * num_periods;

    component ge_mean = GreaterEqThan(128);
    ge_mean.in[0] <== total_return;
    ge_mean.in[1] <== mean_lower;
    ge_mean.out === 1;

    component lt_mean = LessThan(128);
    lt_mean.in[0] <== total_return;
    lt_mean.in[1] <== mean_upper;
    lt_mean.out === 1;

    // Step 2: Verify peak_balance >= all period_balances
    component peak_checks[N_PERIODS];
    for (var i = 0; i < N_PERIODS; i++) {
        peak_checks[i] = GreaterEqThan(128);
        peak_checks[i].in[0] <== peak_balance;
        peak_checks[i].in[1] <== period_balances[i];
        peak_checks[i].out === 1;
    }

    // Step 3: Verify peak_balance equals at least one period_balance
    signal peak_diffs[N_PERIODS];
    signal peak_diff_product[N_PERIODS + 1];
    peak_diff_product[0] <== 1;
    for (var i = 0; i < N_PERIODS; i++) {
        peak_diffs[i] <== peak_balance - period_balances[i];
        peak_diff_product[i + 1] <== peak_diff_product[i] * peak_diffs[i];
    }
    component peak_prod_zero = IsZero();
    peak_prod_zero.in <== peak_diff_product[N_PERIODS];
    peak_prod_zero.out === 1;

    // Step 4: Verify max drawdown
    // drawdown_bps = (peak_balance - min_balance) * 10000 / peak_balance
    // We verify: computed_max_drawdown * peak_balance <= (peak - min_balance) * 10000
    //            computed_max_drawdown * peak_balance + peak_balance > (peak - min_balance) * 10000
    // We verify computed_max_drawdown by checking at least one period shows this drawdown
    // For simplicity: check peak - lowest balance matches drawdown claim
    // Find minimum balance across all periods
    // First, find a balance that is smallest (prover claims computed_max_drawdown)
    // Drawdown = (peak - trough) * 10000 / peak
    // We verify the prover's claim: check there exists a period where
    // balance <= peak - (computed_max_drawdown * peak / 10000)
    // and no balance < peak - (computed_max_drawdown * peak / 10000) - tolerance

    // Simplified: just verify computed_max_drawdown satisfies the bound
    // drawdown_claim * peak_balance <= 10000 * (peak_balance - min_of_all_balances)
    // We require prover to provide min_balance index claim

    // For each period i, check: period_balances[i] * 10000 >= peak_balance * (10000 - computed_max_drawdown)
    signal dd_threshold;
    dd_threshold <== peak_balance * (10000 - computed_max_drawdown);

    component dd_checks[N_PERIODS];
    signal bal_scaled[N_PERIODS];
    for (var i = 0; i < N_PERIODS; i++) {
        dd_checks[i] = GreaterEqThan(128);
        bal_scaled[i] <== period_balances[i] * 10000;
        dd_checks[i].in[0] <== bal_scaled[i];
        dd_checks[i].in[1] <== dd_threshold;
        dd_checks[i].out === 1;
    }

    // Step 5: Check mean return meets minimum
    component ge_min_return = GreaterEqThan(64);
    ge_min_return.in[0] <== computed_mean_return;
    ge_min_return.in[1] <== min_mean_return_bps;
    signal return_ok;
    return_ok <== ge_min_return.out;

    // Step 6: Check drawdown within limit
    component le_max_dd = LessEqThan(64);
    le_max_dd.in[0] <== computed_max_drawdown;
    le_max_dd.in[1] <== max_drawdown_bps;
    signal drawdown_ok;
    drawdown_ok <== le_max_dd.out;

    // Step 7: Both must pass
    meets_criteria <== return_ok * drawdown_ok;
}

template HistoricalPerformanceAttestationVerifier() {
    var N_PERIODS = 12;

    // Private
    signal input period_returns[N_PERIODS];
    signal input period_balances[N_PERIODS];
    signal input computed_mean_return;
    signal input computed_max_drawdown;
    signal input peak_balance;

    // Public
    signal input min_mean_return_bps;
    signal input max_drawdown_bps;
    signal input num_periods;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = PerformanceModel(N_PERIODS);
    model.period_returns <== period_returns;
    model.period_balances <== period_balances;
    model.computed_mean_return <== computed_mean_return;
    model.computed_max_drawdown <== computed_max_drawdown;
    model.peak_balance <== peak_balance;
    model.min_mean_return_bps <== min_mean_return_bps;
    model.max_drawdown_bps <== max_drawdown_bps;
    model.num_periods <== num_periods;
    model.scale <== scale;

    is_compliant <== model.meets_criteria;
    public_commitment <== commitment_hash;
}

component main {public [min_mean_return_bps, max_drawdown_bps, num_periods, scale, user_address, commitment_hash]} = HistoricalPerformanceAttestationVerifier();
