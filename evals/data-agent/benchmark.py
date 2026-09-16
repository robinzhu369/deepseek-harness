"""Compute-only capacity probe; does not satisfy the upload/Harness/UI AC-43 gate."""
import argparse
import json
import platform
import resource
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'services/data-worker'))
import polars as pl
from engine import import_table, inspect, split, fit, transform, export_bundle

parser=argparse.ArgumentParser()
parser.add_argument('--rows',type=int,required=True)
parser.add_argument('--report',type=Path,required=True)
args=parser.parse_args()
if args.rows<1000 or args.rows>1000000: raise ValueError('rows must be 1000..1000000')
started=time.monotonic();timings={}
def mark(name,start): timings[name]=round(time.monotonic()-start,3)
with tempfile.TemporaryDirectory(prefix='dsh-capacity-') as temp:
    root=Path(temp);start=time.monotonic()
    frame=pl.DataFrame({'i':pl.arange(0,args.rows,eager=True)})
    expressions=[pl.col('i').cast(pl.String).str.pad_start(12,'0').alias('entity_id'),(pl.col('i')%2).alias('target'),pl.lit('2024-01-01').alias('event_time')]
    expressions += [pl.when((pl.col('i')+j)%31==0).then(None).otherwise(((pl.col('i')*(j+1))%10007)/10).alias(f'x{j}') for j in range(70)]
    expressions += [(pl.lit('类别-')+(pl.col('i')%5).cast(pl.String)).alias(f'c{j}') for j in range(27)]
    frame=frame.select(expressions);assert frame.width==100
    path=root/'input.parquet';frame.write_parquet(path);input_bytes=path.stat().st_size
    del frame
    mark('generate',start);start=time.monotonic()
    roles={'entity_id':'entity_id','target':'target','event_time':'event_time',**{f'x{j}':'feature' for j in range(70)},**{f'c{j}':'feature' for j in range(27)}}
    dataset=import_table(path,{'format':'parquet'},roles,10*1024**3);mark('import',start)
    start=time.monotonic();report=inspect(dataset);assert report['rows']==args.rows;mark('inspect',start)
    start=time.monotonic();parts,mapping=split(dataset,method='entity',column='entity_id',train_fraction=.6,validation_fraction=.2,seed=42);mark('split',start)
    del mapping,dataset
    start=time.monotonic()
    for method,columns in [('median',[f'x{j}' for j in range(70)]),('standard',[f'x{j}' for j in range(70)]),('onehot',[f'c{j}' for j in range(27)])]:
        transformer=fit(parts['train'],method,columns,10,'ignore')
        parts={name:transform(part,transformer,max_columns=512) for name,part in parts.items()}
    mark('fit_transform',start);start=time.monotonic()
    features=[name for name,role in parts['train'].roles.items() if role=='feature']
    manifest=export_bundle(parts,root/'export',feature_columns=features,target='target',purpose='supervised',allow_null=False,recipe={'seed':42,'split':'entity','operators':['median','standard','onehot']})
    mark('quality_export',start)
    assert manifest['rows']==args.rows
    result={'scope':'compute_only_not_AC43','rows':args.rows,'input_columns':100,'output_columns':parts['train'].frame.width-1,'input_bytes':input_bytes,'output_bytes':sum(f['bytes'] for f in manifest['files'].values()),'status':manifest['status'],'polars_version':pl.__version__,'python':platform.python_version(),'platform':platform.platform(),'timings_seconds':timings,'total_seconds':round(time.monotonic()-started,3),'peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024),'evidence_limit':'No multipart upload, model, Harness session, UI, or offline installation exercised; generated temporary artifacts removed after checks.'}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
