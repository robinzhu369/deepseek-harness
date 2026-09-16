"""One-shot deterministic attempt executor; its parent owns authentication and leases."""
from __future__ import annotations
import json
import sys
import io
import tempfile
import zipfile
from pathlib import Path
import polars as pl
from jsonschema import Draft202012Validator, ValidationError
from operators import apply_operation
from engine import Dataset, DataError, inspect, split, fit, transform, select, quality, sha_file, import_table, export_bundle


def execute(request: dict, output: Path) -> dict:
    spec = request['spec']
    registry = json.loads((Path(__file__).resolve().parents[2]/'domain-contracts/operators.json').read_text())
    if spec['operator'] not in registry: raise DataError('UNSUPPORTED_OPERATOR')
    definition = registry[spec['operator']]
    Draft202012Validator(definition['params']).validate(spec['params'])
    if set(request['inputs']) != set(definition['inputs']): raise DataError('INPUT_PORTS')
    for port, value in request['inputs'].items():
        if value['kind'] != definition['inputs'][port]: raise DataError('INPUT_TYPE')
    inputs = {}
    for port, artifact in request['inputs'].items():
        path = Path(artifact['path'])
        if sha_file(path) != artifact['digest']: raise DataError('INPUT_CHECKSUM')
        if artifact['kind'] == 'RawFileRef':
            inputs[port] = path
        elif artifact['kind'] == 'DatasetRef':
            meta = artifact['metadata']
            inputs[port] = Dataset(pl.read_parquet(path), meta['roles'], meta['source'], meta.get('partition'), meta.get('transformers', []), meta.get('preview',False),meta.get('split_digest'),meta.get('operations',[]),meta.get('import_report',{}))
        else:
            inputs[port] = json.loads(path.read_text())
    if spec['operator_version'] != '1': raise DataError('OPERATOR_VERSION')
    output.mkdir(parents=True, exist_ok=False)
    operator, params = spec['operator'], spec['params']
    removed_fraction = 0
    if operator == 'import':
        dataset=import_table(inputs['file'],params['options'],params['roles'],params['max_bytes'])
        results={'data':('DatasetRef',dataset),'report':('ReportRef',{'schema':{k:str(v) for k,v in dataset.frame.schema.items()},'rows':dataset.frame.height,'import':dataset.import_report})}
    elif operator == 'preview':
        dataset=inputs['data']; frame=dataset.frame.select(params['columns']).slice(params['offset'],params['limit'])
        results={'report':('ReportRef',{'offset':params['offset'],'total':dataset.frame.height,'columns':frame.columns,'rows':frame.to_dicts()})}
    elif operator in {'fill_constant','normalize','map_categories','deduplicate','filter_rows','bounds','derive'}:
        dataset,report=apply_operation(inputs['data'],operator,params)
        if dataset.frame.width > request['max_columns']: raise DataError('DIMENSION_LIMIT')
        removed_fraction=report['removed_fraction']
        results={'data':('DatasetRef',dataset),'report':('ReportRef',report)}
        if 'removed' in definition['outputs']:
            removed=inputs['data'].frame.join(dataset.frame.select('__row_id'),on='__row_id',how='anti').select('__row_id')
            results['removed']=('SplitMapRef',removed.with_columns(pl.lit(operator).alias('reason')))
    elif operator == 'inspect': results={'report':('ReportRef', inspect(inputs['data']))}
    elif operator == 'split':
        partitions, mapping = split(inputs['data'],seed=request['seed'],**params)
        results={name:('DatasetRef',dataset) for name,dataset in partitions.items()}
        results['mapping']=('SplitMapRef',mapping)
    elif operator == 'fit': results={'transformer':('TransformerRef',fit(inputs['train'],**params))}
    elif operator == 'transform': results={'data':('DatasetRef',transform(inputs['data'],inputs['transformer'],request['max_columns']))}
    elif operator == 'select':
        dataset, report=select(inputs['data'],**params)
        results={'data':('DatasetRef',dataset),'report':('ReportRef',report)}
    elif operator == 'export':
        recipe=request.get('recipe')
        if not isinstance(recipe,dict) or not recipe.get('semantic_digest'): raise DataError('FROZEN_RECIPE_REQUIRED')
        with tempfile.TemporaryDirectory(dir=output) as directory:
            bundle=Path(directory)/'bundle'
            report=export_bundle(inputs,bundle,recipe=recipe,target=params.get('target'),**{k:v for k,v in params.items() if k!='target'})
            buffer=io.BytesIO()
            with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                for file in sorted(bundle.iterdir()):
                    entry=zipfile.ZipInfo(file.name,date_time=(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
                    archive.writestr(entry,file.read_bytes())
            results={'bundle':('ExportRef',buffer.getvalue()),'report':('ReportRef',report)}
    elif operator == 'quality': results={'report':('ReportRef',quality(inputs['data'],**params))}
    else: raise DataError('UNSUPPORTED_OPERATOR')
    outputs={}
    for port,(kind,value) in results.items():
        metadata={}
        path=output / (port + ('.parquet' if isinstance(value,(Dataset,pl.DataFrame)) else '.zip' if isinstance(value,bytes) else '.json'))
        if isinstance(value,Dataset):
            value.frame.write_parquet(path)
            metadata=dict(schema={k:str(v) for k,v in value.frame.schema.items()},roles=value.roles,source=value.source,partition=value.partition,transformers=value.transformers,preview=value.preview,rows=value.frame.height,split_digest=value.split_digest,operations=value.operations,import_report=value.import_report)
        elif isinstance(value,bytes):
            path.write_bytes(value)
            metadata={'status':'ready_for_training_contract','recipe_digest':recipe['semantic_digest']}
        elif isinstance(value,pl.DataFrame): value.write_parquet(path)
        else: path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,default=str)+'\n')
        outputs[port]={'kind':kind,'object_key':request['object_prefix']+'/'+path.name,'digest':sha_file(path),'bytes':path.stat().st_size,'metadata':metadata}
    return {'outputs':outputs,'impact':{'removed_fraction':removed_fraction}}


if __name__ == '__main__':
    try:
        request=json.load(sys.stdin)
        result=execute(request,Path(request['output_path']))
        print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    except ValidationError:
        print(json.dumps({'error':'INVALID_PARAMETERS'}),file=sys.stderr)
        sys.exit(2)
    except pl.exceptions.PolarsError:
        print(json.dumps({'error':'DATA_OPERATION_FAILED'}),file=sys.stderr)
        sys.exit(2)
    except DataError as error:
        print(json.dumps({'error':error.code}),file=sys.stderr)
        sys.exit(2)
