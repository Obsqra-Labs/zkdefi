"""
train_all.py — Master training orchestrator for all 5 EZKL-proven models.

Workflow:
  1. Collect real data from Ekubo mainnet/Sepolia, DefiLlama, Juno RPC
  2. Train timing_predictor MLP (15→32→16→2)
  3. Train llm_fallback MLP (10→32→16→3)
  4. Retrain creditworthiness MLP if decision_store has new data
  5. Run EZKL setup for any model missing pk/vk
  6. Generate test proofs to verify the pipeline

Usage:
    cd backend
    python -m app.ml.data_pipeline.train_all
    python -m app.ml.data_pipeline.train_all --skip-collect
    python -m app.ml.data_pipeline.train_all --model timing_predictor
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("train_all")

BACKEND_DIR = Path(__file__).resolve().parents[3]  # backend/
DATA_DIR = BACKEND_DIR / "app" / "data"
EZKL_DIR = DATA_DIR / "ezkl_models"


async def step_collect_data(skip: bool = False) -> dict:
    """Step 1: Collect real data from all sources."""
    if skip:
        logger.info("[1/6] SKIPPED data collection (--skip-collect)")
        # Try to load existing data
        from app.ml.data_pipeline.mainnet_collector import get_data_collector
        collector = get_data_collector()
        latest = collector.load_latest_dataset()
        if latest:
            meta = latest.get("metadata", {})
            logger.info("  Using existing dataset: %d pools, %d wallets",
                        meta.get("pool_samples", 0), meta.get("wallet_samples", 0))
            return latest
        logger.warning("  No existing dataset found. Collection will be needed.")
        return {"pool_samples": [], "wallet_samples": []}

    logger.info("[1/6] Collecting data from mainnet + Sepolia...")
    from app.ml.data_pipeline.mainnet_collector import get_data_collector
    collector = get_data_collector()

    try:
        result = await collector.collect_all()
        logger.info("  Collected %d pool samples, %d wallet samples (%d errors) in %.1fs",
                     len(result.pool_samples), len(result.wallet_samples),
                     len(result.errors), result.duration_seconds)

        if result.errors:
            for err in result.errors[:5]:
                logger.warning("  Error: %s", err)

        return {
            "pool_samples": [
                {k: v for k, v in s.__dict__.items()} for s in result.pool_samples
            ],
            "wallet_samples": [
                {k: v for k, v in s.__dict__.items()} for s in result.wallet_samples
            ],
        }
    except Exception as e:
        logger.error("  Data collection failed: %s", e)
        return {"pool_samples": [], "wallet_samples": []}
    finally:
        await collector.close()


async def step_train_timing(
    pool_samples: list[dict],
    epochs: int = 300,
) -> dict:
    """Step 2: Train timing predictor MLP."""
    logger.info("[2/6] Training timing predictor MLP...")
    from app.ml.timing_predictor.trainer import train_timing_model

    result = await train_timing_model(
        pool_samples=pool_samples if pool_samples else None,
        synthetic_samples=500,
        epochs=epochs,
    )
    logger.info("  → %s (loss=%.6f, MAE_blocks=%.1f)",
                result["status"],
                result.get("final_loss", -1),
                result.get("mae_blocks", -1))
    return result


async def step_train_fallback(
    n_samples: int = 2000,
    epochs: int = 500,
) -> dict:
    """Step 3: Train LLM fallback MLP."""
    logger.info("[3/6] Training LLM fallback MLP...")
    from app.ml.llm_fallback.trainer import train_fallback_model

    result = await train_fallback_model(
        n_samples=n_samples,
        epochs=epochs,
    )
    logger.info("  → %s (accuracy=%.3f, dist=%s)",
                result["status"],
                result.get("accuracy", -1),
                result.get("class_distribution", {}))
    return result


async def step_retrain_creditworthiness() -> dict:
    """Step 4: Retrain creditworthiness if new data available."""
    logger.info("[4/6] Checking creditworthiness model...")

    meta_path = EZKL_DIR / "creditworthiness" / "training_metadata.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        existing_samples = meta.get("training_samples", 0)
        logger.info("  Existing model has %d samples", existing_samples)
    else:
        existing_samples = 0

    try:
        from app.ml.creditworthiness.trainer import train_model
        result = await train_model(min_events=5)
        if result.get("status") == "success":
            logger.info("  → Retrained: %d samples, accuracy=%.3f",
                        result.get("training_samples", 0),
                        result.get("accuracy", -1))
        else:
            logger.info("  → Skipped: %s", result.get("message", result.get("status")))
        return result
    except Exception as e:
        logger.warning("  → Creditworthiness training error: %s", e)
        return {"status": "error", "message": str(e)}


async def step_ezkl_setup(models: list[str] | None = None) -> dict:
    """Step 5: Run EZKL setup for models missing pk/vk."""
    logger.info("[5/6] EZKL setup for new models...")
    results = {}

    targets = models or ["timing_predictor", "llm_fallback"]

    for model_name in targets:
        model_dir = EZKL_DIR / model_name
        pk_exists = (model_dir / "pk.key").exists()
        vk_exists = (model_dir / "vk.key").exists()
        onnx_exists = any(model_dir.glob("*.onnx"))

        if pk_exists and vk_exists:
            logger.info("  %s: pk/vk already exist, skipping", model_name)
            results[model_name] = {"status": "already_setup"}
            continue

        if not onnx_exists:
            logger.warning("  %s: no ONNX model found, skipping EZKL setup", model_name)
            results[model_name] = {"status": "no_onnx"}
            continue

        try:
            if model_name == "timing_predictor":
                from app.ml.timing_predictor.trainer import setup_timing_ezkl
                result = await setup_timing_ezkl(force=True)
            elif model_name == "llm_fallback":
                from app.ml.llm_fallback.trainer import setup_fallback_ezkl
                result = await setup_fallback_ezkl(force=True)
            elif model_name == "creditworthiness":
                from app.ml.creditworthiness.ezkl_setup import setup_creditworthiness_ezkl
                result = await setup_creditworthiness_ezkl(force=True)
            else:
                result = {"status": "unknown_model"}

            logger.info("  %s: %s (ready=%s)",
                        model_name, result.get("status"), result.get("ready"))
            results[model_name] = result

        except Exception as e:
            logger.error("  %s: EZKL setup failed: %s", model_name, e)
            results[model_name] = {"status": "error", "message": str(e)}

    return results


async def step_verify_proofs() -> dict:
    """Step 6: Generate test proofs to verify the pipeline works."""
    logger.info("[6/6] Generating test proofs...")
    results = {}

    from app.services.ezkl_prover_service import get_ezkl_prover
    prover = get_ezkl_prover()

    model_test_inputs = {
        "timing_predictor": [0.5] * 15,     # Normalised 15-dim
        "llm_fallback": [0.5] * 10,          # Normalised 10-dim
        "creditworthiness": [0.5] * 18,       # Normalised 18-dim
    }

    for model_name, test_input in model_test_inputs.items():
        model_dir = EZKL_DIR / model_name
        if not (model_dir / "pk.key").exists():
            logger.info("  %s: no pk.key, skipping proof test", model_name)
            results[model_name] = {"status": "no_setup"}
            continue

        try:
            proof = await prover.generate_proof(
                model_name=model_name,
                input_data=[test_input],
            )
            results[model_name] = {
                "status": "success",
                "proof_hash": proof.proof_hash[:16] + "...",
                "output_hash": proof.output_hash[:16] + "...",
                "verified": proof.verified,
            }
            logger.info("  %s: proof generated ✓ (verified=%s)", model_name, proof.verified)
        except Exception as e:
            logger.warning("  %s: proof generation failed: %s", model_name, e)
            results[model_name] = {"status": "error", "message": str(e)}

    return results


async def run_all(
    skip_collect: bool = False,
    target_model: str | None = None,
    skip_ezkl: bool = False,
    skip_proofs: bool = False,
    epochs: int = 300,
) -> dict:
    """Run the full training pipeline."""
    t0 = time.monotonic()
    results = {}

    logger.info("=" * 60)
    logger.info("zkde.fi Model Training Pipeline")
    logger.info("=" * 60)

    # Step 1: Collect data
    data = await step_collect_data(skip=skip_collect)
    pool_samples = data.get("pool_samples", [])
    results["data_collection"] = {
        "pool_samples": len(pool_samples),
        "wallet_samples": len(data.get("wallet_samples", [])),
    }

    # Step 2: Train timing predictor
    if target_model in (None, "timing_predictor"):
        results["timing_predictor"] = await step_train_timing(pool_samples, epochs=epochs)
    else:
        logger.info("[2/6] SKIPPED timing_predictor (target=%s)", target_model)

    # Step 3: Train LLM fallback
    if target_model in (None, "llm_fallback"):
        results["llm_fallback"] = await step_train_fallback(epochs=min(epochs, 500))
    else:
        logger.info("[3/6] SKIPPED llm_fallback (target=%s)", target_model)

    # Step 4: Retrain creditworthiness
    if target_model in (None, "creditworthiness"):
        results["creditworthiness"] = await step_retrain_creditworthiness()
    else:
        logger.info("[4/6] SKIPPED creditworthiness (target=%s)", target_model)

    # Step 5: EZKL setup
    if not skip_ezkl:
        ezkl_targets = [target_model] if target_model else None
        results["ezkl_setup"] = await step_ezkl_setup(models=ezkl_targets)
    else:
        logger.info("[5/6] SKIPPED EZKL setup (--skip-ezkl)")

    # Step 6: Test proofs
    if not skip_proofs:
        results["proof_verification"] = await step_verify_proofs()
    else:
        logger.info("[6/6] SKIPPED proof verification (--skip-proofs)")

    elapsed = time.monotonic() - t0
    results["total_duration_seconds"] = round(elapsed, 2)

    logger.info("=" * 60)
    logger.info("Pipeline completed in %.1fs", elapsed)
    logger.info("=" * 60)

    # Save summary
    summary_path = DATA_DIR / "training_datasets" / "training_summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(results, indent=2, default=str))
    logger.info("Summary saved to %s", summary_path)

    return results


def main():
    parser = argparse.ArgumentParser(description="Train all EZKL-proven ML models")
    parser.add_argument("--skip-collect", action="store_true", help="Skip data collection")
    parser.add_argument("--skip-ezkl", action="store_true", help="Skip EZKL setup")
    parser.add_argument("--skip-proofs", action="store_true", help="Skip test proof generation")
    parser.add_argument("--model", type=str, help="Train only specific model")
    parser.add_argument("--epochs", type=int, default=300, help="Training epochs")

    args = parser.parse_args()

    # Add backend to path
    backend_path = str(BACKEND_DIR)
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)

    results = asyncio.run(run_all(
        skip_collect=args.skip_collect,
        target_model=args.model,
        skip_ezkl=args.skip_ezkl,
        skip_proofs=args.skip_proofs,
        epochs=args.epochs,
    ))

    # Print summary
    print("\n" + json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main()
