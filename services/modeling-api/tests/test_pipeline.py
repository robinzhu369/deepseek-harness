from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
import pytest
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, roc_auc_score

from app.contracts import ModelingContractError
from app.pipeline import generate_synthetic_csv, run_pipeline


REPO_ROOT = Path(__file__).resolve().parents[3]
PLAN_PATH = REPO_ROOT / "docs/modeling-demo/contracts/examples/valid-classification-plan.json"
SEED = 20260920


def plan() -> dict[str, object]:
    value = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    value["assumptions"] = {"samples_independent": True}
    value["split"]["seed"] = SEED
    return value


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_pipeline_splits_before_fit_and_exports_reloadable_artifacts(tmp_path: Path) -> None:
    csv_path = tmp_path / "synthetic.csv"
    generated = generate_synthetic_csv(csv_path, rows=600, seed=SEED)
    original_hash = sha256(csv_path)
    payload = plan()
    payload["dataset_sha256"] = original_hash
    output = tmp_path / "run"

    result = run_pipeline(csv_path, payload, output)

    assert sha256(csv_path) == original_hash
    assert generated == {"seed": SEED, "rows": 600, "columns": 8, "positive_label": 1}
    assert result.split_counts == {"train": 360, "validation": 120, "test": 120}

    split_manifest = json.loads((output / "split_manifest.json").read_text(encoding="utf-8"))
    ids = {name: set(values) for name, values in split_manifest["record_ids"].items()}
    assert ids["train"].isdisjoint(ids["validation"])
    assert ids["train"].isdisjoint(ids["test"])
    assert ids["validation"].isdisjoint(ids["test"])
    assert len(set.union(*ids.values())) == 600

    feature_manifest = json.loads((output / "feature_manifest.json").read_text(encoding="utf-8"))
    assert "record_id" not in feature_manifest["source_features"]
    assert "label" not in feature_manifest["source_features"]
    assert set(feature_manifest["fit_record_ids"]) == ids["train"]
    raw = pd.read_csv(csv_path)
    train_rows = raw[raw["record_id"].isin(ids["train"])]
    fitted_numeric = feature_manifest["fitted_parameters"]["numeric"]
    expected_medians = train_rows[fitted_numeric["columns"]].median().to_numpy()
    assert fitted_numeric["imputer_statistics"] == pytest.approx(expected_medians)
    imputed_train = train_rows[fitted_numeric["columns"]].fillna(dict(zip(fitted_numeric["columns"], expected_medians)))
    assert fitted_numeric["scaler_mean"] == pytest.approx(imputed_train.mean().to_numpy())

    pipeline = joblib.load(output / "pipeline.joblib")
    source_features = feature_manifest["source_features"]
    unknown = raw.loc[[0], source_features].copy()
    unknown.loc[:, "region"] = "UNSEEN_REGION"
    assert pipeline.predict_proba(unknown).shape == (1, 2)
    assert list(pipeline.named_steps["preprocessor"].get_feature_names_out()) == feature_manifest["output_features"]
    for split_name in ("train", "validation", "test"):
        prepared = pd.read_parquet(output / f"{split_name}.parquet")
        assert prepared.columns.tolist() == [*feature_manifest["output_features"], "record_id", "label"]

    predictions = pd.read_parquet(output / "test_predictions.parquet")
    actual = predictions["actual_label"].to_numpy()
    probability = predictions["positive_probability"].to_numpy()
    predicted = predictions["predicted_label"].to_numpy()
    metrics = json.loads((output / "metrics.json").read_text(encoding="utf-8"))["test"]
    assert metrics["roc_auc"] == pytest.approx(roc_auc_score(actual, probability))
    assert metrics["average_precision"] == pytest.approx(average_precision_score(actual, probability))
    assert metrics["f1"] == pytest.approx(f1_score(actual, predicted))
    assert metrics["confusion_matrix"] == confusion_matrix(actual, predicted, labels=[0, 1]).tolist()

    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    for artifact in manifest["artifacts"]:
        artifact_path = output / artifact["path"]
        assert artifact_path.is_file()
        assert sha256(artifact_path) == artifact["sha256"]


def test_rejects_invalid_labels(tmp_path: Path) -> None:
    csv_path = tmp_path / "synthetic.csv"
    generate_synthetic_csv(csv_path, rows=300, seed=SEED)
    frame = pd.read_csv(csv_path)
    frame.loc[0, "label"] = 2
    frame.to_csv(csv_path, index=False)
    payload = plan()
    payload["dataset_sha256"] = sha256(csv_path)

    with pytest.raises(ModelingContractError) as caught:
        run_pipeline(csv_path, payload, tmp_path / "run")
    assert caught.value.code == "INVALID_LABELS"


def test_rejects_high_cardinality_categories(tmp_path: Path) -> None:
    csv_path = tmp_path / "synthetic.csv"
    generate_synthetic_csv(csv_path, rows=300, seed=SEED)
    frame = pd.read_csv(csv_path)
    frame["region"] = [f"region_{index}" for index in range(len(frame))]
    frame.to_csv(csv_path, index=False)
    payload = plan()
    payload["dataset_sha256"] = sha256(csv_path)
    preprocessing = copy.deepcopy(payload["preprocessing"])
    preprocessing["onehot_max_categories"] = 32
    payload["preprocessing"] = preprocessing

    with pytest.raises(ModelingContractError) as caught:
        run_pipeline(csv_path, payload, tmp_path / "run")
    assert caught.value.code == "HIGH_CARDINALITY"
