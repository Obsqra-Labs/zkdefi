/**
 * Browser-side ONNX Credit Scorer
 * ================================
 *
 * Runs the creditworthiness MLP entirely in the browser via onnxruntime-web.
 * No data leaves the user's device — true client-side privacy.
 *
 * Pipeline:
 *   1. Fetch ONNX model + norm params from backend (cached)
 *   2. Extract 18 features from reputation data
 *   3. Normalize using saved min/range params
 *   4. Run ONNX inference (Linear(18→64)→ReLU→Linear(64→32)→ReLU→Linear(32→5))
 *   5. Map outputs → FICO score (300-850), credit class (AAA-C)
 */

import { apiUrl } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

export interface BrowserCreditScore {
  fico_score: number;
  fico_tier: string;
  credit_class: string;
  credit_class_index: number;
  confidence: number;
  features: Record<string, number>;
  feature_hash: string;
  inference_ms: number;
  ran_in_browser: true;
}

interface NormParams {
  min: number[];
  range: number[];
}

/* ─── constants ────────────────────────────────────────────────────── */

const CREDIT_CLASSES = ["AAA", "AA", "A", "B", "C"] as const;

const FICO_CLASS_RANGES: [number, number][] = [
  [800, 850], // AAA
  [740, 799], // AA
  [670, 739], // A
  [580, 669], // B
  [300, 579], // C
];

const FICO_TIERS: [number, string][] = [
  [750, "excellent"],
  [670, "good"],
  [580, "fair"],
  [0, "poor"],
];

const FEATURE_NAMES = [
  "chains_active",
  "total_tx_count",
  "total_value_usd",
  "account_age_days",
  "protocol_diversity",
  "success_rate",
  "unique_contracts",
  "early_exit_rate",
  "avg_hold_duration_hours",
  "proof_success_rate",
  "rebalance_frequency",
  "avg_action_size_eth",
  "max_single_loss_pct",
  "time_since_last_action_hours",
  "tier",
  "tenure_days",
  "collateral_eth",
  "on_chain_reputation_score",
] as const;

const ETH_PRICE_USD = 2000;

/* ─── module-level cache ───────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _session: any | null = null;
let _normParams: NormParams | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ort: any | null = null;
let _initPromise: Promise<void> | null = null;

/* ─── CDN loader (bypasses webpack entirely) ───────────────────────── */

function loadOrtFromCDN(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (g.ort) return Promise.resolve(g.ort);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.min.js";
    script.async = true;
    script.onload = () => {
      if (g.ort) resolve(g.ort);
      else reject(new Error("onnxruntime-web loaded but ort global not found"));
    };
    script.onerror = () => reject(new Error("Failed to load onnxruntime-web from CDN"));
    document.head.appendChild(script);
  });
}

/* ─── initialization ───────────────────────────────────────────────── */

async function ensureInit(): Promise<void> {
  if (_session && _normParams) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // Load onnxruntime-web from CDN (avoids webpack parse errors)
      if (!_ort) {
        _ort = await loadOrtFromCDN();
        _ort.env.wasm.numThreads = 1;
      }

      // Fetch norm params
      if (!_normParams) {
        const res = await fetch(apiUrl("/api/v1/paper-trade/model-artifacts/norm-params"));
        if (!res.ok) throw new Error(`Failed to fetch norm params: ${res.status}`);
        _normParams = await res.json();
      }

      // Fetch ONNX model
      if (!_session) {
        const res = await fetch(apiUrl("/api/v1/paper-trade/model-artifacts/onnx"));
        if (!res.ok) throw new Error(`Failed to fetch ONNX model: ${res.status}`);
        const buffer = await res.arrayBuffer();
        _session = await _ort.InferenceSession.create(buffer);
      }
    } catch (err) {
      // Reset so next attempt can retry instead of returning the rejected promise
      _initPromise = null;
      throw err;
    }
  })();

  return _initPromise;
}

/* ─── feature extraction (mirrors Python) ──────────────────────────── */

export interface ReputationInput {
  nonce: number;
  total_capital_usd: number;
  protocol_count: number;
  position_count: number;
  signals: Array<{ signal: string; value: number }>;
  defi_veteran_score: number;
  recommended_tier: number;
  account_type: string;
  account_exists: boolean;
}

function extractFeatures(data: ReputationInput): number[] {
  const sigs: Record<string, number> = {};
  for (const s of data.signals ?? []) {
    sigs[s.signal] = s.value;
  }

  const txCount = Math.max(data.nonce, 0);
  const totalUsd = Math.max(data.total_capital_usd, 0);
  const ageDays = Math.min(Math.max(txCount / 3, 0), 730);

  const hasPositions = data.position_count > 0 ? 1 : 0;
  const vetSig = sigs.power_user ?? sigs.active_user ?? 0;
  const successRate = Math.min(0.5 + 0.3 * hasPositions + 0.2 * vetSig, 1.0);

  const uniqueContracts = data.protocol_count * 2 + Math.min(data.position_count, 10);

  const diamondHands = sigs.diamond_hands ?? 0;
  const balanced = sigs.balanced_deployer ?? 0;
  const conviction = Math.max(diamondHands, balanced);
  const earlyExitRate = Math.max(1 - conviction, 0);

  const staker = sigs.staker ?? 0;
  const lp = sigs.liquidity_provider ?? 0;
  const holdDuration = Math.min(24 + staker * 200 + lp * 150, 500);

  const safeAge = Math.max(ageDays, 1);
  const rebalFreq = Math.min(txCount / (safeAge * 24), 2);

  const safeNonce = Math.max(txCount, 1);
  const avgSize = Math.min(totalUsd / safeNonce / ETH_PRICE_USD, 10);

  const survivor = sigs.market_survivor ?? 0;
  const maxLoss = Math.max(0.3 - survivor * 0.2, 0);

  return [
    1.0,                                        // chains_active
    txCount,                                     // total_tx_count
    totalUsd,                                    // total_value_usd
    ageDays,                                     // account_age_days
    Math.max(data.protocol_count, 0),            // protocol_diversity
    successRate,                                 // success_rate
    uniqueContracts,                             // unique_contracts
    earlyExitRate,                               // early_exit_rate
    holdDuration,                                // avg_hold_duration_hours
    1.0,                                         // proof_success_rate
    rebalFreq,                                   // rebalance_frequency
    avgSize,                                     // avg_action_size_eth
    maxLoss,                                     // max_single_loss_pct
    0.0,                                         // time_since_last_action_hours
    Math.max(Math.min(data.recommended_tier, 5), 0), // tier
    ageDays,                                     // tenure_days
    Math.min(totalUsd / ETH_PRICE_USD, 50),      // collateral_eth
    Math.max(Math.min(data.defi_veteran_score, 100), 0), // on_chain_reputation_score
  ];
}

/* ─── normalization ────────────────────────────────────────────────── */

function normalize(features: number[], params: NormParams): number[] {
  return features.map((val, i) => {
    const lo = params.min[i] ?? 0;
    const rng = Math.max(params.range[i] ?? 1, 1e-8);
    return Math.max(Math.min((val - lo) / rng, 1), 0);
  });
}

/* ─── softmax ──────────────────────────────────────────────────────── */

function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/* ─── SHA-256 helper ───────────────────────────────────────────────── */

async function sha256hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return (
    "0x" +
    Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/* ─── logits → FICO ────────────────────────────────────────────────── */

function logitsToFico(logits: number[], probs: number[]) {
  const classIdx = logits.indexOf(Math.max(...logits));
  const confidence = probs[classIdx];
  const creditClass = CREDIT_CLASSES[classIdx];
  const [lo, hi] = FICO_CLASS_RANGES[classIdx];
  const ficoScore = Math.max(300, Math.min(850, Math.round(lo + (hi - lo) * Math.min(confidence, 1))));
  let ficoTier = "poor";
  for (const [threshold, tier] of FICO_TIERS) {
    if (ficoScore >= threshold) {
      ficoTier = tier;
      break;
    }
  }
  return { ficoScore, ficoTier, creditClass, classIdx, confidence };
}

/* ─── main scoring function ────────────────────────────────────────── */

export async function scoreCreditInBrowser(
  input: ReputationInput,
): Promise<BrowserCreditScore> {
  const t0 = performance.now();

  await ensureInit();
  if (!_session || !_normParams || !_ort) {
    throw new Error("ONNX runtime not initialized");
  }

  // Feature extraction + normalization (mirrors Python exactly)
  const rawFeatures = extractFeatures(input);
  const normalized = normalize(rawFeatures, _normParams);

  // ONNX inference
  const inputTensor = new _ort.Tensor("float32", new Float32Array(normalized), [1, 18]);
  const results = await _session.run({ features: inputTensor });
  const outputKey = Object.keys(results)[0];
  const logits = Array.from(results[outputKey].data as Float32Array);
  const probs = softmax(logits);

  // Map to FICO
  const { ficoScore, ficoTier, creditClass, classIdx, confidence } = logitsToFico(logits, probs);

  // Feature hash
  const featureCanon = JSON.stringify(normalized.map((v) => Math.round(v * 1e6) / 1e6));
  const featureHash = await sha256hex(featureCanon);

  // Named features
  const features: Record<string, number> = {};
  FEATURE_NAMES.forEach((name, i) => {
    features[name] = Math.round(rawFeatures[i] * 1e6) / 1e6;
  });

  return {
    fico_score: ficoScore,
    fico_tier: ficoTier,
    credit_class: creditClass,
    credit_class_index: classIdx,
    confidence: Math.round(confidence * 1e4) / 1e4,
    features,
    feature_hash: featureHash,
    inference_ms: Math.round(performance.now() - t0),
    ran_in_browser: true,
  };
}

/** Check if onnxruntime-web is available (browser-only) */
export async function isOnnxAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    await loadOrtFromCDN();
    return true;
  } catch {
    return false;
  }
}
