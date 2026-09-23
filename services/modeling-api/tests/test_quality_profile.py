"""Exercise full-data quality counts, invalid values, and conditional business rules."""
from pathlib import Path
import json

from app.datasets import build_profile


def test_quality_counts_do_not_confuse_markers_with_missing_or_invalid_numbers(tmp_path: Path) -> None:
    path = tmp_path / 'quality.csv'
    path.write_text('policy_id,amount,fraud\np1,1,0\np1,-3,1\np2,?,0\np3,NaN,1\np4,inf,0\np5,oops,1\np6, ,0\np7,unknown,1\np1,1,0\n')
    profile = build_profile(path, 2)
    amount = profile['columns'][1]
    assert amount['missing_count'] == 1
    assert amount['special_strings'] == {'?': 1, 'nan': 1, 'unknown': 1}
    assert amount['numeric'] == {'min': -3.0, 'max': 1.0, 'median': 1.0, 'finite_count': 3, 'negative_count': 1, 'non_finite_count': 2, 'parse_failure_count': 1}
    assert profile['quality']['duplicate_rows'] == 1
    assert profile['quality']['rows_with_question_mark'] == 1
    assert profile['quality']['policy_id']['duplicate_excess'] == 2
    assert profile['quality']['policy_id']['rows_in_duplicate_groups'] == 3
    assert profile['columns'][2]['value_counts'] == [{'value': '0', 'count': 5, 'percent': 100 * 5 / 9}, {'value': '1', 'count': 4, 'percent': 100 * 4 / 9}]
    json.dumps(profile, allow_nan=False)


def test_date_rules_count_only_evaluable_rows_and_preserve_invalid_counts(tmp_path: Path) -> None:
    path = tmp_path / 'dates.csv'
    path.write_text('policy_bind_date,incident_date,auto_year\n2020/02/02,2020/01/01,2021\nbad,2020-01-01,wrong\n2020-01-01,2020-02-30,2020\n,2020-03-01,2020.5\n2020/01-01,2020/01-01,2020\n')
    profile = build_profile(path, 2)
    assert profile['columns'][0]['date']['invalid_count'] == 2
    checks = {item['code']: item for item in profile['quality']['business_checks']}
    assert checks['policy_after_incident']['affected_rows'] == 1
    assert checks['policy_after_incident']['evaluated_rows'] == 1
    assert checks['policy_after_incident']['unevaluable_rows'] == 4
    assert checks['car_year_after_incident_year']['evaluated_rows'] == 1
    assert checks['car_year_after_incident_year']['affected_rows'] == 1


def test_empty_and_all_missing_columns_have_no_fabricated_numeric_bounds(tmp_path: Path) -> None:
    path = tmp_path / 'empty.csv'
    for content, count in [('a,b\n', 0), ('a,b\n ,?\n ,null\n', 2)]:
        path.write_text(content)
        profile = build_profile(path, 0)
        assert profile['row_count'] == count
        assert profile['columns'][0]['numeric']['min'] is None
        assert profile['quality']['business_checks'] == []
        json.dumps(profile, allow_nan=False)


def test_late_invalid_numeric_value_does_not_abort_profile(tmp_path: Path) -> None:
    path = tmp_path / 'late.csv'
    path.write_text('amount\n' + '1\n' * 10001 + 'bad\n')
    profile = build_profile(path, 1)
    assert profile['columns'][0]['numeric']['parse_failure_count'] == 1
    assert profile['columns'][0]['numeric']['finite_count'] == 10001
