"""Read-only quality evidence over raw CSV strings; no cleaning decisions are applied."""
from __future__ import annotations

from typing import Any

import polars as pl


# These are reported as candidates, not rewritten as missing values.
SPECIAL_STRINGS = ('?', 'na', 'n/a', 'nan', 'none', 'null', 'unknown')


def column_quality(raw: pl.Series) -> dict[str, Any]:
    """Summarize blanks, marker candidates, and finite numeric conversions separately."""
    text = raw.fill_null('').str.strip_chars()
    lower = text.str.to_lowercase()
    missing = int((text == '').sum())
    observed = text.filter(text != '')
    numbers = text.cast(pl.Float64, strict=False)
    finite = numbers.filter(numbers.is_finite().fill_null(False))
    invalid = (text != '') & ~lower.is_in(SPECIAL_STRINGS) & numbers.is_null()
    counts = {marker: int((lower == marker).sum()) for marker in SPECIAL_STRINGS}
    result: dict[str, Any] = {
        'missing_count': missing,
        'missing_ratio': missing / len(raw) if len(raw) else 0.0,
        'special_strings': {key: count for key, count in counts.items() if count},
        'unique_count': int(observed.n_unique()),
        'numeric': {
            'min': finite.min(), 'max': finite.max(), 'median': finite.median(),
            'finite_count': len(finite), 'negative_count': int((finite < 0).sum()),
            'non_finite_count': int((numbers.is_not_null() & ~numbers.is_finite()).sum()),
            'parse_failure_count': int(invalid.sum()),
        },
    }
    if 0 < result['unique_count'] <= 2:
        result['value_counts'] = [
            {'value': value, 'count': int((observed == value).sum()),
             'percent': 100 * int((observed == value).sum()) / len(raw)}
            for value in sorted(observed.unique().to_list())
        ]
    return result


def date_values(raw: pl.Series) -> pl.Series:
    """Parse YYYY/MM/DD and YYYY-MM-DD only; malformed and absent values stay null."""
    text = raw.str.strip_chars()
    text = text.set(~text.str.contains(r'^(?:\d{4}/\d{2}/\d{2}|\d{4}-\d{2}-\d{2})$').fill_null(False), None)
    return text.str.replace_all('/', '-').str.strptime(pl.Date, '%Y-%m-%d', strict=False)


def business_checks(lazy: pl.LazyFrame, names: list[str], rows: int) -> list[dict[str, Any]]:
    """Evaluate named insurance-field comparisons, leaving business validity to the user."""
    checks = []
    if 'incident_date' not in names:
        return checks
    selected = [name for name in ('incident_date', 'policy_bind_date', 'auto_year') if name in names]
    frame = lazy.select(selected).collect()
    incident = date_values(frame['incident_date'])
    if 'policy_bind_date' in selected:
        bound = date_values(frame['policy_bind_date'])
        valid = bound.is_not_null() & incident.is_not_null()
        checks.append(_comparison('policy_after_incident', ['policy_bind_date', 'incident_date'], valid, bound > incident, rows))
    if 'auto_year' in selected:
        year = frame['auto_year'].str.strip_chars().cast(pl.Float64, strict=False)
        valid = (year.is_finite() & (year == year.floor()) & incident.is_not_null()).fill_null(False)
        checks.append(_comparison('car_year_after_incident_year', ['auto_year', 'incident_date'], valid, year > incident.dt.year(), rows))
    return checks


def _comparison(code: str, columns: list[str], valid: pl.Series, affected: pl.Series, rows: int) -> dict[str, Any]:
    evaluated = int(valid.sum())
    count = int((valid & affected).sum())
    return {'code': code, 'columns': columns, 'status': 'not_evaluated' if not evaluated else 'warning' if count else 'no_violation',
            'affected_rows': count, 'evaluated_rows': evaluated, 'unevaluable_rows': rows - evaluated,
            'requires_business_confirmation': True}
