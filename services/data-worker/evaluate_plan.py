"""Execute validated synthetic proposals through the production executor, with independent row oracles.

No model code is evaluated. The parent validates the Skill result, compiles the DAG,
and supplies its topological order. This lane does not publish or approve artifacts.
"""
import json
import sys
import tempfile
from pathlib import Path
import polars as pl
from engine import ROW_ID, sha_file
from execute import execute


def evaluate(payload):
    source = payload['input']
    rows = [{ROW_ID: f'synthetic:{i}', **row} for i, row in enumerate(source['rows'])]
    expected = [dict(row) for row in rows]
    skill = payload['skill_id']
    if skill == 'data-cleaning':
        for row in expected:
            if row['income'] is None:
                row['income'] = -1
    elif skill == 'feature-engineering':
        for row in expected:
            row['income_ratio'] = (None if row['income'] is None or row['denominator'] == 0
                                   else row['income'] / row['denominator'])
    failures = []
    executed = 0
    checked = 0
    with tempfile.TemporaryDirectory(prefix='skill-plan-') as directory:
        root = Path(directory)
        path = root / 'input.parquet'
        pl.DataFrame(rows).write_parquet(path)
        original_digest = sha_file(path)
        original = dict(kind='DatasetRef', path=str(path), digest=original_digest,
                        metadata=dict(roles=source['roles'], source='synthetic'))
        outputs = {}
        nodes = {node['id']: node for node in payload['workflow']['nodes']}
        for index, node_id in enumerate(payload['order']):
            node = nodes[node_id]
            inputs = {}
            for port, ref in node['inputs'].items():
                if 'artifact_id' in ref:
                    if ref != source['dataset']:
                        raise ValueError('ARTIFACT_VERSION_MISMATCH')
                    inputs[port] = original
                else:
                    inputs[port] = outputs[ref['node_id']][ref['output_port']]
            target = root / str(index)
            manifest = execute(dict(spec=node, inputs=inputs, seed=payload['workflow']['seed'],
                                    object_prefix=str(index), max_columns=100), target)
            outputs[node_id] = {}
            executed += 1
            for port, artifact in manifest['outputs'].items():
                output_path = root / artifact['object_key']
                if sha_file(output_path) != artifact['digest']:
                    failures.append('OUTPUT_CHECKSUM')
                outputs[node_id][port] = {**artifact, 'path': str(output_path)}
                if artifact['kind'] == 'DatasetRef':
                    actual = pl.read_parquet(output_path).to_dicts()
                    # Compare every column, row identity, label and unchanged value independently.
                    if actual != expected:
                        failures.append('EXECUTED_DATA_MISMATCH')
                    checked += 1
                elif node['operator'] == 'inspect':
                    report = json.loads(output_path.read_text())
                    input_rows = pl.read_parquet(inputs['data']['path']).to_dicts()
                    if (report['scope'] != 'full_exact' or report['rows'] != len(input_rows)
                            or report['fields']['income']['nulls'] != sum(r['income'] is None for r in input_rows)):
                        failures.append('EXECUTED_STATISTICS_MISMATCH')
                    checked += 1
        if sha_file(path) != original_digest:
            failures.append('INPUT_MUTATION')
        if not checked:
            failures.append('NO_VERIFIED_OUTPUT')
    return dict(passed=not failures, metrics=dict(executed_nodes=executed, checked_outputs=checked,
                                                rows=len(rows), execution_failures=len(set(failures))),
                blocking_failures=sorted(set(failures)))


if __name__ == '__main__':
    print(json.dumps(evaluate(json.load(sys.stdin)), allow_nan=False))
