"""Deterministic Polars operators. Only trusted adapters pass local file paths."""
from __future__ import annotations
import csv
import hashlib
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import polars as pl

VERSION = "1"
ROW_ID = "__row_id"
TYPES = {"string": pl.String, "int64": pl.Int64, "float64": pl.Float64, "date": pl.Date, "boolean": pl.Boolean}
ROLES = {"feature", "target", "entity_id", "record_id", "event_time", "prediction_time", "ignore"}

class DataError(ValueError):
    """Stable failure code suitable for an API error response."""
    def __init__(self, code: str, detail: Any = None):
        super().__init__(code)
        self.code, self.detail = code, detail


def sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def identity(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


@dataclass
class Dataset:
    frame: pl.DataFrame
    roles: dict[str, str]
    source: str
    partition: str | None = None
    transformers: list[dict] = field(default_factory=list)
    preview: bool = False
    split_digest: str | None = None
    operations: list[dict] = field(default_factory=list)
    import_report: dict = field(default_factory=dict)

    def __post_init__(self):
        if ROW_ID not in self.frame.columns or self.frame[ROW_ID].null_count() or self.frame[ROW_ID].n_unique() != self.frame.height:
            raise DataError("ROW_ID_INVALID")
        if set(self.roles) != set(self.frame.columns) - {ROW_ID} or any(role not in ROLES for role in self.roles.values()):
            raise DataError("FIELD_ROLES_REQUIRED")

    def derive(self, frame: pl.DataFrame, **changes) -> Dataset:
        values = dict(roles=self.roles.copy(), source=self.source, partition=self.partition,
                      transformers=list(self.transformers), preview=self.preview, split_digest=self.split_digest, operations=list(self.operations), import_report=dict(self.import_report))
        values.update(changes)
        return Dataset(frame, **values)


def import_table(path: Path, config: dict, roles: dict[str, str], max_bytes: int, *, approval=None, quarantine: Path | None = None) -> Dataset:
    """Decode explicitly; source row positions remain stable after approved quarantine."""
    from jsonschema import Draft202012Validator, ValidationError
    schema=json.loads((Path(__file__).resolve().parents[2]/"domain-contracts/import-options.schema.json").read_text())
    try: Draft202012Validator(schema).validate(config)
    except ValidationError as error: raise DataError("IMPORT_OPTIONS") from error
    if config["format"] == "csv":
        from importer import import_csv
        return import_csv(path,config,roles,max_bytes,approval,quarantine)
    if config["format"] != "parquet": raise DataError("UNSUPPORTED_FORMAT")
    if path.stat().st_size > max_bytes: raise DataError("RESOURCE_LIMIT")
    source=identity({"file":sha_file(path),"parse":config})
    frame=pl.read_parquet(path)
    if set(frame.columns)&{ROW_ID,"__position","__partition"}: raise DataError("RESERVED_COLUMN")
    frame=frame.with_row_index("__position").with_columns((pl.lit(source+":")+pl.col("__position").cast(pl.String)).alias(ROW_ID)).drop("__position")
    return Dataset(frame,roles,source)


def inspect(dataset: Dataset, top_k: int = 10) -> dict:
    if not 1 <= top_k <= 100: raise DataError("RESOURCE_LIMIT")
    frame = dataset.frame
    result = {"scope": "full_exact", "rows": frame.height, "columns": frame.width - 1, "fields": {}, "source": dataset.source}
    for name, dtype in frame.schema.items():
        if name == ROW_ID: continue
        series = frame[name]
        facts = {"type": str(dtype), "nulls": series.null_count(), "unique": series.n_unique()}
        if dtype.is_numeric():
            clean = series.filter(series.is_finite())
            facts.update(non_finite=series.is_infinite().sum() + series.is_nan().sum() if dtype.is_float() else 0,
                         min=clean.min(), max=clean.max(), median=clean.median(), mean=clean.mean())
        else:
            facts["top"] = series.value_counts(sort=True).head(top_k).to_dicts()
        result["fields"][name] = facts
    result["duplicate_rows"] = frame.drop(ROW_ID).is_duplicated().sum()
    return result


def split(dataset: Dataset, *, method: str, train_fraction: float, validation_fraction: float,
          seed: int, column: str | None = None, boundaries: list[str] | None = None) -> tuple[dict[str, Dataset], pl.DataFrame]:
    if train_fraction <= 0 or validation_fraction < 0 or train_fraction + validation_fraction >= 1:
        raise DataError("INVALID_SPLIT")
    if dataset.partition is not None: raise DataError("ALREADY_PARTITIONED")
    frame = dataset.frame
    if method == "time":
        if not column or not boundaries or len(boundaries) != 2 or boundaries[0] >= boundaries[1]:
            raise DataError("INVALID_SPLIT")
        if frame[column].null_count(): raise DataError("TIME_NULL")
        if frame.schema[column] not in (pl.String, pl.Date): raise DataError("TIME_TYPE")
        # ISO date strings are validated before lexical comparisons.
        dates = pl.col(column).str.to_date(strict=True) if frame.schema[column] == pl.String else pl.col(column)
        from datetime import date
        start, end = (date.fromisoformat(v) for v in boundaries)
        assignment = pl.when(dates < start).then(pl.lit("train")).when(dates < end).then(pl.lit("validation")).otherwise(pl.lit("test"))
        frame = frame.sort(column)
    elif method == "stratified":
        if not column or dataset.roles.get(column)!="target": raise DataError("STRATIFY_TARGET_REQUIRED")
        if frame[column].null_count(): raise DataError("NULL_TARGET")
        counts=frame.group_by(column).len()
        train_count=(pl.col("len")*train_fraction).floor()
        validation_count=(pl.col("len")*validation_fraction).floor()
        if counts.filter((train_count<1)|(validation_count<1)|((pl.col("len")-train_count-validation_count)<1)).height:
            raise DataError("STRATUM_TOO_SMALL")
        frame=frame.with_columns(pl.col(ROW_ID).hash(seed=seed).alias("__split_hash")).sort([column,"__split_hash",ROW_ID]).drop("__split_hash")
        rank=pl.col(ROW_ID).cum_count().over(column)-1
        total=pl.len().over(column)
        train_end=(total*train_fraction).floor()
        validation_end=train_end+(total*validation_fraction).floor()
        assignment=pl.when(rank<train_end).then(pl.lit("train")).when(rank<validation_end).then(pl.lit("validation")).otherwise(pl.lit("test"))
    elif method in {"random", "entity"}:
        if method == "entity" and (not column or dataset.roles.get(column) != "entity_id"):
            raise DataError("ENTITY_ROLE_REQUIRED")
        key = column if method == "entity" else ROW_ID
        if frame[key].null_count(): raise DataError("SPLIT_KEY_NULL")
        # Polars hash is reproducible only with the pinned Polars version recorded in the manifest.
        bucket = pl.col(key).hash(seed=seed) % 1_000_000
        assignment = pl.when(bucket < int(train_fraction * 1_000_000)).then(pl.lit("train")).when(bucket < int((train_fraction + validation_fraction) * 1_000_000)).then(pl.lit("validation")).otherwise(pl.lit("test"))
    else:
        raise DataError("UNSUPPORTED_SPLIT")
    assigned = frame.with_columns(assignment.alias("__partition"))
    split_digest = identity({"source": dataset.source, "method": method, "train_fraction": train_fraction,
                             "validation_fraction": validation_fraction, "seed": seed, "column": column,
                             "boundaries": boundaries, "transformers": dataset.transformers, "operations": dataset.operations})
    partitions = {name: dataset.derive(assigned.filter(pl.col("__partition") == name).drop("__partition"), partition=name, split_digest=split_digest)
                  for name in ("train", "validation", "test")}
    if any(value.frame.height == 0 for value in partitions.values()): raise DataError("EMPTY_PARTITION")
    return partitions, assigned.select(ROW_ID, "__partition")


def fit(dataset: Dataset, method: str, columns: list[str], max_categories: int,
        unknown: str, fit_scope: str = "train", lower_quantile: float | None = None, upper_quantile: float | None = None) -> dict:
    if dataset.partition != "train" or fit_scope != "train": raise DataError("FIT_SCOPE")
    if not columns or len(set(columns)) != len(columns) or max_categories < 1 or unknown not in {"ignore", "error"}:
        raise DataError("INVALID_PARAMETERS")
    if method=="quantile_clip":
        if lower_quantile is None or upper_quantile is None or not 0<=lower_quantile<upper_quantile<=1: raise DataError("QUANTILE_RANGE")
    elif lower_quantile is not None or upper_quantile is not None: raise DataError("QUANTILE_RANGE")
    params = {}
    for name in columns:
        if dataset.roles.get(name) != "feature": raise DataError("PROTECTED_FIELD")
        series = dataset.frame[name]
        if isinstance(series.dtype,pl.Decimal): raise DataError("DECIMAL_FIT_POLICY_REQUIRED")
        if method=="mode" and series.dtype not in (pl.String,pl.Boolean) and not series.dtype.is_numeric(): raise DataError("MODE_TYPE")
        if series.null_count() == len(series): raise DataError("ALL_NULL_COLUMN")
        if method == "mode":
            values=series.drop_nulls().mode().sort()
            params[name]={"fill":values[0]}
        elif method == "onehot":
            if series.dtype != pl.String: raise DataError("CATEGORY_TYPE")
            values = series.drop_nulls().unique().sort().to_list()
            if len(values) > max_categories: raise DataError("DIMENSION_LIMIT")
            params[name] = {"categories": values}
        else:
            if not series.dtype.is_numeric(): raise DataError("NUMERIC_TYPE")
            if not series.drop_nulls().is_finite().all(): raise DataError("NON_FINITE")
            if method == "quantile_clip": params[name]={"lower":series.quantile(lower_quantile,interpolation="nearest"),"upper":series.quantile(upper_quantile,interpolation="nearest"),"quantiles":[lower_quantile,upper_quantile],"interpolation":"nearest"}
            elif method == "median": params[name] = {"fill": series.median()}
            elif method == "mean": params[name] = {"fill": series.mean()}
            elif method == "standard": params[name] = {"offset": series.mean(), "scale": series.std(ddof=0) or 1.0}
            elif method == "minmax": params[name] = {"offset": series.min(), "scale": (series.max() - series.min()) or 1.0}
            else: raise DataError("UNSUPPORTED_OPERATOR")
    return {"operator_version": VERSION, "polars_version": pl.__version__, "method": method, "params": params,
            "fit_scope": "train", "fit_source": dataset.source, "split_digest": dataset.split_digest,
            "fit_rows_digest": identity(dataset.frame[ROW_ID].sort().to_list()),
            "operations_digest": identity(dataset.operations),
            "previous_transformers": [identity(t) for t in dataset.transformers], "unknown": unknown, "preview": dataset.preview}


def transform(dataset: Dataset, transformer: dict, max_columns: int = 1000) -> Dataset:
    if transformer["preview"] and not dataset.preview: raise DataError("PREVIEW_TRANSFORMER")
    if transformer["fit_scope"] != "train" or transformer["operator_version"] != VERSION or transformer["polars_version"] != pl.__version__:
        raise DataError("TRANSFORMER_INCOMPATIBLE")
    if transformer.get("split_digest") != dataset.split_digest or not dataset.split_digest: raise DataError("SPLIT_MISMATCH")
    if transformer["fit_source"] != dataset.source: raise DataError("TRANSFORMER_SOURCE")
    if transformer.get("operations_digest") != identity(dataset.operations): raise DataError("TRANSFORM_ORDER")
    if transformer["previous_transformers"] != [identity(t) for t in dataset.transformers]: raise DataError("TRANSFORM_ORDER")
    frame, roles = dataset.frame, dataset.roles.copy()
    expanded = frame.width + sum(len(p.get("categories", [])) for p in transformer["params"].values())
    if expanded > max_columns: raise DataError("DIMENSION_LIMIT")
    for name, params in transformer["params"].items():
        if roles.get(name) != "feature": raise DataError("PROTECTED_FIELD")
        col = pl.col(name)
        if "fill" in params: frame = frame.with_columns(col.fill_null(params["fill"]))
        elif "lower" in params: frame = frame.with_columns(col.clip(params["lower"],params["upper"]))
        elif "scale" in params: frame = frame.with_columns((col - params["offset"]) / params["scale"])
        else:
            values = params["categories"]
            if transformer["unknown"] == "error" and frame.filter(col.is_not_null() & ~col.is_in(values)).height:
                raise DataError("UNKNOWN_CATEGORY")
            expressions = []
            for index, value in enumerate(values):
                output = name + "__category_" + str(index)
                if output in frame.columns: raise DataError("FEATURE_COLLISION")
                expressions.append((col == value).fill_null(False).cast(pl.UInt8).alias(output))
                roles[output] = "feature"
            frame = frame.with_columns(expressions).drop(name)
            del roles[name]
    return dataset.derive(frame, roles=roles, transformers=dataset.transformers + [transformer])


def select(dataset: Dataset, columns: list[str]) -> tuple[Dataset, dict]:
    if len(set(columns)) != len(columns) or any(column not in dataset.roles for column in columns): raise DataError("INVALID_COLUMNS")
    protected = {name for name, role in dataset.roles.items() if role in {"target", "entity_id", "record_id", "event_time", "prediction_time"}}
    if not protected.issubset(columns): raise DataError("PROTECTED_FIELD")
    result = dataset.derive(dataset.frame.select(ROW_ID, *columns), roles={name: dataset.roles[name] for name in columns}, operations=dataset.operations+[{"operator":"select","params":{"columns":columns}}])
    return result, {"removed_columns": sorted(set(dataset.roles) - set(columns)), "removed_rows": 0, "scope": "full_exact"}


def quality(dataset: Dataset, feature_columns: list[str], purpose: str, allow_null: bool, target: str | None = None) -> dict:
    errors = []
    if dataset.frame.height == 0: errors.append("EMPTY_DATASET")
    if purpose not in {"supervised", "unsupervised", "inference"}: errors.append("PURPOSE_REQUIRED")
    if not feature_columns or len(set(feature_columns)) != len(feature_columns): errors.append("FEATURE_COLUMNS")
    for name in feature_columns:
        if dataset.roles.get(name) != "feature": errors.append("FEATURE_ROLE:" + name); continue
        series = dataset.frame[name]
        if not allow_null and series.null_count(): errors.append("NULL_FEATURE:" + name)
        if series.dtype.is_float() and (series.is_infinite().any() or series.is_nan().any()): errors.append("NON_FINITE:" + name)
    if purpose == "supervised":
        if not target or dataset.roles.get(target) != "target": errors.append("TARGET_REQUIRED")
        elif dataset.frame[target].null_count(): errors.append("NULL_TARGET")
        elif dataset.frame[target].dtype.is_float() and not dataset.frame[target].is_finite().all(): errors.append("NON_FINITE_TARGET")
    if dataset.preview: errors.append("PREVIEW_DATA")
    status = "blocked" if errors else "ready_for_training_contract" if dataset.partition in {"train", "validation", "test"} and dataset.split_digest else "prepared"
    return {"status": status, "errors": errors, "scope": "full_exact", "rows": dataset.frame.height,
            "feature_columns": feature_columns, "target": target, "purpose": purpose,
            "allow_null": allow_null, "partition": dataset.partition, "source": dataset.source}


def export_bundle(partitions: dict[str, Dataset], output: Path, *, feature_columns: list[str], target: str | None,
                  purpose: str, allow_null: bool, recipe: dict) -> dict:
    if set(partitions) != {"train", "validation", "test"}: raise DataError("PARTITIONS_REQUIRED")
    if any(data.partition != name for name,data in partitions.items()): raise DataError('EXPORT_PARTITION')
    reports = {key: quality(data, feature_columns, purpose, allow_null, target) for key, data in partitions.items()}
    if any(report["status"] != "ready_for_training_contract" for report in reports.values()): raise DataError("QUALITY_GATE", reports)
    datasets = list(partitions.values())
    if any(data.frame.schema != datasets[0].frame.schema or data.roles != datasets[0].roles for data in datasets): raise DataError("SCHEMA_MISMATCH")
    if any([identity(t) for t in data.transformers] != [identity(t) for t in datasets[0].transformers] for data in datasets): raise DataError("TRANSFORMER_MISMATCH")
    if len({data.split_digest for data in datasets}) != 1: raise DataError("SPLIT_MISMATCH")
    if len({data.source for data in datasets}) != 1: raise DataError("SOURCE_MISMATCH")
    all_ids = pl.concat([data.frame.select(ROW_ID) for data in datasets])
    if all_ids[ROW_ID].n_unique() != all_ids.height: raise DataError("PARTITION_OVERLAP")
    output.mkdir(parents=True, exist_ok=False)
    files = {}
    for name, data in partitions.items():
        path = output / (name + ".parquet")
        data.frame.write_parquet(path)
        files[path.name] = {"sha256": sha_file(path), "bytes": path.stat().st_size, "rows": data.frame.height}
    first = datasets[0]
    dictionary = [{"name": name, "dtype": str(dtype), "role": first.roles.get(name, "metadata")} for name, dtype in first.frame.schema.items()]
    for name, value in {"fields.json": dictionary, "recipe.json": {"plan":recipe,"executed_operations":first.operations}, "transformers.json": first.transformers, "quality.json": reports}.items():
        path = output / name
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        files[name] = {"sha256": sha_file(path), "bytes": path.stat().st_size}
    manifest = {"status": "ready_for_training_contract", "source": first.source, "polars_version": pl.__version__,
                "operator_version": VERSION, "rows": all_ids.height, "files": files, "fit_scope": "train"}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
