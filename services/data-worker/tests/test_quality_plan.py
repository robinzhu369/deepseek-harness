"""Independent oracle must detect worker defects, not just accept valid parameters."""
from copy import deepcopy
import evaluate_plan


def payload(skill='data-cleaning'):
    ref = dict(kind='DatasetRef', project_id='synthetic', artifact_id='input', digest='a'*64)
    rows = [dict(id='0007', income=None, denominator=0, target=1),
            dict(id='0008', income=0., denominator=-3, target=0),
            dict(id='0009', income=-12.5, denominator=2, target=1),
            dict(id='0010', income=1000000., denominator=0, target=0)]
    feature = skill == 'feature-engineering'
    node = dict(id='step', operator='derive' if feature else 'fill_constant', operator_version='1',
                params=dict(left='income', right='denominator', output='income_ratio', method='divide', invalid='null')
                if feature else dict(columns=['income'], value=-1), inputs=dict(data=ref))
    return dict(skill_id=skill, input=dict(rows=rows, dataset=ref,
                roles=dict(id='entity_id', income='feature', denominator='feature', target='target')),
                workflow=dict(seed=42, nodes=[node]), order=['step'])


def test_new_synthetic_cases_preserve_identifiers_labels_zero_and_zero_division():
    for skill in ['data-cleaning', 'feature-engineering']:
        result = evaluate_plan.evaluate(payload(skill))
        assert result['passed'] and result['metrics']['checked_outputs'] == 1


def test_independent_oracle_catches_wrong_worker_calculation(monkeypatch):
    original = evaluate_plan.execute
    def broken(request, output):
        request = deepcopy(request)
        request['spec']['params']['value'] = 999
        return original(request, output)
    monkeypatch.setattr(evaluate_plan, 'execute', broken)
    result = evaluate_plan.evaluate(payload())
    assert not result['passed']
    assert result['blocking_failures'] == ['EXECUTED_DATA_MISMATCH']


def test_execution_rejects_artifact_substitution():
    import pytest
    value = payload()
    value['workflow']['nodes'][0]['inputs']['data'] = {**value['input']['dataset'], 'digest': 'b'*64}
    with pytest.raises(ValueError, match='ARTIFACT_VERSION_MISMATCH'):
        evaluate_plan.evaluate(value)
