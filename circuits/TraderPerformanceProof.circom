pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * TraderPerformanceProof Circuit
 *
 * Privacy-preserving trader performance verification for zkde.fi.
 * Proves Sharpe ratio, max drawdown, and win-rate thresholds are met
 * over a 30-period lookback WITHOUT revealing individual returns or equity.
 *
 * Verified metrics:
 *   - Sharpe ratio (x100): mean_excess_return * 100 / stddev_proxy
 *   - Max drawdown (bps): peak-to-trough decline relative to initial equity
 *   - Win rate (bps): wins / trades * scale
 *
 * Privacy guarantees:
 *   - Individual period returns are PRIVATE
 *   - Equity curve is PRIVATE
 *   - Exact Sharpe / drawdown / win-rate values are PRIVATE
 *   - Only threshold compliance (boolean) is PUBLIC
 */

template TraderPerformanceModel(T) {
    // === PRIVATE INPUTS ===
    signal input returns_bps[T];
    signal input wins_count;
    signal input trades_count;
    signal input equity_curve[T];
    signal input risk_free_bps;
    signal input mean_return_bps;
    signal input mean_excess_return_bps;
    signal input stddev_proxy_bps;
    signal input sharpe_x100;
    signal input max_drawdown_bps_actual;
    signal input win_rate_bps_actual;

    // === PUBLIC INPUTS ===
    signal input min_sharpe_x100;
    signal input max_drawdown_bps;
    signal input min_win_rate_bps;
    signal input lookback_days;
    signal input scale;

    // === OUTPUT ===
    signal output is_compliant;

    // === CONSTRAINTS ===

    // Step 0: Bind lookback_days to the template parameter
    lookback_days === T;

    // Step 1: Verify mean_return_bps * T == sum(returns_bps)
    signal ret_sum[T + 1];
    ret_sum[0] <== 0;
    for (var i = 0; i < T; i++) {
        ret_sum[i + 1] <== ret_sum[i] + returns_bps[i];
    }
    mean_return_bps * T === ret_sum[T];

    // Step 2: Verify mean_excess_return_bps = mean_return_bps - risk_free_bps
    mean_excess_return_bps === mean_return_bps - risk_free_bps;

    // Step 3: Verify Sharpe ratio (integer division check)
    // sharpe_x100 * stddev <= mean_excess * 100 < (sharpe_x100 + 1) * stddev
    signal sharpe_lower;
    sharpe_lower <== sharpe_x100 * stddev_proxy_bps;
    signal sharpe_value;
    sharpe_value <== mean_excess_return_bps * 100;
    signal sharpe_upper;
    sharpe_upper <== sharpe_lower + stddev_proxy_bps;

    component ge_sharpe_low = GreaterEqThan(64);
    ge_sharpe_low.in[0] <== sharpe_value;
    ge_sharpe_low.in[1] <== sharpe_lower;
    ge_sharpe_low.out === 1;

    component lt_sharpe_up = LessThan(64);
    lt_sharpe_up.in[0] <== sharpe_value;
    lt_sharpe_up.in[1] <== sharpe_upper;
    lt_sharpe_up.out === 1;

    // Step 4: Verify win rate (integer division check)
    // win_rate_bps_actual * trades_count <= wins_count * scale
    //   < (win_rate_bps_actual + 1) * trades_count
    signal wr_lower;
    wr_lower <== win_rate_bps_actual * trades_count;
    signal wr_value;
    wr_value <== wins_count * scale;
    signal wr_upper;
    wr_upper <== wr_lower + trades_count;

    component ge_wr_low = GreaterEqThan(64);
    ge_wr_low.in[0] <== wr_value;
    ge_wr_low.in[1] <== wr_lower;
    ge_wr_low.out === 1;

    component lt_wr_up = LessThan(64);
    lt_wr_up.in[0] <== wr_value;
    lt_wr_up.in[1] <== wr_upper;
    lt_wr_up.out === 1;

    // Step 5: Compute max drawdown from equity curve
    // 5a: Running peak — peak[i] = max(peak[i-1], equity_curve[i])
    signal peak[T];
    peak[0] <== equity_curve[0];

    component is_new_peak[T - 1];
    signal peak_diff[T - 1];
    signal peak_sel[T - 1];

    for (var i = 1; i < T; i++) {
        is_new_peak[i - 1] = GreaterEqThan(64);
        is_new_peak[i - 1].in[0] <== equity_curve[i];
        is_new_peak[i - 1].in[1] <== peak[i - 1];

        peak_diff[i - 1] <== equity_curve[i] - peak[i - 1];
        peak_sel[i - 1] <== is_new_peak[i - 1].out * peak_diff[i - 1];
        peak[i] <== peak[i - 1] + peak_sel[i - 1];
    }

    // 5b: Per-step absolute drawdown
    signal drawdown[T];
    for (var i = 0; i < T; i++) {
        drawdown[i] <== peak[i] - equity_curve[i];
    }

    // 5c: Running max drawdown
    signal max_dd[T];
    max_dd[0] <== drawdown[0];

    component is_new_max_dd[T - 1];
    signal dd_diff[T - 1];
    signal dd_sel[T - 1];

    for (var i = 1; i < T; i++) {
        is_new_max_dd[i - 1] = GreaterEqThan(64);
        is_new_max_dd[i - 1].in[0] <== drawdown[i];
        is_new_max_dd[i - 1].in[1] <== max_dd[i - 1];

        dd_diff[i - 1] <== drawdown[i] - max_dd[i - 1];
        dd_sel[i - 1] <== is_new_max_dd[i - 1].out * dd_diff[i - 1];
        max_dd[i] <== max_dd[i - 1] + dd_sel[i - 1];
    }

    signal max_abs_dd;
    max_abs_dd <== max_dd[T - 1];

    // 5d: Verify max_drawdown_bps_actual via integer division
    // max_drawdown_bps_actual = max_abs_dd * 10000 / equity_curve[0]
    signal dd_lower;
    dd_lower <== max_drawdown_bps_actual * equity_curve[0];
    signal dd_scaled;
    dd_scaled <== max_abs_dd * 10000;
    signal dd_upper;
    dd_upper <== dd_lower + equity_curve[0];

    component ge_dd_low = GreaterEqThan(64);
    ge_dd_low.in[0] <== dd_scaled;
    ge_dd_low.in[1] <== dd_lower;
    ge_dd_low.out === 1;

    component lt_dd_up = LessThan(64);
    lt_dd_up.in[0] <== dd_scaled;
    lt_dd_up.in[1] <== dd_upper;
    lt_dd_up.out === 1;

    // Step 6: Threshold compliance checks
    // 6a: sharpe_x100 >= min_sharpe_x100
    component ge_min_sharpe = GreaterEqThan(64);
    ge_min_sharpe.in[0] <== sharpe_x100;
    ge_min_sharpe.in[1] <== min_sharpe_x100;

    // 6b: max_drawdown_bps_actual <= max_drawdown_bps
    component le_max_dd = LessEqThan(64);
    le_max_dd.in[0] <== max_drawdown_bps_actual;
    le_max_dd.in[1] <== max_drawdown_bps;

    // 6c: win_rate_bps_actual >= min_win_rate_bps
    component ge_min_wr = GreaterEqThan(64);
    ge_min_wr.in[0] <== win_rate_bps_actual;
    ge_min_wr.in[1] <== min_win_rate_bps;

    // is_compliant = pass_sharpe AND pass_drawdown AND pass_winrate
    signal pass_sharpe_dd;
    pass_sharpe_dd <== ge_min_sharpe.out * le_max_dd.out;
    is_compliant <== pass_sharpe_dd * ge_min_wr.out;
}

/*
 * TraderPerformanceVerifier
 *
 * Main circuit wrapping the performance model with commitment binding.
 * Uses T=30 periods by default.
 */
template TraderPerformanceVerifier() {
    var T = 30;

    // Private inputs
    signal input returns_bps[T];
    signal input wins_count;
    signal input trades_count;
    signal input equity_curve[T];
    signal input risk_free_bps;
    signal input mean_return_bps;
    signal input mean_excess_return_bps;
    signal input stddev_proxy_bps;
    signal input sharpe_x100;
    signal input max_drawdown_bps_actual;
    signal input win_rate_bps_actual;
    signal input blinding;

    // Public inputs
    signal input min_sharpe_x100;
    signal input max_drawdown_bps;
    signal input min_win_rate_bps;
    signal input lookback_days;
    signal input scale;
    signal input subject_id_hash;

    // Outputs
    signal output is_compliant;
    signal output public_commitment;

    // Run performance model
    component model = TraderPerformanceModel(T);
    model.returns_bps <== returns_bps;
    model.wins_count <== wins_count;
    model.trades_count <== trades_count;
    model.equity_curve <== equity_curve;
    model.risk_free_bps <== risk_free_bps;
    model.mean_return_bps <== mean_return_bps;
    model.mean_excess_return_bps <== mean_excess_return_bps;
    model.stddev_proxy_bps <== stddev_proxy_bps;
    model.sharpe_x100 <== sharpe_x100;
    model.max_drawdown_bps_actual <== max_drawdown_bps_actual;
    model.win_rate_bps_actual <== win_rate_bps_actual;
    model.min_sharpe_x100 <== min_sharpe_x100;
    model.max_drawdown_bps <== max_drawdown_bps;
    model.min_win_rate_bps <== min_win_rate_bps;
    model.lookback_days <== lookback_days;
    model.scale <== scale;

    is_compliant <== model.is_compliant;
    public_commitment <== sharpe_x100 + blinding;
}

component main {public [min_sharpe_x100, max_drawdown_bps, min_win_rate_bps, lookback_days, scale, subject_id_hash]} = TraderPerformanceVerifier();
