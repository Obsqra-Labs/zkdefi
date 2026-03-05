pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";

/*
 * TraderPerformanceProof Circuit
 *
 * Proves threshold compliance for Sharpe proxy, max drawdown, and win-rate
 * without revealing raw returns or full equity curve.
 */

template TraderPerformanceModel(T) {
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

    // Outputs
    signal output meets_sharpe;
    signal output meets_drawdown;
    signal output meets_win_rate;
    signal output performance_pass;
    signal output performance_tier_bucket; // 0..3
    signal output data_binding;

    // Enforce lookback alignment and non-zero denominators.
    lookback_days === T;

    component trades_gt_zero = GreaterThan(64);
    trades_gt_zero.in[0] <== trades_count;
    trades_gt_zero.in[1] <== 0;
    trades_gt_zero.out === 1;

    component stddev_gt_zero = GreaterThan(64);
    stddev_gt_zero.in[0] <== stddev_proxy_bps;
    stddev_gt_zero.in[1] <== 0;
    stddev_gt_zero.out === 1;

    component wins_le_trades = LessEqThan(64);
    wins_le_trades.in[0] <== wins_count;
    wins_le_trades.in[1] <== trades_count;
    wins_le_trades.out === 1;

    // Mean return consistency.
    signal sum_returns[T + 1];
    sum_returns[0] <== 0;
    for (var i = 0; i < T; i++) {
        sum_returns[i + 1] <== sum_returns[i] + returns_bps[i];
    }

    signal mean_times_t;
    mean_times_t <== mean_return_bps * T;
    mean_times_t === sum_returns[T];

    // mean_excess = mean_return - risk_free
    mean_excess_return_bps + risk_free_bps === mean_return_bps;

    // Sharpe approximation: sharpe_x100 ~= (mean_excess * 100) / stddev_proxy
    signal sharpe_num;
    signal sharpe_lower;
    signal sharpe_upper;
    sharpe_num <== mean_excess_return_bps * 100;
    sharpe_lower <== sharpe_x100 * stddev_proxy_bps;
    sharpe_upper <== (sharpe_x100 + 1) * stddev_proxy_bps;

    component ge_sharpe_lower = GreaterEqThan(128);
    ge_sharpe_lower.in[0] <== sharpe_num;
    ge_sharpe_lower.in[1] <== sharpe_lower;
    ge_sharpe_lower.out === 1;

    component lt_sharpe_upper = LessThan(128);
    lt_sharpe_upper.in[0] <== sharpe_num;
    lt_sharpe_upper.in[1] <== sharpe_upper;
    lt_sharpe_upper.out === 1;

    // Win-rate consistency: win_rate ~= wins / trades
    signal winrate_num;
    signal winrate_lower;
    signal winrate_upper;
    winrate_num <== wins_count * scale;
    winrate_lower <== win_rate_bps_actual * trades_count;
    winrate_upper <== (win_rate_bps_actual + 1) * trades_count;

    component ge_wr_lower = GreaterEqThan(128);
    ge_wr_lower.in[0] <== winrate_num;
    ge_wr_lower.in[1] <== winrate_lower;
    ge_wr_lower.out === 1;

    component lt_wr_upper = LessThan(128);
    lt_wr_upper.in[0] <== winrate_num;
    lt_wr_upper.in[1] <== winrate_upper;
    lt_wr_upper.out === 1;

    // Coarse drawdown consistency via global max/min from equity curve.
    signal eq_max[T];
    signal eq_min[T];
    eq_max[0] <== equity_curve[0];
    eq_min[0] <== equity_curve[0];

    component max_ge[T - 1];
    component min_le[T - 1];
    signal max_sel[T - 1];
    signal min_sel[T - 1];
    // Intermediates to keep constraints quadratic
    signal max_sel_times_diff[T - 1];
    signal min_sel_times_diff[T - 1];

    for (var j = 1; j < T; j++) {
        max_ge[j - 1] = GreaterEqThan(64);
        max_ge[j - 1].in[0] <== equity_curve[j];
        max_ge[j - 1].in[1] <== eq_max[j - 1];
        max_sel[j - 1] <== max_ge[j - 1].out;
        // eq_max[j] = eq_max[j-1] + max_sel * (equity_curve[j] - eq_max[j-1])
        max_sel_times_diff[j - 1] <== max_sel[j - 1] * (equity_curve[j] - eq_max[j - 1]);
        eq_max[j] <== eq_max[j - 1] + max_sel_times_diff[j - 1];

        min_le[j - 1] = LessEqThan(64);
        min_le[j - 1].in[0] <== equity_curve[j];
        min_le[j - 1].in[1] <== eq_min[j - 1];
        min_sel[j - 1] <== min_le[j - 1].out;
        // eq_min[j] = eq_min[j-1] + min_sel * (equity_curve[j] - eq_min[j-1])
        min_sel_times_diff[j - 1] <== min_sel[j - 1] * (equity_curve[j] - eq_min[j - 1]);
        eq_min[j] <== eq_min[j - 1] + min_sel_times_diff[j - 1];
    }

    component eqmax_gt_zero = GreaterThan(64);
    eqmax_gt_zero.in[0] <== eq_max[T - 1];
    eqmax_gt_zero.in[1] <== 0;
    eqmax_gt_zero.out === 1;

    signal draw_num;
    signal draw_lower;
    signal draw_upper;
    draw_num <== (eq_max[T - 1] - eq_min[T - 1]) * scale;
    draw_lower <== max_drawdown_bps_actual * eq_max[T - 1];
    draw_upper <== (max_drawdown_bps_actual + 1) * eq_max[T - 1];

    component ge_draw_lower = GreaterEqThan(128);
    ge_draw_lower.in[0] <== draw_num;
    ge_draw_lower.in[1] <== draw_lower;
    ge_draw_lower.out === 1;

    component lt_draw_upper = LessThan(128);
    lt_draw_upper.in[0] <== draw_num;
    lt_draw_upper.in[1] <== draw_upper;
    lt_draw_upper.out === 1;

    // Threshold checks.
    component sharpe_ge_min = GreaterEqThan(64);
    sharpe_ge_min.in[0] <== sharpe_x100;
    sharpe_ge_min.in[1] <== min_sharpe_x100;
    meets_sharpe <== sharpe_ge_min.out;

    component drawdown_le_max = LessEqThan(64);
    drawdown_le_max.in[0] <== max_drawdown_bps_actual;
    drawdown_le_max.in[1] <== max_drawdown_bps;
    meets_drawdown <== drawdown_le_max.out;

    component winrate_ge_min = GreaterEqThan(64);
    winrate_ge_min.in[0] <== win_rate_bps_actual;
    winrate_ge_min.in[1] <== min_win_rate_bps;
    meets_win_rate <== winrate_ge_min.out;

    // Split triple product into quadratic steps
    signal sharpe_and_drawdown;
    sharpe_and_drawdown <== meets_sharpe * meets_drawdown;
    performance_pass <== sharpe_and_drawdown * meets_win_rate;
    performance_tier_bucket <== meets_sharpe + meets_drawdown + meets_win_rate;

    // Bind full private payload for deterministic receipt generation.
    signal bind_returns[T + 1];
    bind_returns[0] <==
        blinding +
        mean_return_bps +
        mean_excess_return_bps +
        stddev_proxy_bps +
        sharpe_x100 +
        max_drawdown_bps_actual +
        win_rate_bps_actual +
        wins_count +
        trades_count +
        risk_free_bps;

    for (var k = 0; k < T; k++) {
        bind_returns[k + 1] <== bind_returns[k] + returns_bps[k] * (k + 31);
    }

    signal bind_equity[T + 1];
    bind_equity[0] <== bind_returns[T];
    for (var m = 0; m < T; m++) {
        bind_equity[m + 1] <== bind_equity[m] + equity_curve[m] * (m + 79);
    }

    data_binding <== bind_equity[T];
}

template TraderPerformanceProofVerifier() {
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
    signal output meets_sharpe;
    signal output meets_drawdown;
    signal output meets_win_rate;
    signal output performance_pass;
    signal output performance_tier_bucket;
    signal output public_commitment;

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
    model.blinding <== blinding;

    model.min_sharpe_x100 <== min_sharpe_x100;
    model.max_drawdown_bps <== max_drawdown_bps;
    model.min_win_rate_bps <== min_win_rate_bps;
    model.lookback_days <== lookback_days;
    model.scale <== scale;

    meets_sharpe <== model.meets_sharpe;
    meets_drawdown <== model.meets_drawdown;
    meets_win_rate <== model.meets_win_rate;
    performance_pass <== model.performance_pass;
    performance_tier_bucket <== model.performance_tier_bucket;
    public_commitment <== model.data_binding + subject_id_hash;
}

component main {public [min_sharpe_x100, max_drawdown_bps, min_win_rate_bps, lookback_days, scale, subject_id_hash]} = TraderPerformanceProofVerifier();
