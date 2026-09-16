"""Frozen synthetic oracle; no model-generated code, credentials or business data."""
import json
import polars as pl
from engine import Dataset, DataError, ROW_ID, inspect, split, fit, transform
from operators import apply_operation


def evaluate():
    source = Dataset(pl.DataFrame({ROW_ID: [f's:{i}' for i in range(120)],
        'id': [f'{i // 2:05}' for i in range(120)],
        'income': [None if i % 4 == 0 else float(i - 50) for i in range(120)],
        'denominator': [float(i % 3) for i in range(120)],
        'kind': ['a' if i % 2 else 'b' for i in range(120)],
        'target': [i % 2 for i in range(120)]}),
        {'id': 'entity_id', 'income': 'feature', 'denominator': 'feature', 'kind': 'feature', 'target': 'target'}, 'synthetic-v1')
    assert inspect(source)['fields']['income']['nulls'] == 30
    cleaned, report = apply_operation(source, 'fill_constant', {'columns': ['income'], 'value': -1})
    assert report['removed_rows'] == 0
    assert cleaned.frame['income'].to_list() == [-1 if x is None else x for x in source.frame['income']]
    derived, _ = apply_operation(source, 'derive', {'left': 'income', 'right': 'denominator', 'output': 'ratio', 'method': 'divide', 'invalid': 'null'})
    assert derived.frame['ratio'].to_list() == [None if x is None or d == 0 else x/d for x,d in zip(source.frame['income'],source.frame['denominator'])]
    for result in [cleaned, derived]:
        assert result.frame.select(ROW_ID, 'id', 'target').equals(source.frame.select(ROW_ID, 'id', 'target'))
    parts, mapping = split(source, method='entity', column='id', train_fraction=.6, validation_fraction=.2, seed=42)
    again, mapping2 = split(source, method='entity', column='id', train_fraction=.6, validation_fraction=.2, seed=42)
    assert mapping.equals(mapping2)
    state = fit(parts['train'], 'median', ['income'], 10, 'ignore')
    assert state == fit(again['train'], 'median', ['income'], 10, 'ignore')
    altered = parts['test'].derive(parts['test'].frame.with_columns(pl.lit(1e20).alias('income')))
    assert state == fit(parts['train'], 'median', ['income'], 10, 'ignore')
    try:
        fit(altered, 'median', ['income'], 10, 'ignore')
    except DataError as error:
        assert error.code == 'FIT_SCOPE'
    else:
        raise AssertionError('test fit accepted')
    encoder = fit(parts['train'], 'onehot', ['kind'], 10, 'ignore')
    unseen = parts['test'].derive(parts['test'].frame.with_columns(pl.lit('unseen').alias('kind')))
    encoded = transform(unseen, encoder)
    assert encoded.frame['kind__category_0'].sum() == encoded.frame['kind__category_1'].sum() == 0
    for name, part in parts.items():
        result = transform(part, state)
        assert result.frame.select(ROW_ID, 'target').equals(part.frame.select(ROW_ID, 'target'))
    return {'passed': True, 'metrics': {'rows': 120, 'nulls': 30, 'false_changes': 0, 'label_misalignments': 0, 'formula_errors': 0, 'split_reproducible': 1, 'test_fit_rejected': 1, 'unknown_category_width': 2}}


if __name__ == '__main__':
    print(json.dumps(evaluate()))
