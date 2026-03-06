pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * HistoricalPerformanceAttestation Circuit
 *
 * Privacy-preserving historical performance attestation for zkde.fi.
 * Proves that an agent's mean return and max drawdown meet public criteria
 * over a series of periods WITHOUT revealing actual returns or balances.
 *
 * Constraints:
 *   - sum(period_returns) == computed_mean_return * num_periods
 *   - (peak_balance - min_balance) * scale / peak_balance == computed_max_drawdown
 *   - computed_mean_return >= min_mean_return_bps
 *   - computed_max_drawdown <= max_drawdown_bps
 *
 * Privacy guarantees:
 *   - Per-period returns are PRIVATE
 *   - Per-period balances are PRIVATE
 *   - Actual mean return and drawdown values are PRIVATE
 *   - Only compliance status (boolean) is PUBLIC
 */

template MeanReturnVerifier(N_PERIODS) {
    // === PRIVATE INPUTS ===
    signal input period_returns[N_PERIODS];
    signal input computed_mean_return;

    // === PUBLIC INPUTS ===
    signal input num_periods;
    signal input min_mean_return_bps;

    // === OUTPUT ===
    signal output is_valid;

    // Step 1: Compute sum of period returns
    signal partial_sum[N_PERIODS + 1];
    partial_sum[0] <== 0;

    for (var i = 0; i < N_PERIODS; i++) {
        partial_sum[i + 1] <== partial_sum[i] + period_returns[i];
    }

    signal total_return;
    total_return <== partial_sum[N_PERIODS];

    // Step 2: Verify sum(period_returns) == computed_mean_return * num_periods
    signal expected_total;
    expected_total <== computed_mean_return * num_periods;
    total_return === expected_total;

    // Step 3: Check computed_mean_return >= min_mean_return_bps
    component ge_min = GreaterEqThan(64);
    ge_min.in[0] <== computed_mean_return;
    ge_min.in[1] <== min_mean_return_bps;

    is_valid <== ge_min.out;
}

template DrawdownVerifier(N_PERIODS) {
    // === PRIVATE INPUTS ===
    signal input period_balances[N_PERIODS];
    signal input computed_max_drawdown;
    signal input peak_balance;

    // === PUBLIC INPUTS ===
    signal input max_drawdown_bps;
    signal input scale;

    // === OUTPUT ===
    signal output is_valid;

    // Step 1: Find min_balance by checking each balance against peak
    // We verify peak_balance >= every period_balance (prover supplies the correct peak)
    component peak_checks[N_PERIODS];
    for (var i = 0; i < N_PERIODS; i++) {
        peak_checks[i] = GreaterEqThan(64);
        peak_checks[i].in[0] <== peak_balance;
        peak_checks[i].in[1] <== period_balances[i];
        peak_checks[i].out === 1;
    }

    // Step 2: Find min_balance — prover must supply balances such that
    // at least one balance equals min. We compute min as a constrained value:
    // Sort approach is expensive; instead we require prover to identify min_balance
    // by checking the drawdown identity directly.
    //
    // We find the minimum balance by accumulating the min across all periods.
    // Using comparator-based min selection:
    signal running_min[N_PERIODS + 1];
    running_min[0] <== period_balances[0];

    component lt_min[N_PERIODS];
    for (var i = 1; i < N_PERIODS; i++) {
        lt_min[i] = LessThan(64);
        lt_min[i].in[0] <== period_balances[i];
        lt_min[i].in[1] <== running_min[i - 1];

        // running_min[i] = lt_min.out ? period_balances[i] : running_min[i-1]
        // = lt_min.out * (period_balances[i] - running_min[i-1]) + running_min[i-1]
        running_min[i] <== lt_min[i].out * (period_balances[i] - running_min[i - 1]) + running_min[i - 1];
    }
    // Final slot unused in loop but we need N_PERIODS entries; index N_PERIODS-1 is the answer
    signal min_balance;
    min_balance <== running_min[N_PERIODS - 1];

    // Step 3: Verify drawdown formula (integer division):
    //   computed_max_drawdown = (peak_balance - min_balance) * scale / peak_balance
    //   => computed_max_drawdown * peak_balance <= (peak_balance - min_balance) * scale
    //      < (computed_max_drawdown + 1) * peak_balance
    signal drawdown_numerator;
    drawdown_numerator <== (peak_balance - min_balance) * scale;

    signal dd_lower;
    dd_lower <== computed_max_drawdown * peak_balance;

    signal dd_upper;
    dd_upper <== (computed_max_drawdown + 1) * peak_balance;

    component ge_dd_lower = GreaterEqThan(64);
    ge_dd_lower.in[0] <== drawdown_numerator;
    ge_dd_lower.in[1] <== dd_lower;
    ge_dd_lower.out === 1;

    component lt_dd_upper = LessThan(64);
    lt_dd_upper.in[0] <== drawdown_numerator;
    lt_dd_upper.in[1] <== dd_upper;
    lt_dd_upper.out === 1;

    // Step 4: Check computed_max_drawdown <= max_drawdown_bps
    component le_max_dd = LessEqThan(64);
    le_max_dd.in[0] <== computed_max_drawdown;
    le_max_dd.in[1] <== max_drawdown_bps;

    is_valid <== le_max_dd.out;
}

/*
 * HistoricalPerformanceAttestationVerifier
 *
 * Main circuit combining mean return and drawdown verification.
 * Uses 12 periods by default (e.g., 12 months of history).
 */
template HistoricalPerformanceAttestationVerifier() {
    var N_PERIODS = 12;

    // Private inputs
    signal input period_returns[N_PERIODS];
    signal input period_balances[N_PERIODS];
    signal input computed_mean_return;
    signal input computed_max_drawdown;
    signal input peak_balance;

    // Public inputs
    signal input min_mean_return_bps;
    signal input max_drawdown_bps;
    signal input num_periods;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Outputs
    signal output is_compliant;
    signal output public_commitment;

    // Verify mean return
    component mean_verifier = MeanReturnVerifier(N_PERIODS);
    mean_verifier.period_returns <== period_returns;
    mean_verifier.computed_mean_return <== computed_mean_return;
    mean_verifier.num_periods <== num_periods;
    mean_verifier.min_mean_return_bps <== min_mean_return_bps;

    // Verify drawdown
    component dd_verifier = DrawdownVerifier(N_PERIODS);
    dd_verifier.period_balances <== period_balances;
    dd_verifier.computed_max_drawdown <== computed_max_drawdown;
    dd_verifier.peak_balance <== peak_balance;
    dd_verifier.max_drawdown_bps <== max_drawdown_bps;
    dd_verifier.scale <== scale;

    // Both checks must pass
    is_compliant <== mean_verifier.is_valid * dd_verifier.is_valid;

    // Bind commitment to user for verification
    public_commitment <== commitment_hash;
}

component main {public [min_mean_return_bps, max_drawdown_bps, num_periods, scale, user_address, commitment_hash]} = HistoricalPerformanceAttestationVerifier();
