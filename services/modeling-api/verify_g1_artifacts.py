"""Independently verify one completed G1 artifact directory."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score


def sha256(path: Path) -> str:
    """Return the SHA-256 digest of one file."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    """Verify artifact hashes, split isolation, model reload, and test metrics."""
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", type=Path)
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    for artifact in manifest["artifacts"]:
        path = run_dir / artifact["path"]
        if sha256(path) != artifact["sha256"]:
            raise SystemExit(f"artifact hash mismatch: {path}")
    split_manifest = json.loads((run_dir / "split_manifest.json").read_text(encoding="utf-8"))
    split_ids = {name: set(values) for name, values in split_manifest["record_ids"].items()}
    if not split_ids["train"].isdisjoint(split_ids["validation"]):
        raise SystemExit("train and validation ids overlap")
    if not split_ids["train"].isdisjoint(split_ids["test"]):
        raise SystemExit("train and test ids overlap")
    if not split_ids["validation"].isdisjoint(split_ids["test"]):
        raise SystemExit("validation and test ids overlap")
    pipeline = joblib.load(run_dir / "pipeline.joblib")
    feature_manifest = json.loads((run_dir / "feature_manifest.json").read_text(encoding="utf-8"))
    source = pd.read_csv(manifest["dataset"]["path"])
    probability = pipeline.predict_proba(source[feature_manifest["source_features"]].iloc[[0]])
    if probability.shape != (1, 2):
        raise SystemExit("reloaded pipeline did not produce a binary probability")
    predictions = pd.read_parquet(run_dir / "test_predictions.parquet")
    actual = predictions["actual_label"].to_numpy()
    scores = predictions["positive_probability"].to_numpy()
    predicted = predictions["predicted_label"].to_numpy()
    recorded = json.loads((run_dir / "metrics.json").read_text(encoding="utf-8"))["test"]
    recomputed = {
        "roc_auc": float(roc_auc_score(actual, scores)),
        "average_precision": float(average_precision_score(actual, scores)),
        "f1": float(f1_score(actual, predicted)),
        "precision": float(precision_score(actual, predicted, zero_division=0)),
        "recall": float(recall_score(actual, predicted, zero_division=0)),
        "confusion_matrix": confusion_matrix(actual, predicted, labels=recorded["labels"]).tolist(),
    }
    for name in ("roc_auc", "average_precision", "f1", "precision", "recall"):
        if abs(recorded[name] - recomputed[name]) > 1e-12:
            raise SystemExit(f"metric mismatch: {name}")
    if recorded["confusion_matrix"] != recomputed["confusion_matrix"]:
        raise SystemExit("metric mismatch: confusion_matrix")
    print(json.dumps({
        "artifacts_verified": len(manifest["artifacts"]),
        "model_reload": "PASS",
        "split_isolation": "PASS",
        "test_metrics_recomputed": recomputed,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
