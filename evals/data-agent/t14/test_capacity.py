"""Exercise the independent capacity oracle, including a self-consistent but wrong export."""
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
import polars as pl
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[2] / 'services/data-worker'))
from generate import generate
from verify_bundle import check
from engine import import_table, split, fit, transform, export_bundle, DataError, Dataset
from operators import apply_operation


def test_full_oracle_rejects_wrong_value_with_valid_checksums(tmp_path):
    config = {**json.loads((HERE / 'baseline.json').read_text()), 'rows': 1000,
              'numeric_columns': 2, 'category_columns': 1, 'columns': 6}
    source = tmp_path / 'source.parquet'
    facts = generate(config, source)
    dataset = import_table(source, {'format': 'parquet'}, facts['roles'], 10000000)
    dataset, _ = apply_operation(dataset, 'bounds', {'column': 'x0', 'lower': 0, 'upper': 1001, 'action': 'clip'})
    dataset, _ = apply_operation(dataset, 'normalize', {'columns': ['c0'], 'trim': True, 'case': 'preserve'})
    parts, _ = split(dataset, method='entity', column='entity_id', train_fraction=.6, validation_fraction=.2, seed=42)
    for method, columns in [('median', ['x0', 'x1']), ('standard', ['x0', 'x1']), ('onehot', ['c0'])]:
        state = fit(parts['train'], method, columns, 16, 'ignore')
        parts = {name: transform(data, state, 512) for name, data in parts.items()}
    output = tmp_path / 'export'
    export_bundle(parts, output, feature_columns=['x0', 'x1'] + [f'c0__category_{i}' for i in range(5)],
                  target='target', purpose='supervised', allow_null=False, recipe={'business_task_id': 'oracle-test'})
    def pack():
        bundle = tmp_path / 'training.zip'
        with zipfile.ZipFile(bundle, 'w') as archive:
            for path in output.iterdir():
                archive.write(path, path.name)
        return bundle
    result = check(pack(), config)
    expected = json.loads((HERE / 'oracle.expected.json').read_text())
    assert {key: result[key] for key in expected} == expected
    frame = pl.read_parquet(output / 'train.parquet')
    frame.with_columns((pl.col('x0') + .25).alias('x0')).write_parquet(output / 'train.parquet')
    manifest = json.loads((output / 'manifest.json').read_text())
    manifest['files']['train.parquet']['sha256'] = hashlib.sha256((output / 'train.parquet').read_bytes()).hexdigest()
    (output / 'manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(AssertionError):
        check(pack(), config)


def test_long_high_cardinality_rejected_by_onehot_policy(tmp_path):
    config = {**json.loads((HERE / 'long-cardinality.json').read_text()), 'rows': 100000,
              'numeric_columns': 1, 'category_columns': 1, 'columns': 5}
    path = tmp_path / 'stress.parquet'
    facts = generate(config, path)
    assert facts['category_cardinality'] == 100000 and facts['category_utf8_bytes'] == 256
    dataset = import_table(path, {'format': 'parquet'}, facts['roles'], 10000000)
    parts, _ = split(dataset, method='entity', column='entity_id', train_fraction=.6, validation_fraction=.2, seed=42)
    with pytest.raises(DataError, match='DIMENSION_LIMIT'):
        fit(parts['train'], 'onehot', ['c0'], 16, 'ignore')
