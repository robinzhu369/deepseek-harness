"""Deterministic local CSV preprocessing and logistic regression pipeline."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import polars as pl
import sklearn
from scipy import sparse
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .contracts import ModelingContractError, ModelingPlan, ScalarLabel, canonical_plan_hash, validate_plan_payload


DENSE_EXPORT_CELL_LIMIT = 2_000_000


@dataclass(frozen=True)
class PipelineResult:
    """Observable outputs from one completed pipeline run."""

    output_dir: Path
    split_counts: dict[str, int]
    metrics: dict[str, dict[str, Any]]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> None:
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    with path.open("w", encoding="utf-8") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def _json_scalar(value: Any) -> Any:
    """Convert a NumPy scalar into its JSON-native value."""
    return value.item() if isinstance(value, np.generic) else value


def generate_synthetic_csv(path: Path, *, rows: int, seed: int) -> dict[str, int]:
    """Generate a deterministic binary-classification CSV without external data."""
    if rows < 100:
        raise ValueError("rows must be at least 100")
    if path.exists():
        raise FileExistsError(f"refusing to overwrite {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    age = np.clip(rng.normal(43, 11, rows), 18, 79)
    income = np.exp(rng.normal(10.8, 0.48, rows))
    debt_ratio = np.clip(rng.beta(2.3, 5.5, rows), 0, 1)
    tenure = rng.integers(0, 181, rows).astype(float)
    region = rng.choice(["north", "south", "east", "west"], rows, p=[0.25, 0.25, 0.30, 0.20]).astype(object)
    channel = rng.choice(["branch", "mobile", "web"], rows, p=[0.35, 0.40, 0.25]).astype(object)
    logit = -2.1 + 3.4 * debt_ratio - 0.000018 * income - 0.012 * tenure + 0.45 * (channel == "mobile") + 0.35 * (region == "south")
    probability = 1 / (1 + np.exp(-logit))
    label = rng.binomial(1, probability)
    age[rng.choice(rows, max(1, rows // 40), replace=False)] = np.nan
    income[rng.choice(rows, max(1, rows // 50), replace=False)] = np.nan
    debt_ratio[rng.choice(rows, max(1, rows // 60), replace=False)] = np.nan
    for index in rng.choice(rows, max(1, rows // 50), replace=False):
        region[index] = None
    frame = pl.DataFrame({
        "record_id": [f"rec_{index:06d}" for index in range(rows)],
        "age": age,
        "income": income,
        "debt_ratio": debt_ratio,
        "tenure_months": tenure,
        "region": region.tolist(),
        "channel": channel.tolist(),
        "label": label,
    })
    frame.write_csv(path)
    return {"seed": seed, "rows": rows, "columns": len(frame.columns), "positive_label": 1}


def _build_preprocessor(plan: ModelingPlan, numeric: list[str], categorical: list[str]) -> ColumnTransformer:
    numeric_steps: list[tuple[str, Any]] = []
    if plan.preprocessing.numeric_missing == "median":
        numeric_steps.append(("imputer", SimpleImputer(strategy="median", keep_empty_features=True)))
    else:
        numeric_steps.append(("imputer", SimpleImputer(strategy="constant", fill_value=plan.preprocessing.numeric_constant, keep_empty_features=True)))
    if plan.preprocessing.scale_numeric:
        numeric_steps.append(("scaler", StandardScaler()))
    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="constant", fill_value=plan.preprocessing.categorical_missing_value, keep_empty_features=True)),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=True)),
    ])
    transformers: list[tuple[str, Any, list[str]]] = []
    if numeric:
        transformers.append(("numeric", Pipeline(numeric_steps), numeric))
    if categorical:
        transformers.append(("categorical", categorical_pipeline, categorical))
    return ColumnTransformer(transformers, remainder="drop", sparse_threshold=1.0, verbose_feature_names_out=True)


def _metric_block(pipeline: Pipeline, frame: pd.DataFrame, features: list[str], target: str, positive_label: ScalarLabel) -> tuple[dict[str, Any], pd.DataFrame]:
    classes = list(pipeline.named_steps["model"].classes_)
    positive_index = classes.index(positive_label)
    negative_label = next(value for value in classes if value != positive_label)
    probability = pipeline.predict_proba(frame[features])[:, positive_index]
    predicted = np.where(probability >= 0.5, positive_label, negative_label)
    actual = frame[target].to_numpy()
    binary_actual = (actual == positive_label).astype(int)
    binary_predicted = (predicted == positive_label).astype(int)
    metrics = {
        "split": "",
        "samples": len(frame),
        "positive_label": _json_scalar(positive_label),
        "threshold": 0.5,
        "roc_auc": float(roc_auc_score(binary_actual, probability)),
        "average_precision": float(average_precision_score(binary_actual, probability)),
        "f1": float(f1_score(binary_actual, binary_predicted)),
        "confusion_matrix": confusion_matrix(actual, predicted, labels=[negative_label, positive_label]).tolist(),
        "labels": [_json_scalar(negative_label), _json_scalar(positive_label)],
    }
    predictions = pd.DataFrame({
        "record_id": frame["record_id"].astype(str),
        "actual_label": actual,
        "predicted_label": predicted,
        "positive_probability": probability,
    })
    return metrics, predictions


def _export_transformed(
    directory: Path,
    split_name: str,
    preprocessor: ColumnTransformer,
    frame: pd.DataFrame,
    features: list[str],
    target: str,
    output_features: list[str],
) -> dict[str, Any]:
    matrix = preprocessor.transform(frame[features])
    cells = matrix.shape[0] * matrix.shape[1]
    if sparse.issparse(matrix) and cells > DENSE_EXPORT_CELL_LIMIT:
        matrix_path = directory / f"{split_name}.npz"
        sparse.save_npz(matrix_path, matrix.tocsr())
        labels_path = directory / f"{split_name}_labels.parquet"
        pl.DataFrame({"record_id": frame["record_id"].astype(str).tolist(), target: frame[target].tolist()}).write_parquet(labels_path)
        return {"format": "csr_npz", "path": matrix_path.name, "labels_path": labels_path.name, "rows": len(frame), "features": matrix.shape[1]}
    dense = matrix.toarray() if sparse.issparse(matrix) else np.asarray(matrix)
    columns = {name: dense[:, index] for index, name in enumerate(output_features)}
    columns["record_id"] = frame["record_id"].astype(str).tolist()
    columns[target] = frame[target].tolist()
    path = directory / f"{split_name}.parquet"
    pl.DataFrame(columns).write_parquet(path)
    return {"format": "parquet", "path": path.name, "rows": len(frame), "features": dense.shape[1]}


def _preprocessing_parameters(preprocessor: ColumnTransformer, numeric: list[str], categorical: list[str]) -> dict[str, Any]:
    value: dict[str, Any] = {"numeric": {}, "categorical": {}}
    if numeric:
        pipeline = preprocessor.named_transformers_["numeric"]
        value["numeric"]["columns"] = numeric
        value["numeric"]["imputer_statistics"] = pipeline.named_steps["imputer"].statistics_.tolist()
        scaler = pipeline.named_steps.get("scaler")
        if scaler is not None:
            value["numeric"]["scaler_mean"] = scaler.mean_.tolist()
            value["numeric"]["scaler_scale"] = scaler.scale_.tolist()
    if categorical:
        pipeline = preprocessor.named_transformers_["categorical"]
        value["categorical"]["columns"] = categorical
        value["categorical"]["categories"] = [items.tolist() for items in pipeline.named_steps["onehot"].categories_]
    return value


def run_pipeline(csv_path: Path, plan_payload: dict[str, Any], output_dir: Path) -> PipelineResult:
    """Run the fixed split-before-fit pipeline and atomically publish its artifacts."""
    if output_dir.exists():
        raise FileExistsError(f"refusing to overwrite {output_dir}")
    csv_sha256 = _sha256(csv_path)
    try:
        polars_frame = pl.read_csv(csv_path, infer_schema_length=10000)
    except Exception as error:
        raise ModelingContractError("INVALID_CSV", "The CSV could not be parsed.") from error
    frame = pd.DataFrame(polars_frame.to_dicts())
    if "record_id" not in frame.columns or frame["record_id"].isna().any() or not frame["record_id"].is_unique:
        raise ModelingContractError("INVALID_RECORD_ID", "record_id must be present, non-null, and unique.")
    target_value = plan_payload.get("target")
    label_values: set[ScalarLabel] = set()
    if isinstance(target_value, str) and target_value in frame.columns:
        if frame[target_value].isna().any():
            raise ModelingContractError("INVALID_LABELS", "The target contains missing labels.")
        label_values = set(frame[target_value].unique().tolist())
    plan = validate_plan_payload(
        plan_payload,
        columns=set(frame.columns),
        label_values=label_values,
        expected_dataset_sha256=csv_sha256,
    )
    if plan.mode != "binary_classification" or plan.target is None or plan.positive_label is None:
        raise ModelingContractError("UNSUPPORTED_MODE", "T03 runs the binary_classification pipeline.")
    if plan.feature_engineering.date_features.enabled:
        raise ModelingContractError("UNKNOWN_OPERATOR", "Date features are not enabled in the T03 fixed pipeline.")
    target = plan.target
    excluded = set(plan.excluded_columns) | {target}
    features = [column for column in frame.columns if column not in excluded]
    if "record_id" in features:
        raise ModelingContractError("IDENTIFIER_LEAKAGE", "record_id must be excluded from training features.")
    train, remainder = train_test_split(
        frame,
        train_size=plan.split.train_ratio,
        random_state=plan.split.seed,
        stratify=frame[target],
    )
    remainder_test_ratio = plan.split.test_ratio / (plan.split.validation_ratio + plan.split.test_ratio)
    validation, test = train_test_split(
        remainder,
        test_size=remainder_test_ratio,
        random_state=plan.split.seed,
        stratify=remainder[target],
    )
    train = train.sort_values("record_id").reset_index(drop=True)
    validation = validation.sort_values("record_id").reset_index(drop=True)
    test = test.sort_values("record_id").reset_index(drop=True)
    numeric = [column for column in features if pd.api.types.is_numeric_dtype(train[column])]
    categorical = [column for column in features if column not in numeric]
    for column in categorical:
        cardinality = int(train[column].nunique(dropna=True))
        if cardinality > plan.preprocessing.onehot_max_categories:
            raise ModelingContractError(
                "HIGH_CARDINALITY",
                f"Categorical column {column} has {cardinality} training categories; limit is {plan.preprocessing.onehot_max_categories}.",
                details={"column": column, "categories": cardinality},
            )
    preprocessor = _build_preprocessor(plan, numeric, categorical)
    model = LogisticRegression(
        C=plan.models[0].params.C,
        max_iter=plan.models[0].params.max_iter,
        random_state=plan.split.seed,
        solver="liblinear",
    )
    pipeline = Pipeline([("preprocessor", preprocessor), ("model", model)])
    pipeline.fit(train[features], train[target])
    output_features = list(pipeline.named_steps["preprocessor"].get_feature_names_out())
    if len(output_features) > plan.limits.max_output_features:
        raise ModelingContractError(
            "FEATURE_LIMIT_EXCEEDED",
            f"Preprocessing produced {len(output_features)} features; limit is {plan.limits.max_output_features}.",
        )
    metrics: dict[str, dict[str, Any]] = {}
    predictions: dict[str, pd.DataFrame] = {}
    for name, split in (("validation", validation), ("test", test)):
        metric, prediction = _metric_block(pipeline, split, features, target, plan.positive_label)
        metric["split"] = name
        metrics[name] = metric
        predictions[name] = prediction
    staging = output_dir.parent / f".{output_dir.name}.partial-{uuid.uuid4().hex}"
    staging.mkdir(parents=True, exist_ok=False)
    try:
        _write_json(staging / "plan.json", plan.model_dump(mode="json"))
        split_manifest = {
            "schema_version": "1.0",
            "seed": plan.split.seed,
            "ratios": plan.split.model_dump(mode="json"),
            "counts": {"train": len(train), "validation": len(validation), "test": len(test)},
            "record_ids": {
                "train": train["record_id"].astype(str).tolist(),
                "validation": validation["record_id"].astype(str).tolist(),
                "test": test["record_id"].astype(str).tolist(),
            },
        }
        _write_json(staging / "split_manifest.json", split_manifest)
        feature_manifest = {
            "schema_version": "1.0",
            "source_features": features,
            "excluded_columns": sorted(excluded),
            "numeric_features": numeric,
            "categorical_features": categorical,
            "output_features": output_features,
            "fit_record_ids": train["record_id"].astype(str).tolist(),
            "fitted_parameters": _preprocessing_parameters(pipeline.named_steps["preprocessor"], numeric, categorical),
        }
        _write_json(staging / "feature_manifest.json", feature_manifest)
        exports = {
            name: _export_transformed(staging, name, pipeline.named_steps["preprocessor"], split, features, target, output_features)
            for name, split in (("train", train), ("validation", validation), ("test", test))
        }
        for name, prediction in predictions.items():
            pl.DataFrame(prediction.to_dict(orient="list")).write_parquet(staging / f"{name}_predictions.parquet")
        joblib.dump(pipeline.named_steps["preprocessor"], staging / "preprocessor.joblib")
        joblib.dump(pipeline, staging / "pipeline.joblib")
        metrics_document = {
            "schema_version": "1.0",
            "model": "logistic_regression",
            "selection_split": "validation",
            "final_evaluation_split": "test",
            "validation": metrics["validation"],
            "test": metrics["test"],
        }
        _write_json(staging / "metrics.json", metrics_document)
        report = (
            "# Modeling run report\n\n"
            f"The fixed logistic regression pipeline used seed `{plan.split.seed}` and fit preprocessing only on `{len(train)}` training rows.\n\n"
            f"Validation ROC-AUC: `{metrics['validation']['roc_auc']:.6f}`. Test ROC-AUC: `{metrics['test']['roc_auc']:.6f}`. The positive label is `{plan.positive_label}` and the classification threshold is `0.5`.\n"
        )
        (staging / "report.md").write_text(report, encoding="utf-8")
        artifact_files = sorted(path for path in staging.iterdir() if path.is_file())
        manifest = {
            "schema_version": "1.0",
            "dataset": {"path": str(csv_path.resolve()), "sha256": csv_sha256, "rows": len(frame), "columns": len(frame.columns)},
            "plan_hash": canonical_plan_hash(plan),
            "seed": plan.split.seed,
            "split_counts": split_manifest["counts"],
            "exports": exports,
            "software": {
                "python": platform.python_version(),
                "polars": pl.__version__,
                "scikit_learn": sklearn.__version__,
                "joblib": joblib.__version__,
                "platform": sys.platform,
            },
            "artifacts": [
                {"path": path.name, "sha256": _sha256(path), "size_bytes": path.stat().st_size}
                for path in artifact_files
            ],
        }
        _write_json(staging / "manifest.json", manifest)
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        os.replace(staging, output_dir)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return PipelineResult(
        output_dir=output_dir,
        split_counts={"train": len(train), "validation": len(validation), "test": len(test)},
        metrics=metrics,
    )
