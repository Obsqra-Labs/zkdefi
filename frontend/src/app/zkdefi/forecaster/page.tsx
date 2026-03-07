"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Brain,
  Braces,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  Info,
  Radar,
  Shield,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { apiFetch } from "@/lib/api/client";

type WindowRecord = {
  window_id: string;
  pair_id: string;
  network_id?: string;
  window_open_ts: number;
  window_close_ts: number;
  cadence_id: string;
  snapshot_hash: string;
  feature_schema_id: string;
  outcomes?: Record<string, HorizonOutcomeRecord>;
};

type HorizonOutcomeRecord = {
  horizon_min: number;
  actual_return_bps: number;
  actual_up: number;
  maturity_ts: number;
  source_id?: string;
  recorded_at_ts?: number;
};

type PredictionRecord = {
  forecast_id: string;
  window_id: string;
  subject_id: string;
  status: string;
  trust_mode: string;
  prediction_commitment: string;
  score_receipt_id?: string | null;
  outputs_scaled?: OutputMap | null;
  guess_ts?: number;
  created_at_ts?: number;
};

type PredictionListResponse = {
  predictions: PredictionRecord[];
  count: number;
};

type ScoreHistoryRow = {
  forecast_id: string;
  window_id: string;
  pair_id: string;
  status: string;
  trust_mode: string;
  created_at_ts: number;
  scored_at_ts: number;
  metrics: {
    directional_accuracy: number;
    mae_bps: number;
    brier_score: number;
    ece: number;
  };
};

type ScoreHistoryResponse = {
  history: ScoreHistoryRow[];
  count: number;
};

type HorizonBenchmarkRow = {
  horizon_min: number;
  sample_size: number;
  directional_accuracy: number;
  mae_bps: number;
  rmse_bps: number;
  bias_bps: number;
  brier_score: number;
  avg_pred_prob_up: number;
  actual_up_rate: number;
  calibration_gap: number;
};

type HorizonBenchmarksResponse = {
  subject_id: string;
  sample_forecasts: number;
  horizon_benchmarks: HorizonBenchmarkRow[];
};

type AnalyticsBenchmarksResponse = {
  sample_forecasts: number;
  filters: Record<string, string | number | null>;
  horizon_benchmarks: HorizonBenchmarkRow[];
};

type CalibrationBucket = {
  bin_index: number;
  range_lo: number;
  range_hi: number;
  count: number;
  avg_confidence: number;
  empirical_up_rate: number;
  gap: number;
};

type CalibrationHorizon = {
  horizon_min: number;
  sample_size: number;
  buckets: CalibrationBucket[];
};

type CalibrationResponse = {
  sample_forecasts: number;
  bins: number;
  horizons: CalibrationHorizon[];
};

type StageLatencySummary = {
  count: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
};

type LatencyResponse = {
  sample_forecasts: number;
  stage_latencies_sec: {
    commit_to_reveal: StageLatencySummary;
    reveal_to_score: StageLatencySummary;
    commit_to_score: StageLatencySummary;
  };
  horizon_score_lag_sec: Record<string, StageLatencySummary>;
};

type DriftFeatureRow = {
  feature: string;
  reference_mean: number;
  current_mean: number;
  delta: number;
  drift_z: number;
};

type DriftPerformanceMetric = {
  reference: number;
  current: number;
  delta: number;
};

type DriftResponse = {
  sample_forecasts: number;
  reference_count: number;
  current_count: number;
  feature_drift: DriftFeatureRow[];
  performance_drift: {
    directional_accuracy: DriftPerformanceMetric;
    mae_bps: DriftPerformanceMetric;
    brier_score: DriftPerformanceMetric;
    ece: DriftPerformanceMetric;
  };
  rolling_performance: Array<{
    idx: number;
    scored_at_ts: number;
    directional_accuracy: number;
    mae_bps: number;
    brier_score: number;
    ece: number;
  }>;
};

type LeaderboardRow = {
  model_hash: string;
  sample_size: number;
  shared_window_count: number;
  directional_accuracy: number;
  mae_bps: number;
  brier_score: number;
  ece: number;
  win_rate_shared: number;
  composite_score: number;
};

type LeaderboardResponse = {
  sample_forecasts: number;
  leaderboard: LeaderboardRow[];
};

type PnlCurvePoint = {
  scored_at_ts: number;
  equity_bps: number;
  action: "flat" | "long" | "short";
  trade_return_bps: number;
};

type PnlResponse = {
  sample_forecasts: number;
  horizon_min: number;
  params: {
    long_prob_threshold: number;
    short_prob_threshold: number;
    min_abs_return_bps: number;
    cost_per_trade_bps: number;
  };
  stats: {
    trade_count: number;
    long_count: number;
    short_count: number;
    win_rate: number;
    participation_rate: number;
    avg_trade_return_bps: number;
    cumulative_return_bps: number;
    max_drawdown_bps: number;
    buy_and_hold_bps: number;
  };
  curve: PnlCurvePoint[];
};

type ScoreReceipt = {
  score_receipt_id: string;
  forecast_id: string;
  trust_mode: string;
  metrics: {
    directional_accuracy: number;
    mae_bps: number;
    rmse_bps: number;
    brier_score: number;
    ece: number;
    horizon_count: number;
  };
  metric_tiers: Record<string, string>;
  per_horizon?: Record<
    string,
    {
      horizon_min: number;
      predicted_return_bps: number;
      actual_return_bps: number;
      predicted_prob_up: number;
      actual_up: number;
      directional_hit: boolean;
      abs_error_bps: number;
      brier: number;
    }
  >;
};

type ReputationSlice = {
  subject_id: string;
  sample_size: number;
  trust_score: number;
  avg_metrics?: Record<string, number>;
};

type ExplainResponse = {
  forecast_id: string;
  window_id: string;
  score_receipt_id?: string | null;
  narration: string;
  source: string;
  context_type: string;
  fallback_reason?: string | null;
  highlights: string[];
  context: Record<string, string | number>;
};

type OutputMap = {
  r5: number;
  r30: number;
  r240: number;
  p5: number;
  p30: number;
  p240: number;
};

type SuggestedOutputsResponse = {
  window_id: string;
  pair_id: string;
  network_id: NetworkId;
  source_id: string;
  outputs_scaled: OutputMap;
  signals: Record<string, number>;
  recent_trend_bps: number | null;
  trend_source: string;
  seed_jitter_bps: number;
};

type JsonViewMode = "text" | "genome";

type JsonScalar = string | number | boolean | null;

type GenomeEntry = {
  path: string;
  value: JsonScalar;
};

type HorizonProgress = {
  horizonMin: number;
  label: string;
  maturityTs: number;
  remainingSec: number;
  progressPct: number;
  status: "pending" | "matured_no_outcome" | "outcome_recorded" | "scored";
  predictedBps: number | null;
  predictedProbPct: number | null;
  actualBps: number | null;
  deltaBps: number | null;
  directionalHit: boolean | null;
};

type NetworkId = "starknet_sepolia" | "starknet_mainnet" | "ethereum_mainnet";
type AnalyticsNetworkFilter = "all" | NetworkId;

const NETWORK_OPTIONS: Array<{ id: NetworkId; label: string; hint: string }> = [
  {
    id: "starknet_sepolia",
    label: "Starknet Sepolia",
    hint: "Ekubo Sepolia history",
  },
  {
    id: "starknet_mainnet",
    label: "Starknet Mainnet",
    hint: "Ekubo mainnet history",
  },
  {
    id: "ethereum_mainnet",
    label: "Ethereum Mainnet",
    hint: "CoinGecko pair oracle",
  },
];

const DEFAULT_OUTPUTS: OutputMap = {
  r5: 85,
  r30: 140,
  r240: 260,
  p5: 6500,
  p30: 7000,
  p240: 7400,
};

const DEFAULT_ACTUALS = {
  h5: 70,
  h30: 110,
  h240: 210,
};

const FORECAST_HORIZONS = [5, 30, 240] as const;

const GLOSSARY: Array<{ term: string; description: string }> = [
  { term: "bps", description: "Basis points. 100 bps = 1.00%. Useful for fine-grained return comparisons." },
  {
    term: "r5 / r30 / r240",
    description: "Predicted return in bps over 5m, 30m, and 4h horizons.",
  },
  {
    term: "p5 / p30 / p240",
    description: "Predicted probability that return is positive for each horizon, scaled 0-10000.",
  },
  {
    term: "Brier",
    description: "Probability quality score. Lower is better (closer to calibrated outcomes).",
  },
  {
    term: "ECE",
    description: "Expected Calibration Error. Lower means predicted probabilities match actual hit rates better.",
  },
  {
    term: "Trust Mode",
    description: "How strong verification is: commit-only, offchain EZKL verification, or on-chain verification.",
  },
  {
    term: "Schema ID",
    description: "Versioned meaning of features and outputs. Changing schema requires version bumps.",
  },
];

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function randomSalt(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `salt_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function pretty(n: number, digits = 2): string {
  if (Number.isNaN(n)) return "0";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function bpsToPct(bps: number): number {
  return bps / 100.0;
}

function formatBpsWithPct(bps: number): string {
  const pct = bpsToPct(bps);
  const bpsPrefix = bps > 0 ? "+" : "";
  const pctPrefix = pct > 0 ? "+" : "";
  return `${bpsPrefix}${pretty(bps, 0)} bps (${pctPrefix}${pretty(pct, 2)}%)`;
}

function horizonLabel(horizonMin: number): string {
  return horizonMin === 240 ? "4h" : `${horizonMin}m`;
}

function shortId(value?: string | null): string {
  if (!value) return "—";
  if (value.length < 14) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatUnixTs(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts)) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "matured";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function contextNum(
  context: Record<string, string | number> | undefined,
  key: string,
): number | null {
  if (!context) return null;
  const raw = context[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function flattenGenome(value: unknown, prefix = "root", out: GenomeEntry[] = []): GenomeEntry[] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    out.push({ path: prefix, value });
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item, idx) => flattenGenome(item, `${prefix}[${idx}]`, out));
    return out;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) {
      out.push({ path: prefix, value: "{}" });
      return out;
    }
    entries.forEach(([k, v]) => flattenGenome(v, `${prefix}.${k}`, out));
    return out;
  }

  out.push({ path: prefix, value: String(value) });
  return out;
}

function normalizePercent(value: number, maxAbs: number): number {
  if (maxAbs <= 0) return 0;
  return Math.min(100, Math.round((Math.abs(value) / maxAbs) * 100));
}

export default function ForecasterPage() {
  const [networkId, setNetworkId] = useState<NetworkId>("starknet_sepolia");
  const [pairId, setPairId] = useState("ETH/USDC");
  const [cadenceId, setCadenceId] = useState("5m");
  const [windowOpenTs, setWindowOpenTs] = useState<number>(() => nowUnix());
  const [windowCloseTs, setWindowCloseTs] = useState<number>(() => nowUnix() + 300);
  const [schemaId, setSchemaId] = useState("snapshot_forecaster.v1");
  const [subjectId, setSubjectId] = useState("0xpublic_demo_subject");
  const [modelHash, setModelHash] = useState("0xdemo_snapshot_forecaster_model_v1");
  const [salt, setSalt] = useState(randomSalt());

  const [outputs, setOutputs] = useState<OutputMap>(DEFAULT_OUTPUTS);
  const [autoSuggestOutputs, setAutoSuggestOutputs] = useState(true);
  const [projectionSourceLabel, setProjectionSourceLabel] = useState(
    "manual_defaults (fixed demo values until auto-suggest runs)",
  );
  const [actuals, setActuals] = useState(DEFAULT_ACTUALS);

  const [snapshotJson, setSnapshotJson] = useState<string>(
    JSON.stringify(
      {
        pair_id: "ETH/USDC",
        mid_price: 3524.18,
        spread_bps: 4,
        reserve_imbalance: -0.12,
        trade_count_60s: 96,
      },
      null,
      2,
    ),
  );
  const [featureJson, setFeatureJson] = useState<string>(
    JSON.stringify(
      {
        ret_15s: 5.2,
        ret_60s: 17.9,
        vol_5m: 82.4,
        depth_ratio: 0.71,
        buy_sell_imbalance: 0.19,
      },
      null,
      2,
    ),
  );

  const [snapshotViewMode, setSnapshotViewMode] = useState<JsonViewMode>("text");
  const [featureViewMode, setFeatureViewMode] = useState<JsonViewMode>("text");
  const [payloadViewMode, setPayloadViewMode] = useState<JsonViewMode>("text");

  const [windowRecord, setWindowRecord] = useState<WindowRecord | null>(null);
  const [prediction, setPrediction] = useState<PredictionRecord | null>(null);
  const [score, setScore] = useState<ScoreReceipt | null>(null);
  const [reputation, setReputation] = useState<ReputationSlice | null>(null);
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryRow[]>([]);
  const [horizonBenchmarks, setHorizonBenchmarks] = useState<HorizonBenchmarkRow[]>([]);
  const [benchmarkSampleForecasts, setBenchmarkSampleForecasts] = useState(0);
  const [selectedForecastId, setSelectedForecastId] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [autoTickBusy, setAutoTickBusy] = useState(false);
  const [lastAutoTickTs, setLastAutoTickTs] = useState<number | null>(null);
  const [liveTracking, setLiveTracking] = useState(true);
  const [clockTs, setClockTs] = useState<number>(() => nowUnix());
  const [analyticsSubjectId, setAnalyticsSubjectId] = useState("0xpublic_demo_subject");
  const [analyticsPairId, setAnalyticsPairId] = useState("ETH/USDC");
  const [analyticsNetwork, setAnalyticsNetwork] = useState<AnalyticsNetworkFilter>("all");
  const [analyticsModelHash, setAnalyticsModelHash] = useState("");
  const [analyticsStartTs, setAnalyticsStartTs] = useState<number | "">("");
  const [analyticsEndTs, setAnalyticsEndTs] = useState<number | "">("");
  const [analyticsBins, setAnalyticsBins] = useState(10);
  const [calibrationHorizon, setCalibrationHorizon] = useState<5 | 30 | 240>(30);
  const [pnlHorizon, setPnlHorizon] = useState<5 | 30 | 240>(30);
  const [pnlLongThreshold, setPnlLongThreshold] = useState(0.6);
  const [pnlShortThreshold, setPnlShortThreshold] = useState(0.4);
  const [pnlMinAbsBps, setPnlMinAbsBps] = useState(25);
  const [pnlCostBps, setPnlCostBps] = useState(4);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);
  const [analyticsBenchmarks, setAnalyticsBenchmarks] = useState<AnalyticsBenchmarksResponse | null>(null);
  const [analyticsCalibration, setAnalyticsCalibration] = useState<CalibrationResponse | null>(null);
  const [analyticsLatency, setAnalyticsLatency] = useState<LatencyResponse | null>(null);
  const [analyticsDrift, setAnalyticsDrift] = useState<DriftResponse | null>(null);
  const [analyticsLeaderboard, setAnalyticsLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [analyticsPnl, setAnalyticsPnl] = useState<PnlResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [explainBusy, setExplainBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<string>("");
  const [lastPayloadObject, setLastPayloadObject] = useState<unknown>(null);

  const commitmentPreview = useMemo(() => {
    return `5m ${formatBpsWithPct(outputs.r5)} · 30m ${formatBpsWithPct(outputs.r30)} · 4h ${formatBpsWithPct(outputs.r240)}`;
  }, [outputs]);
  const commitmentProbPreview = useMemo(() => {
    return `P(up): 5m ${pretty(outputs.p5 / 100, 1)}% · 30m ${pretty(outputs.p30 / 100, 1)}% · 4h ${pretty(outputs.p240 / 100, 1)}%`;
  }, [outputs]);

  const horizonProgress = useMemo<HorizonProgress[]>(() => {
    if (!windowRecord) return [];
    const outputsScaled = prediction?.outputs_scaled;
    const scorePerH = score?.per_horizon ?? {};
    const outcomes = windowRecord.outcomes ?? {};
    const openTs = Number(windowRecord.window_open_ts);

    return FORECAST_HORIZONS.map((horizonMin) => {
      const key = String(horizonMin);
      const outcome = outcomes[key];
      const scored = scorePerH[key];
      const maturityTs = Number(outcome?.maturity_ts ?? (openTs + (horizonMin * 60)));
      const remainingSec = maturityTs - clockTs;
      const denom = Math.max(1, maturityTs - openTs);
      const progressPct = Math.min(100, Math.max(0, ((clockTs - openTs) / denom) * 100));

      let status: HorizonProgress["status"] = "pending";
      if (scored) {
        status = "scored";
      } else if (clockTs >= maturityTs && outcome) {
        status = "outcome_recorded";
      } else if (clockTs >= maturityTs) {
        status = "matured_no_outcome";
      }

      const predictedBps = outputsScaled ? Number(outputsScaled[`r${horizonMin}` as keyof OutputMap]) : null;
      const predictedProbRaw = outputsScaled ? Number(outputsScaled[`p${horizonMin}` as keyof OutputMap]) : null;
      const predictedProbPct = predictedProbRaw === null ? null : predictedProbRaw / 100.0;
      const actualBps = outcome ? Number(outcome.actual_return_bps) : (scored ? Number(scored.actual_return_bps) : null);
      const deltaBps = predictedBps !== null && actualBps !== null ? predictedBps - actualBps : null;
      const directionalHit = scored ? Boolean(scored.directional_hit) : null;

      return {
        horizonMin,
        label: horizonMin === 240 ? "4h" : `${horizonMin}m`,
        maturityTs,
        remainingSec,
        progressPct,
        status,
        predictedBps,
        predictedProbPct,
        actualBps,
        deltaBps,
        directionalHit,
      };
    });
  }, [windowRecord, prediction, score, clockTs]);

  const snapshotParsed = useMemo(() => safeParseJson(snapshotJson), [snapshotJson]);
  const featureParsed = useMemo(() => safeParseJson(featureJson), [featureJson]);
  const explainHorizonCards = useMemo(() => {
    if (!explain?.context) return [];
    return [
      {
        label: "5m",
        predictedPct: contextNum(explain.context, "r5_pct"),
        predictedBps: contextNum(explain.context, "r5_bps"),
        actualPct: contextNum(explain.context, "a5_pct"),
        actualBps: contextNum(explain.context, "a5_bps"),
        upProbPct: contextNum(explain.context, "p5_pct"),
      },
      {
        label: "30m",
        predictedPct: contextNum(explain.context, "r30_pct"),
        predictedBps: contextNum(explain.context, "r30_bps"),
        actualPct: contextNum(explain.context, "a30_pct"),
        actualBps: contextNum(explain.context, "a30_bps"),
        upProbPct: contextNum(explain.context, "p30_pct"),
      },
      {
        label: "4h",
        predictedPct: contextNum(explain.context, "r240_pct"),
        predictedBps: contextNum(explain.context, "r240_bps"),
        actualPct: contextNum(explain.context, "a240_pct"),
        actualBps: contextNum(explain.context, "a240_bps"),
        upProbPct: contextNum(explain.context, "p240_pct"),
      },
    ];
  }, [explain]);

  const performanceSeries = useMemo(() => {
    if (!scoreHistory.length) return [];
    const asc = [...scoreHistory].sort((a, b) => a.scored_at_ts - b.scored_at_ts);
    return asc.map((row, idx) => ({
      idx: idx + 1,
      label: `#${idx + 1}`,
      scoredAtLabel: formatUnixTs(row.scored_at_ts),
      forecast: shortId(row.forecast_id),
      pair: row.pair_id,
      directionalPct: Number(row.metrics.directional_accuracy) * 100,
      maePct: Number(row.metrics.mae_bps) / 100,
      brier: Number(row.metrics.brier_score),
      ece: Number(row.metrics.ece),
    }));
  }, [scoreHistory]);

  const sortedBenchmarks = useMemo(() => {
    return [...horizonBenchmarks].sort((a, b) => a.horizon_min - b.horizon_min);
  }, [horizonBenchmarks]);

  const analyticsCalibrationSeries = useMemo(() => {
    const horizon = analyticsCalibration?.horizons?.find((h) => h.horizon_min === calibrationHorizon);
    if (!horizon) return [];
    return horizon.buckets.map((bucket) => ({
      bucket: `${Math.round(bucket.range_lo * 100)}-${Math.round(bucket.range_hi * 100)}%`,
      confidencePct: bucket.avg_confidence * 100,
      actualPct: bucket.empirical_up_rate * 100,
      count: bucket.count,
      gapPct: bucket.gap * 100,
    }));
  }, [analyticsCalibration, calibrationHorizon]);

  const analyticsPnlSeries = useMemo(() => {
    if (!analyticsPnl?.curve?.length) return [];
    return analyticsPnl.curve.map((point, idx) => ({
      idx: idx + 1,
      label: `#${idx + 1}`,
      scoredAtLabel: formatUnixTs(point.scored_at_ts),
      equityPct: point.equity_bps / 100.0,
      tradePct: point.trade_return_bps / 100.0,
      action: point.action,
    }));
  }, [analyticsPnl]);

  const driftPerfRows = useMemo(() => {
    if (!analyticsDrift?.performance_drift) return [];
    return [
      {
        metric: "Directional",
        reference: analyticsDrift.performance_drift.directional_accuracy.reference * 100,
        current: analyticsDrift.performance_drift.directional_accuracy.current * 100,
        delta: analyticsDrift.performance_drift.directional_accuracy.delta * 100,
      },
      {
        metric: "MAE (bps)",
        reference: analyticsDrift.performance_drift.mae_bps.reference,
        current: analyticsDrift.performance_drift.mae_bps.current,
        delta: analyticsDrift.performance_drift.mae_bps.delta,
      },
      {
        metric: "Brier",
        reference: analyticsDrift.performance_drift.brier_score.reference,
        current: analyticsDrift.performance_drift.brier_score.current,
        delta: analyticsDrift.performance_drift.brier_score.delta,
      },
      {
        metric: "ECE",
        reference: analyticsDrift.performance_drift.ece.reference,
        current: analyticsDrift.performance_drift.ece.current,
        delta: analyticsDrift.performance_drift.ece.delta,
      },
    ];
  }, [analyticsDrift]);

  const resetError = () => setError(null);

  const storePayload = (payload: unknown) => {
    setLastPayload(JSON.stringify(payload, null, 2));
    setLastPayloadObject(payload);
  };

  const parseJsonInput = <T,>(raw: string, label: string): T => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  };

  const updateOutput = (key: keyof OutputMap, value: string) => {
    setOutputs((prev) => ({ ...prev, [key]: Number(value) }));
    setProjectionSourceLabel("manual_override");
  };

  const suggestOutputsForWindow = async (windowId: string): Promise<OutputMap> => {
    const suggested = await apiFetch<SuggestedOutputsResponse>(
      `/api/v1/zkdefi/snapshot-forecaster/windows/${windowId}/suggested-outputs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          horizons_min: [5, 30, 240],
          output_bounds: {
            return_min_bps: -5000,
            return_max_bps: 5000,
            prob_min: 0,
            prob_max: 10000,
          },
        }),
      },
    );

    setOutputs(suggested.outputs_scaled);
    const trendText = suggested.recent_trend_bps === null
      ? "trend unavailable"
      : `recent trend ${formatBpsWithPct(suggested.recent_trend_bps)}`;
    setProjectionSourceLabel(`${suggested.source_id} · ${suggested.network_id} · ${trendText}`);
    return suggested.outputs_scaled;
  };

  const fetchExplanation = async (
    override?: { forecastId?: string; windowId?: string; scoreReceiptId?: string },
  ): Promise<ExplainResponse> => {
    const payload: {
      forecast_id?: string;
      window_id?: string;
      score_receipt_id?: string;
    } = {};

    const forecastId = override?.forecastId ?? prediction?.forecast_id;
    const windowId = override?.windowId ?? windowRecord?.window_id;
    const scoreReceiptId = override?.scoreReceiptId ?? score?.score_receipt_id ?? undefined;

    if (forecastId) payload.forecast_id = forecastId;
    if (windowId) payload.window_id = windowId;
    if (scoreReceiptId) payload.score_receipt_id = scoreReceiptId;

    return apiFetch<ExplainResponse>("/api/v1/zkdefi/snapshot-forecaster/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const hydrateForecast = async (forecastId: string, withNarration = true) => {
    const loadedPrediction = await apiFetch<PredictionRecord>(
      `/api/v1/zkdefi/snapshot-forecaster/predictions/${forecastId}`,
    );
    setPrediction(loadedPrediction);
    if (loadedPrediction.outputs_scaled) {
      setOutputs(loadedPrediction.outputs_scaled);
      setProjectionSourceLabel(`loaded_from_${loadedPrediction.status}`);
    }
    setSelectedForecastId(forecastId);
    if (loadedPrediction.subject_id) {
      setSubjectId(loadedPrediction.subject_id);
    }

    const loadedWindow = await apiFetch<WindowRecord>(
      `/api/v1/zkdefi/snapshot-forecaster/windows/${loadedPrediction.window_id}`,
    );
    setWindowRecord(loadedWindow);
    if (loadedWindow.network_id && NETWORK_OPTIONS.some((n) => n.id === loadedWindow.network_id)) {
      setNetworkId(loadedWindow.network_id as NetworkId);
    }

    let loadedScore: ScoreReceipt | null = null;
    if (loadedPrediction.score_receipt_id) {
      loadedScore = await apiFetch<ScoreReceipt>(
        `/api/v1/zkdefi/snapshot-forecaster/scores/${loadedPrediction.score_receipt_id}`,
      );
      setScore(loadedScore);
    } else {
      setScore(null);
    }

    if (loadedPrediction.subject_id) {
      const rep = await apiFetch<ReputationSlice>(
        `/api/v1/zkdefi/snapshot-forecaster/reputation/${loadedPrediction.subject_id}`,
      );
      setReputation(rep);
    }

    if (withNarration) {
      try {
        const explained = await fetchExplanation({
          forecastId,
          windowId: loadedWindow.window_id,
          scoreReceiptId: loadedScore?.score_receipt_id ?? undefined,
        });
        setExplain(explained);
      } catch {
        // Narration is optional when hydrating history.
      }
    }
  };

  const refreshHistory = async (preferredForecastId?: string) => {
    setHistoryBusy(true);
    try {
      const trimmedSubject = subjectId.trim().toLowerCase();
      const query = new URLSearchParams({ limit: "25" });
      if (trimmedSubject) {
        query.set("subject_id", trimmedSubject);
      }
      const rows = await apiFetch<PredictionListResponse>(
        `/api/v1/zkdefi/snapshot-forecaster/predictions?${query.toString()}`,
      );
      const predictions = rows.predictions ?? [];
      setHistory(predictions);

      if (trimmedSubject) {
        try {
          const scoreRows = await apiFetch<ScoreHistoryResponse>(
            `/api/v1/zkdefi/snapshot-forecaster/reputation/${encodeURIComponent(trimmedSubject)}/history?limit=60`,
          );
          setScoreHistory(scoreRows.history ?? []);

          const benchmarkRows = await apiFetch<HorizonBenchmarksResponse>(
            `/api/v1/zkdefi/snapshot-forecaster/reputation/${encodeURIComponent(trimmedSubject)}/benchmarks?limit=1000`,
          );
          setHorizonBenchmarks(benchmarkRows.horizon_benchmarks ?? []);
          setBenchmarkSampleForecasts(Number(benchmarkRows.sample_forecasts ?? 0));
        } catch {
          setScoreHistory([]);
          setHorizonBenchmarks([]);
          setBenchmarkSampleForecasts(0);
        }
      } else {
        setScoreHistory([]);
        setHorizonBenchmarks([]);
        setBenchmarkSampleForecasts(0);
      }

      const selected =
        preferredForecastId ??
        selectedForecastId ??
        (predictions.length ? predictions[0].forecast_id : null);
      if (selected && predictions.some((p) => p.forecast_id === selected)) {
        await hydrateForecast(selected, false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load forecast history");
    } finally {
      setHistoryBusy(false);
    }
  };

  const runAutomationTick = async () => {
    setAutoTickBusy(true);
    try {
      await apiFetch("/api/v1/zkdefi/snapshot-forecaster/automation/tick?max_predictions=400", {
        method: "POST",
      });
      setLastAutoTickTs(nowUnix());
      await refreshHistory(selectedForecastId ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run automation tick");
    } finally {
      setAutoTickBusy(false);
    }
  };

  const selectForecastFromHistory = async (forecastId: string) => {
    setHistoryBusy(true);
    resetError();
    try {
      await hydrateForecast(forecastId, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load forecast");
    } finally {
      setHistoryBusy(false);
    }
  };

  useEffect(() => {
    const savedSubject = typeof window !== "undefined" ? localStorage.getItem("forecaster_subject_id") : null;
    const savedForecast = typeof window !== "undefined" ? localStorage.getItem("forecaster_selected_forecast") : null;
    if (savedSubject) {
      setSubjectId(savedSubject);
    }
    if (savedForecast) {
      setSelectedForecastId(savedForecast);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("forecaster_subject_id", subjectId);
    }
  }, [subjectId]);

  useEffect(() => {
    if (typeof window !== "undefined" && selectedForecastId) {
      localStorage.setItem("forecaster_selected_forecast", selectedForecastId);
    }
  }, [selectedForecastId]);

  useEffect(() => {
    if (!subjectId.trim()) return;
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  useEffect(() => {
    if (!liveTracking) return;
    const timer = setInterval(() => setClockTs(nowUnix()), 1000);
    return () => clearInterval(timer);
  }, [liveTracking]);

  useEffect(() => {
    if (!liveTracking || !selectedForecastId) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          await apiFetch("/api/v1/zkdefi/snapshot-forecaster/automation/tick?max_predictions=400", {
            method: "POST",
          });
          setLastAutoTickTs(nowUnix());
        } catch {
          // worker may already be running or tick may be unavailable; history refresh still runs
        }
        await refreshHistory(selectedForecastId);
      })();
    }, 30000);
    return () => clearInterval(timer);
  }, [liveTracking, selectedForecastId, subjectId]);

  const formatJsonBlock = (type: "snapshot" | "feature") => {
    try {
      if (type === "snapshot") {
        const parsed = parseJsonInput<unknown>(snapshotJson, "Snapshot");
        setSnapshotJson(JSON.stringify(parsed, null, 2));
      } else {
        const parsed = parseJsonInput<unknown>(featureJson, "Feature vector");
        setFeatureJson(JSON.stringify(parsed, null, 2));
      }
      resetError();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to format JSON");
    }
  };

  const createWindow = async () => {
    setBusy(true);
    resetError();
    try {
      const snapshotData = parseJsonInput<Record<string, unknown>>(snapshotJson, "Snapshot");
      const featureVector = parseJsonInput<Record<string, number>>(featureJson, "Feature vector");

      const payload = {
        pair_id: pairId,
        network_id: networkId,
        cadence_id: cadenceId,
        window_open_ts: Number(windowOpenTs),
        window_close_ts: Number(windowCloseTs),
        feature_schema_id: schemaId,
        snapshot_data: snapshotData,
        feature_vector: featureVector,
        data_source_id: "public_ui",
        attest_snapshot: false,
      };
      const created = await apiFetch<WindowRecord>("/api/v1/zkdefi/snapshot-forecaster/windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setWindowRecord(created);
      let suggestedOutputs: OutputMap | null = null;
      if (autoSuggestOutputs) {
        try {
          suggestedOutputs = await suggestOutputsForWindow(created.window_id);
        } catch {
          setProjectionSourceLabel("manual_defaults (suggestion unavailable)");
        }
      }
      storePayload({ window: created, suggested_outputs: suggestedOutputs });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create forecast window");
    } finally {
      setBusy(false);
    }
  };

  const commitPrediction = async () => {
    if (!windowRecord) {
      setError("Create a window first");
      return;
    }

    setBusy(true);
    resetError();
    try {
      let outputsForCommit = outputs;
      if (autoSuggestOutputs) {
        try {
          outputsForCommit = await suggestOutputsForWindow(windowRecord.window_id);
        } catch {
          setProjectionSourceLabel("manual_outputs (suggestion unavailable)");
        }
      }

      const payload = {
        window_id: windowRecord.window_id,
        subject_id: subjectId,
        horizons_min: [5, 30, 240],
        model_identity: {
          model_hash: modelHash,
          schema_id: schemaId,
        },
        outputs_scaled: outputsForCommit,
        salt,
      };
      const committed = await apiFetch<PredictionRecord>("/api/v1/zkdefi/snapshot-forecaster/predictions/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setPrediction(committed);
      setSelectedForecastId(committed.forecast_id);
      await refreshHistory(committed.forecast_id);
      storePayload({ prediction: committed, outputs_scaled: outputsForCommit });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to commit prediction");
    } finally {
      setBusy(false);
    }
  };

  const revealPrediction = async () => {
    if (!prediction) {
      setError("Commit a prediction first");
      return;
    }

    setBusy(true);
    resetError();
    try {
      const payload = {
        outputs_scaled: outputs,
        salt,
        ezkl_receipt: {
          proof_hash: "0xpublic_demo_receipt",
          verified_locally: true,
          verified_on_chain: false,
          verification_mode: "offchain_demo",
        },
      };

      const revealed = await apiFetch<PredictionRecord>(
        `/api/v1/zkdefi/snapshot-forecaster/predictions/${prediction.forecast_id}/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setPrediction(revealed);
      await refreshHistory(revealed.forecast_id);
      storePayload(revealed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reveal prediction");
    } finally {
      setBusy(false);
    }
  };

  const pushOutcomes = async () => {
    if (!windowRecord) {
      setError("Create a window first");
      return;
    }

    setBusy(true);
    resetError();
    try {
      const payload = {
        source_id: "public_ui_outcome_feed",
        outcomes: [
          { horizon_min: 5, actual_return_bps: Number(actuals.h5) },
          { horizon_min: 30, actual_return_bps: Number(actuals.h30) },
          { horizon_min: 240, actual_return_bps: Number(actuals.h240) },
        ],
      };
      const updated = await apiFetch<WindowRecord>(
        `/api/v1/zkdefi/snapshot-forecaster/windows/${windowRecord.window_id}/outcomes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setWindowRecord(updated);
      storePayload(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to register outcomes");
    } finally {
      setBusy(false);
    }
  };

  const scorePrediction = async () => {
    if (!prediction) {
      setError("Commit and reveal a prediction first");
      return;
    }

    setBusy(true);
    resetError();
    try {
      const scored = await apiFetch<ScoreReceipt>(
        `/api/v1/zkdefi/snapshot-forecaster/predictions/${prediction.forecast_id}/score`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ece_bins: 10 }),
        },
      );

      setScore(scored);
      storePayload(scored);

      const rep = await apiFetch<ReputationSlice>(`/api/v1/zkdefi/snapshot-forecaster/reputation/${subjectId}`);
      setReputation(rep);
      await refreshHistory(prediction.forecast_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to score prediction");
    } finally {
      setBusy(false);
    }
  };

  const explainForecast = async () => {
    if (!prediction && !windowRecord && !score) {
      setError("Run at least one forecast step before requesting explanation");
      return;
    }

    setExplainBusy(true);
    resetError();
    try {
      const explained = await fetchExplanation();
      setExplain(explained);
      storePayload(explained);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate AI explanation");
    } finally {
      setExplainBusy(false);
    }
  };

  const runDemoFlow = async () => {
    setBusy(true);
    resetError();
    try {
      const snapshotData = parseJsonInput<Record<string, unknown>>(snapshotJson, "Snapshot");
      const featureVector = parseJsonInput<Record<string, number>>(featureJson, "Feature vector");

      const created = await apiFetch<WindowRecord>("/api/v1/zkdefi/snapshot-forecaster/windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair_id: pairId,
          network_id: networkId,
          cadence_id: cadenceId,
          window_open_ts: Number(windowOpenTs),
          window_close_ts: Number(windowCloseTs),
          feature_schema_id: schemaId,
          snapshot_data: snapshotData,
          feature_vector: featureVector,
          data_source_id: "public_ui",
          attest_snapshot: false,
        }),
      });
      setWindowRecord(created);

      let outputsForFlow = outputs;
      if (autoSuggestOutputs) {
        try {
          outputsForFlow = await suggestOutputsForWindow(created.window_id);
        } catch {
          setProjectionSourceLabel("manual_outputs (suggestion unavailable)");
        }
      }

      const committed = await apiFetch<PredictionRecord>("/api/v1/zkdefi/snapshot-forecaster/predictions/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          window_id: created.window_id,
          subject_id: subjectId,
          horizons_min: [5, 30, 240],
          model_identity: {
            model_hash: modelHash,
            schema_id: schemaId,
          },
          outputs_scaled: outputsForFlow,
          salt,
        }),
      });

      const revealed = await apiFetch<PredictionRecord>(
        `/api/v1/zkdefi/snapshot-forecaster/predictions/${committed.forecast_id}/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputs_scaled: outputsForFlow,
            salt,
            ezkl_receipt: {
              proof_hash: "0xpublic_demo_receipt",
              verified_locally: true,
              verified_on_chain: false,
              verification_mode: "offchain_demo",
            },
          }),
        },
      );
      setPrediction(revealed);

      await apiFetch(`/api/v1/zkdefi/snapshot-forecaster/windows/${created.window_id}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: "public_ui_outcome_feed",
          outcomes: [
            { horizon_min: 5, actual_return_bps: Number(actuals.h5) },
            { horizon_min: 30, actual_return_bps: Number(actuals.h30) },
            { horizon_min: 240, actual_return_bps: Number(actuals.h240) },
          ],
        }),
      });

      const scored = await apiFetch<ScoreReceipt>(
        `/api/v1/zkdefi/snapshot-forecaster/predictions/${committed.forecast_id}/score`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ece_bins: 10 }),
        },
      );
      setScore(scored);
      setSelectedForecastId(committed.forecast_id);

      const rep = await apiFetch<ReputationSlice>(`/api/v1/zkdefi/snapshot-forecaster/reputation/${subjectId}`);
      setReputation(rep);
      await refreshHistory(committed.forecast_id);
      storePayload(scored);
    } catch (e) {
      setError(e instanceof Error ? e.message : "End-to-end demo failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-zinc-800 px-6 py-16">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(16,185,129,0.20),transparent_40%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(6,182,212,0.18),transparent_45%)]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                <Radar className="h-3.5 w-3.5" />
                Public Snapshot Forecaster
              </p>
              <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">Build Verifiable Forecast Receipts</h1>
              <p className="mt-3 max-w-3xl text-zinc-300">
                Create forecast windows, run commit/reveal lifecycle, score outcomes, and generate human-readable
                explanations powered by your OpenAI-backed narration path.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={runDemoFlow}
                disabled={busy}
                className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300/60 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Running..." : "Run End-to-End Demo"}
              </button>
              <button
                onClick={explainForecast}
                disabled={explainBusy}
                className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-300/60 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {explainBusy ? "Explaining..." : "Explain With AI"}
              </button>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2">
            {GLOSSARY.map((entry) => (
              <GlossaryChip key={entry.term} term={entry.term} description={entry.description} />
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            Quick translation: <span className="font-semibold text-zinc-200">100 bps = 1.00%</span>. Example:{" "}
            <span className="font-semibold text-zinc-200">250 bps = 2.50%</span>.
          </p>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-3">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <Database className="h-4 w-4 text-cyan-300" />
              Window
            </h2>
            <div className="space-y-3">
              <label className="block text-xs text-zinc-400">
                <LabelWithTip label="Pair" tip="Trading pair used to build this forecast window." />
                <input
                  value={pairId}
                  onChange={(e) => setPairId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                <LabelWithTip
                  label="Network"
                  tip="Select the market network used for matured outcome oracle reads."
                />
                <select
                  value={networkId}
                  onChange={(e) => setNetworkId(e.target.value as NetworkId)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                >
                  {NETWORK_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} · {option.hint}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-zinc-400">
                <LabelWithTip label="Cadence" tip="Window cadence for sampling and forecast generation, e.g. 5m." />
                <input
                  value={cadenceId}
                  onChange={(e) => setCadenceId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-zinc-400">
                  <LabelWithTip label="Open (unix)" tip="Unix timestamp when the forecast window starts." />
                  <input
                    type="number"
                    value={windowOpenTs}
                    onChange={(e) => setWindowOpenTs(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs text-zinc-400">
                  <LabelWithTip label="Close (unix)" tip="Unix timestamp when this window closes." />
                  <input
                    type="number"
                    value={windowCloseTs}
                    onChange={(e) => setWindowCloseTs(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <JsonModeHeader
                title="Snapshot JSON"
                description="Raw market snapshot committed into the window hash."
                mode={snapshotViewMode}
                onModeChange={setSnapshotViewMode}
                onFormat={() => formatJsonBlock("snapshot")}
              />
              {snapshotViewMode === "text" ? (
                <textarea
                  value={snapshotJson}
                  onChange={(e) => setSnapshotJson(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
                />
              ) : (
                <GenomeView data={snapshotParsed} emptyLabel="Snapshot JSON is invalid or empty." />
              )}

              <JsonModeHeader
                title="Feature Vector JSON"
                description="Deterministic model features derived from snapshot + context." 
                mode={featureViewMode}
                onModeChange={setFeatureViewMode}
                onFormat={() => formatJsonBlock("feature")}
              />
              {featureViewMode === "text" ? (
                <textarea
                  value={featureJson}
                  onChange={(e) => setFeatureJson(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
                />
              ) : (
                <GenomeView data={featureParsed} emptyLabel="Feature JSON is invalid or empty." />
              )}

              <button
                onClick={createWindow}
                disabled={busy}
                className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold transition hover:bg-cyan-500 disabled:opacity-60"
              >
                Create Window
              </button>
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <Activity className="h-4 w-4 text-emerald-300" />
              Commit & Reveal
            </h2>
            <div className="space-y-3">
              <label className="block text-xs text-zinc-400">
                <LabelWithTip
                  label="Subject ID"
                  tip="Wallet or agent identity that accumulates reputation for forecast quality."
                />
                <input
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                <LabelWithTip
                  label="Model Hash"
                  tip="Model artifact identity (ONNX/circuit hash) bound to this prediction commitment."
                />
                <input
                  value={modelHash}
                  onChange={(e) => setModelHash(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                <LabelWithTip
                  label="Schema ID"
                  tip="Versioned output meaning. Keeps model inputs/outputs semantically stable over time."
                />
                <input
                  value={schemaId}
                  onChange={(e) => setSchemaId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                <LabelWithTip
                  label="Salt"
                  tip="Secret used with outputs to build the commitment hash in commit->reveal flow."
                />
                <div className="mt-1 flex gap-2">
                  <input
                    value={salt}
                    onChange={(e) => setSalt(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setSalt(randomSalt())}
                    className="rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 hover:border-zinc-500"
                  >
                    New
                  </button>
                </div>
              </label>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                <LabelWithTip
                  label="Projection Source"
                  tip="Shows where current outputs came from. Auto-suggest derives outputs from snapshot/features/network."
                />
                <div className="mt-1 break-all text-zinc-200">{projectionSourceLabel}</div>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={autoSuggestOutputs}
                  onChange={(e) => setAutoSuggestOutputs(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                />
                <span>Auto-suggest outputs from snapshot + network</span>
              </label>
              <button
                type="button"
                onClick={async () => {
                  if (!windowRecord) {
                    setError("Create a window first");
                    return;
                  }
                  try {
                    setBusy(true);
                    resetError();
                    await suggestOutputsForWindow(windowRecord.window_id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to suggest outputs");
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy || !windowRecord}
                className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-60"
              >
                Suggest Outputs From Window
              </button>

              <div className="grid grid-cols-2 gap-2">
                {([
                  ["r5", "5m predicted return in bps."],
                  ["r30", "30m predicted return in bps."],
                  ["r240", "4h predicted return in bps."],
                  ["p5", "5m probability(up) scaled 0-10000."],
                  ["p30", "30m probability(up) scaled 0-10000."],
                  ["p240", "4h probability(up) scaled 0-10000."],
                ] as Array<[keyof OutputMap, string]>).map(([key, tip]) => (
                  <label key={key} className="block text-xs text-zinc-400">
                    <LabelWithTip label={key} tip={tip} />
                    <input
                      type="number"
                      value={outputs[key]}
                      onChange={(e) => updateOutput(key, e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {String(key).startsWith("r")
                        ? formatBpsWithPct(outputs[key])
                        : `${pretty(outputs[key] / 100, 1)}% probability(up)`}
                    </p>
                  </label>
                ))}
              </div>

              <GenomeView
                data={outputs}
                compact
                emptyLabel="Output genome unavailable"
              />

              <button
                onClick={commitPrediction}
                disabled={busy || !windowRecord}
                className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold transition hover:bg-emerald-500 disabled:opacity-60"
              >
                Commit Prediction
              </button>
              <button
                onClick={revealPrediction}
                disabled={busy || !prediction}
                className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-60"
              >
                Reveal Prediction
              </button>
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <BarChart3 className="h-4 w-4 text-amber-300" />
              Outcomes & Score
            </h2>
            <div className="space-y-3">
              <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                Predicted bundle: <span className="font-semibold text-zinc-100">{commitmentPreview}</span>
                <br />
                <span className="text-zinc-500">{commitmentProbPreview}</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-xs text-zinc-400">
                  <LabelWithTip label="5m actual (bps)" tip="Observed 5-minute realized return in basis points." />
                  <input
                    type="number"
                    value={actuals.h5}
                    onChange={(e) => setActuals((p) => ({ ...p, h5: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">{formatBpsWithPct(actuals.h5)}</p>
                </label>
                <label className="block text-xs text-zinc-400">
                  <LabelWithTip label="30m actual (bps)" tip="Observed 30-minute realized return in basis points." />
                  <input
                    type="number"
                    value={actuals.h30}
                    onChange={(e) => setActuals((p) => ({ ...p, h30: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">{formatBpsWithPct(actuals.h30)}</p>
                </label>
                <label className="block text-xs text-zinc-400">
                  <LabelWithTip label="4h actual (bps)" tip="Observed 4-hour realized return in basis points." />
                  <input
                    type="number"
                    value={actuals.h240}
                    onChange={(e) => setActuals((p) => ({ ...p, h240: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">{formatBpsWithPct(actuals.h240)}</p>
                </label>
              </div>
              <button
                onClick={pushOutcomes}
                disabled={busy || !windowRecord}
                className="w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold transition hover:bg-amber-500 disabled:opacity-60"
              >
                Register Matured Outcomes
              </button>
              <button
                onClick={scorePrediction}
                disabled={busy || !prediction}
                className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-60"
              >
                Score + Update Reputation
              </button>
              <button
                onClick={explainForecast}
                disabled={explainBusy}
                className="w-full rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 disabled:opacity-60"
              >
                {explainBusy ? "Generating..." : "Generate Human Readable Summary"}
              </button>
            </div>
          </article>
        </div>
      </section>

      <section className="px-6 pb-14">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Current State
            </h3>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">Window ID</div>
                <div className="break-all font-mono text-zinc-200">{windowRecord?.window_id || "—"}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">Forecast ID</div>
                <div className="break-all font-mono text-zinc-200">{prediction?.forecast_id || "—"}</div>
                <div className="mt-1 text-xs text-zinc-400">
                  Status: <span className="font-semibold text-zinc-200">{prediction?.status || "n/a"}</span> ·
                  <span className="ml-1">
                    <LabelWithTip
                      label="Trust mode"
                      tip="Indicates whether verification is commit-only, offchain proof-verified, or on-chain verified."
                    />
                    : <span className="font-semibold text-zinc-200">{prediction?.trust_mode || "n/a"}</span>
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-500">Score Receipt</div>
                <div className="break-all font-mono text-zinc-200">{score?.score_receipt_id || "—"}</div>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <Gauge className="h-4 w-4 text-cyan-300" />
              Metrics
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <MetricCard
                label="Directional Accuracy"
                tip="Share of horizons where predicted direction matched actual direction."
                value={score ? `${pretty(score.metrics.directional_accuracy * 100)}%` : "—"}
              />
              <MetricCard
                label="MAE (bps)"
                tip="Mean absolute error in basis points. Lower is better."
                value={score ? `${pretty(score.metrics.mae_bps)} bps (${pretty(score.metrics.mae_bps / 100, 2)}%)` : "—"}
              />
              <MetricCard
                label="RMSE (bps)"
                tip="Root mean squared error in basis points. Penalizes large misses more than MAE."
                value={score ? `${pretty(score.metrics.rmse_bps)} bps (${pretty(score.metrics.rmse_bps / 100, 2)}%)` : "—"}
              />
              <MetricCard
                label="Brier"
                tip="Probability prediction error score. Lower means better calibrated probability forecasts."
                value={score ? pretty(score.metrics.brier_score, 4) : "—"}
              />
              <MetricCard
                label="ECE"
                tip="Expected Calibration Error: gap between predicted confidence and observed outcomes."
                value={score ? pretty(score.metrics.ece, 4) : "—"}
              />
              <MetricCard
                label="Trust Score"
                tip="Aggregate reputation score from directional hit rate, error, and calibration quality."
                value={reputation ? `${reputation.trust_score}/100` : "—"}
              />
            </div>
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
              <div className="mb-1 flex items-center gap-2 text-zinc-300">
                <Clock3 className="h-3.5 w-3.5" />
                Reputation sample size: <span className="font-semibold">{reputation?.sample_size ?? 0}</span>
              </div>
              <div className="text-zinc-500">Subject: {reputation?.subject_id || subjectId}</div>
            </div>
          </article>
        </div>
      </section>

      <section className="px-6 pb-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <Brain className="h-4 w-4 text-fuchsia-300" />
              OpenAI Narration
            </div>
            <button
              onClick={explainForecast}
              disabled={explainBusy}
              className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-60"
            >
              {explainBusy ? "Generating..." : "Refresh Narrative"}
            </button>
          </div>

          {explain ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
                  <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" />
                  Source: {explain.source}
                </div>
                <p className="text-sm text-zinc-200">{explain.narration}</p>
                {explain.source === "deterministic" && explain.fallback_reason ? (
                  <p className="mt-2 text-xs text-amber-300">
                    LLM fallback reason: {explain.fallback_reason}. Deterministic narration is shown until LLM auth is fixed.
                  </p>
                ) : null}
              </div>
              {!!explainHorizonCards.length ? (
                <div className="grid gap-2 md:grid-cols-3">
                  {explainHorizonCards.map((card) => (
                    <div key={card.label} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                      <div className="mb-1 font-semibold text-zinc-200">{card.label} Snapshot</div>
                      <div className="text-zinc-400">
                        Predicted:{" "}
                        <span className="font-semibold text-zinc-100">
                          {card.predictedPct === null || card.predictedBps === null
                            ? "—"
                            : `${pretty(card.predictedPct, 2)}% (${pretty(card.predictedBps, 0)} bps)`}
                        </span>
                      </div>
                      <div className="text-zinc-400">
                        Actual:{" "}
                        <span className="font-semibold text-zinc-100">
                          {card.actualPct === null || card.actualBps === null
                            ? "awaiting maturity"
                            : `${pretty(card.actualPct, 2)}% (${pretty(card.actualBps, 0)} bps)`}
                        </span>
                      </div>
                      <div className="text-zinc-400">
                        P(up):{" "}
                        <span className="font-semibold text-zinc-100">
                          {card.upProbPct === null ? "—" : `${pretty(card.upProbPct, 1)}%`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <MetricPill
                  label="Directional"
                  value={
                    contextNum(explain.context, "directional_pct") === null
                      ? "—"
                      : `${pretty(contextNum(explain.context, "directional_pct") as number, 1)}%`
                  }
                />
                <MetricPill
                  label="MAE"
                  value={
                    contextNum(explain.context, "mae_pct") === null || contextNum(explain.context, "mae_bps") === null
                      ? "—"
                      : `${pretty(contextNum(explain.context, "mae_pct") as number, 2)}% (${pretty(
                          contextNum(explain.context, "mae_bps") as number,
                          1,
                        )} bps)`
                  }
                />
                <MetricPill
                  label="Brier"
                  value={
                    contextNum(explain.context, "brier") === null
                      ? "—"
                      : pretty(contextNum(explain.context, "brier") as number, 4)
                  }
                />
                <MetricPill
                  label="ECE"
                  value={
                    contextNum(explain.context, "ece") === null
                      ? "—"
                      : pretty(contextNum(explain.context, "ece") as number, 4)
                  }
                />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {explain.highlights.map((item) => (
                  <div key={item} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No narration yet. Run forecast steps, then click Explain With AI.</p>
          )}
        </div>
      </section>

      <section className="px-6 pb-8">
        <div className="mx-auto max-w-6xl rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <Clock3 className="h-4 w-4 text-cyan-300" />
              Forecast Timeline
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void refreshHistory()}
                disabled={historyBusy}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-60"
              >
                {historyBusy ? "Refreshing..." : "Refresh History"}
              </button>
              <button
                onClick={() => void runAutomationTick()}
                disabled={autoTickBusy}
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
              >
                {autoTickBusy ? "Ticking..." : "Run Tick"}
              </button>
              <button
                onClick={() => setLiveTracking((prev) => !prev)}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  liveTracking
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-zinc-700 text-zinc-300"
                }`}
              >
                Live: {liveTracking ? "On" : "Off"}
              </button>
            </div>
          </div>

          <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
            Tracking subject <span className="font-semibold text-zinc-200">{subjectId}</span> · stored forecasts:{" "}
            <span className="font-semibold text-zinc-200">{history.length}</span>
            {lastAutoTickTs ? (
              <>
                {" "}· last tick: <span className="font-semibold text-zinc-200">{formatUnixTs(lastAutoTickTs)}</span>
              </>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 lg:col-span-1">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Recent Forecasts</div>
              <div className="max-h-[340px] space-y-2 overflow-auto pr-1">
                {!history.length ? (
                  <p className="text-xs text-zinc-500">No persisted forecasts found yet for this subject.</p>
                ) : (
                  history.map((item) => (
                    <button
                      key={item.forecast_id}
                      type="button"
                      onClick={() => void selectForecastFromHistory(item.forecast_id)}
                      className={`w-full rounded-lg border p-2 text-left transition ${
                        selectedForecastId === item.forecast_id
                          ? "border-cyan-500/50 bg-cyan-500/10"
                          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-zinc-200">{shortId(item.forecast_id)}</span>
                        <span className="text-[10px] uppercase tracking-wide text-zinc-400">{item.status}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        Guess: {formatUnixTs(item.guess_ts ?? item.created_at_ts)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">Trust: {item.trust_mode}</div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 lg:col-span-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Sequence: 5m → 30m → 4h
                </div>
                <div className="text-[11px] text-zinc-500">Now: {formatUnixTs(clockTs)}</div>
              </div>

              {!prediction || !windowRecord ? (
                <p className="text-sm text-zinc-500">Pick a persisted forecast or run a new one to see timeline progress.</p>
              ) : (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                      <div className="text-zinc-500">Forecast</div>
                      <div className="font-mono text-zinc-200">{shortId(prediction.forecast_id)}</div>
                    </div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                    <div className="text-zinc-500">Pair</div>
                    <div className="font-medium text-zinc-200">{windowRecord.pair_id}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                    <div className="text-zinc-500">Network</div>
                    <div className="font-medium text-zinc-200">{windowRecord.network_id || "starknet_sepolia"}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                    <div className="text-zinc-500">Window Open</div>
                    <div className="text-zinc-200">{formatUnixTs(windowRecord.window_open_ts)}</div>
                  </div>
                    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
                      <div className="text-zinc-500">Window Close</div>
                      <div className="text-zinc-200">{formatUnixTs(windowRecord.window_close_ts)}</div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {horizonProgress.map((h) => (
                      <div key={h.horizonMin} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-zinc-100">{h.label} Horizon</div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                              h.status === "scored"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : h.status === "outcome_recorded"
                                  ? "bg-cyan-500/15 text-cyan-300"
                                  : h.status === "matured_no_outcome"
                                    ? "bg-amber-500/15 text-amber-300"
                                    : "bg-zinc-700/40 text-zinc-300"
                            }`}
                          >
                            {h.status.replaceAll("_", " ")}
                          </span>
                        </div>
                        <div className="mb-2 text-[11px] text-zinc-500">
                          Matures: {formatUnixTs(h.maturityTs)} ·{" "}
                          {h.remainingSec > 0 ? `in ${formatCountdown(h.remainingSec)}` : "ready"}
                        </div>
                        <div className="mb-3 h-1.5 w-full rounded bg-zinc-800">
                          <div
                            className={`h-1.5 rounded ${h.remainingSec > 0 ? "bg-cyan-400" : "bg-emerald-400"}`}
                            style={{ width: `${h.progressPct}%` }}
                          />
                        </div>
                        <div className="space-y-1 text-xs text-zinc-300">
                          <div>
                            Predicted:{" "}
                            <span className="font-semibold">
                              {h.predictedBps !== null ? formatBpsWithPct(h.predictedBps) : "not revealed"}
                            </span>
                          </div>
                          <div>
                            P(up):{" "}
                            <span className="font-semibold">
                              {h.predictedProbPct !== null ? `${pretty(h.predictedProbPct, 1)}%` : "—"}
                            </span>
                          </div>
                          <div>
                            Actual:{" "}
                            <span className="font-semibold">
                              {h.actualBps !== null ? formatBpsWithPct(h.actualBps) : "awaiting outcome"}
                            </span>
                          </div>
                          <div>
                            Delta:{" "}
                            <span className="font-semibold">
                              {h.deltaBps !== null ? formatBpsWithPct(h.deltaBps) : "—"}
                            </span>
                          </div>
                          <div>
                            Direction hit:{" "}
                            <span className="font-semibold">
                              {h.directionalHit === null ? "—" : h.directionalHit ? "yes" : "no"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
                <LabelWithTip
                  label="Horizon Benchmarks"
                  tip="Compares forecast quality separately at 5m, 30m, and 4h across scored receipts."
                />
              </div>
              <div className="text-[11px] text-zinc-500">
                Total scored forecasts: {benchmarkSampleForecasts}
              </div>
            </div>
            {!sortedBenchmarks.length || sortedBenchmarks.every((row) => row.sample_size === 0) ? (
              <p className="text-xs text-zinc-500">
                No benchmark data yet. Benchmarks appear after scored forecasts accumulate.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-3">
                {sortedBenchmarks.map((row) => (
                  <div key={row.horizon_min} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="font-semibold text-zinc-100">{horizonLabel(row.horizon_min)}</div>
                      <div className="text-zinc-500">n={row.sample_size}</div>
                    </div>
                    <div className="text-zinc-400">
                      Directional:{" "}
                      <span className="font-semibold text-zinc-100">{pretty(row.directional_accuracy * 100, 1)}%</span>
                    </div>
                    <div className="text-zinc-400">
                      MAE: <span className="font-semibold text-zinc-100">{pretty(row.mae_bps, 1)} bps</span>
                    </div>
                    <div className="text-zinc-400">
                      Bias:{" "}
                      <span className="font-semibold text-zinc-100">
                        {row.bias_bps >= 0 ? "+" : ""}
                        {pretty(row.bias_bps, 1)} bps
                      </span>
                    </div>
                    <div className="text-zinc-400">
                      Brier: <span className="font-semibold text-zinc-100">{pretty(row.brier_score, 4)}</span>
                    </div>
                    <div className="text-zinc-400">
                      Calibration gap:{" "}
                      <span className="font-semibold text-zinc-100">{pretty(row.calibration_gap * 100, 1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
                <LabelWithTip
                  label="Performance Over Time"
                  tip="Each point is one scored forecast receipt. Directional (%) should trend up; MAE/Brier/ECE should trend down."
                />
              </div>
              <div className="text-[11px] text-zinc-500">Scored receipts: {performanceSeries.length}</div>
            </div>

            {!performanceSeries.length ? (
              <p className="text-xs text-zinc-500">No scored receipts yet. Timeline will chart automatically once scores are produced.</p>
            ) : (
              <>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={performanceSeries} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis dataKey="label" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
                      <YAxis
                        yAxisId="left"
                        stroke="#a1a1aa"
                        tick={{ fontSize: 11 }}
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#a1a1aa"
                        tick={{ fontSize: 11 }}
                        domain={[0, "dataMax + 0.5"]}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#09090b",
                          border: "1px solid #3f3f46",
                          borderRadius: 8,
                          color: "#e4e4e7",
                          fontSize: 12,
                        }}
                        formatter={(value, name) => {
                          const metricName = String(name ?? "");
                          const numeric = typeof value === "number" ? value : Number(value);
                          if (!Number.isFinite(numeric)) return [String(value ?? "—"), metricName];
                          if (metricName.includes("Directional")) return [`${pretty(numeric, 1)}%`, metricName];
                          if (metricName.includes("MAE")) return [`${pretty(numeric, 2)}%`, metricName];
                          return [pretty(numeric, 4), metricName];
                        }}
                        labelFormatter={(_, payload) => {
                          const row = payload?.[0]?.payload;
                          return row ? `${row.scoredAtLabel} · ${row.forecast}` : "";
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="directionalPct"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        name="Directional %"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="maePct"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        name="MAE %"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="brier"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        name="Brier"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="ece"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        name="ECE"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 text-[11px] text-zinc-500">
                  Bps note: MAE% = MAE(bps) / 100. Example: 32 bps = 0.32%.
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-6xl rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              <Shield className="h-4 w-4 text-emerald-300" />
              API Response Stream
            </div>
            <JsonModeSwitcher mode={payloadViewMode} onModeChange={setPayloadViewMode} />
          </div>

          {error ? (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
          ) : null}

          {payloadViewMode === "text" ? (
            <pre className="max-h-[340px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
              {lastPayload || "No API actions executed yet."}
            </pre>
          ) : (
            <div className="max-h-[340px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
                <Braces className="h-3.5 w-3.5" />
                Genome mode maps JSON leaf values into a visual key/value profile.
              </div>
              <GenomeView data={lastPayloadObject} emptyLabel="No payload available yet." />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function LabelWithTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <TooltipBubble text={tip} />
    </span>
  );
}

function TooltipBubble({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <Info className="h-3.5 w-3.5 cursor-help text-zinc-500 transition group-hover:text-zinc-200" />
      <span className="pointer-events-none absolute left-full z-20 ml-2 w-56 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-[11px] leading-4 text-zinc-200 opacity-0 shadow-lg transition group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function GlossaryChip({ term, description }: { term: string; description: string }) {
  return (
    <span className="group relative inline-flex cursor-help items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[11px] text-zinc-200">
      {term}
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-[11px] leading-4 text-zinc-200 shadow-lg group-hover:block">
        {description}
      </span>
    </span>
  );
}

function JsonModeHeader({
  title,
  description,
  mode,
  onModeChange,
  onFormat,
}: {
  title: string;
  description: string;
  mode: JsonViewMode;
  onModeChange: (mode: JsonViewMode) => void;
  onFormat: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-zinc-200">{title}</p>
          <p className="text-[11px] text-zinc-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <JsonModeSwitcher mode={mode} onModeChange={onModeChange} />
          <button
            type="button"
            onClick={onFormat}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500"
          >
            Format
          </button>
        </div>
      </div>
    </div>
  );
}

function JsonModeSwitcher({
  mode,
  onModeChange,
}: {
  mode: JsonViewMode;
  onModeChange: (mode: JsonViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-900 p-0.5 text-[11px]">
      <button
        type="button"
        onClick={() => onModeChange("text")}
        className={`rounded px-2 py-1 transition ${
          mode === "text" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        Text
      </button>
      <button
        type="button"
        onClick={() => onModeChange("genome")}
        className={`rounded px-2 py-1 transition ${
          mode === "genome" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        Genome
      </button>
    </div>
  );
}

function GenomeView({
  data,
  emptyLabel,
  compact = false,
}: {
  data: unknown;
  emptyLabel: string;
  compact?: boolean;
}) {
  const entries = useMemo(() => flattenGenome(data), [data]);
  const numericValues = entries
    .map((entry) => (typeof entry.value === "number" ? entry.value : null))
    .filter((value): value is number => value !== null);

  const maxAbs = useMemo(() => {
    if (!numericValues.length) return 1;
    return Math.max(...numericValues.map((v) => Math.abs(v)), 1);
  }, [numericValues]);

  if (!entries.length) {
    return <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">{emptyLabel}</p>;
  }

  const limited = compact ? entries.slice(0, 12) : entries.slice(0, 80);

  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-1" : "md:grid-cols-2"}`}>
      {limited.map((entry) => {
        const rawValue = entry.value;
        const isNumber = typeof rawValue === "number" && Number.isFinite(rawValue);
        const pct = isNumber ? normalizePercent(rawValue, maxAbs) : 0;

        return (
          <div key={`${entry.path}:${String(rawValue)}`} className="rounded-md border border-zinc-800 bg-zinc-950 p-2">
            <div className="mb-1 truncate text-[11px] text-zinc-500" title={entry.path}>
              {entry.path}
            </div>
            <div className="truncate font-mono text-xs text-zinc-200" title={String(rawValue)}>
              {String(rawValue)}
            </div>
            {isNumber ? (
              <div className="mt-2 h-1.5 w-full rounded bg-zinc-800">
                <div
                  className={`h-1.5 rounded ${rawValue >= 0 ? "bg-emerald-400" : "bg-rose-400"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="text-xs text-zinc-500">
        <LabelWithTip label={label} tip={tip} />
      </div>
      <div className="mt-1 text-lg font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300">
      <span className="text-zinc-500">{label}:</span> <span className="font-semibold text-zinc-100">{value}</span>
    </div>
  );
}
