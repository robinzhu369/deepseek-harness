import json
from pathlib import Path
import polars as pl
import pytest
from engine import Dataset, DataError, ROW_ID, import_table, inspect, split, fit, transform, quality, export_bundle, select


def data(n=500):
    return Dataset(pl.DataFrame({ROW_ID:[f'source:{i}' for i in range(n)],'id':[f'{i//3:05}' for i in range(n)],
        'income':[None if i%7==0 else float(i%50) for i in range(n)],
        'kind':['a' if i%2==0 else 'b' for i in range(n)],'target':[i%2 for i in range(n)]}),
        {'id':'entity_id','income':'feature','kind':'feature','target':'target'},'source')


def test_csv_preserves_identifiers_empty_values_and_strict_conversion(tmp_path):
    path=tmp_path/'data.csv'
    path.write_text('id,income,kind,target\n001,3.5,,1\n9007199254740993,NA,中文,0\n')
    roles={'id':'entity_id','income':'feature','kind':'feature','target':'target'}
    config={'format':'csv','null_values':['NA'],'types':{'income':'float64','target':'int64'}}
    first=import_table(path,config,roles,10000)
    assert first.frame['id'].to_list()==['001','9007199254740993']
    assert first.frame['kind'].to_list()==['','中文']
    assert first.frame['income'].null_count()==1
    assert first.frame[ROW_ID].to_list()==import_table(path,config,roles,10000).frame[ROW_ID].to_list()
    changed=import_table(path,{'format':'csv'},roles,10000)
    assert first.source != changed.source
    path.write_text('id,income,kind,target\n001,3.5,a,1\n002,dirty,b,0\n')
    with pytest.raises(DataError,match='TYPE_CONVERSION'): import_table(path,config,roles,10000)


@pytest.mark.parametrize('content',['id,income\n1,2,3\n','id,income\n1\n','id,id\n1,2\n'])
def test_bad_rows_and_duplicate_headers_never_silently_import(tmp_path,content):
    path=tmp_path/'bad.csv';path.write_text(content)
    with pytest.raises(DataError): import_table(path,{'format':'csv'},{'id':'entity_id','income':'feature'},10000)


def test_entity_split_keeps_entities_disjoint_and_row_ids_stable():
    source=data();parts,mapping=split(source,method='entity',column='id',train_fraction=.6,validation_fraction=.2,seed=42)
    sets=[set(part.frame['id']) for part in parts.values()]
    assert not sets[0]&sets[1] and not sets[0]&sets[2] and not sets[1]&sets[2]
    assert set(mapping[ROW_ID])==set(source.frame[ROW_ID])
    assert sum(p.frame.height for p in parts.values())==source.frame.height


def test_time_split_fixed_boundaries():
    d=Dataset(pl.DataFrame({ROW_ID:['a','b','c','d'],'day':['2024-01-01','2024-02-01','2024-03-01','2024-03-02'],'x':[1.,2.,3.,4.]}),{'day':'event_time','x':'feature'},'s')
    parts,_=split(d,method='time',column='day',boundaries=['2024-02-01','2024-03-01'],train_fraction=.6,validation_fraction=.2,seed=1)
    assert parts['train'].frame.height==1 and parts['validation'].frame.height==1 and parts['test'].frame.height==2


def test_test_extreme_values_do_not_change_fitted_parameters():
    parts,_=split(data(),method='random',train_fraction=.6,validation_fraction=.2,seed=42)
    original=fit(parts['train'],'median',['income'],10,'ignore')
    parts['test']=parts['test'].derive(parts['test'].frame.with_columns(pl.lit(1e20).alias('income')))
    assert fit(parts['train'],'median',['income'],10,'ignore')==original
    with pytest.raises(DataError,match='FIT_SCOPE'):fit(parts['test'],'median',['income'],10,'ignore')
    with pytest.raises(DataError,match='PROTECTED_FIELD'):fit(parts['train'],'mean',['target'],10,'ignore')


def test_unknown_categories_fixed_width_and_preview_separation():
    parts,_=split(data(),method='random',train_fraction=.6,validation_fraction=.2,seed=42)
    encoder=fit(parts['train'],'onehot',['kind'],10,'ignore')
    changed=parts['test'].derive(parts['test'].frame.with_columns(pl.lit('new').alias('kind')))
    result=transform(changed,encoder)
    assert result.frame['kind__category_0'].sum()==0 and result.frame['kind__category_1'].sum()==0
    encoder['unknown']='error'
    with pytest.raises(DataError,match='UNKNOWN_CATEGORY'):transform(changed,encoder)
    encoder['unknown']='ignore';encoder['preview']=True
    with pytest.raises(DataError,match='PREVIEW_TRANSFORMER'):transform(changed,encoder)
    with pytest.raises(DataError,match='DIMENSION_LIMIT'):fit(parts['train'],'onehot',['kind'],1,'ignore')


def test_complete_fit_chain_export_reread_and_label_alignment(tmp_path):
    source=data();parts,_=split(source,method='entity',column='id',train_fraction=.6,validation_fraction=.2,seed=42)
    for method,columns in [('median',['income']),('standard',['income']),('onehot',['kind'])]:
        state=fit(parts['train'],method,columns,10,'ignore')
        parts={name:transform(part,state) for name,part in parts.items()}
    features=[name for name,role in parts['train'].roles.items() if role=='feature']
    manifest=export_bundle(parts,tmp_path/'export',feature_columns=features,target='target',purpose='supervised',allow_null=False,recipe={'seed':42})
    assert manifest['rows']==500 and manifest['status']=='ready_for_training_contract'
    reloaded=pl.concat([pl.read_parquet(tmp_path/'export'/f'{name}.parquet') for name in parts])
    aligned=reloaded.join(source.frame.select(ROW_ID,pl.col('target').alias('original')),on=ROW_ID)
    assert (aligned['target']==aligned['original']).all()
    assert reloaded['income'].null_count()==0
    assert len(json.loads((tmp_path/'export'/'transformers.json').read_text()))==3


def test_quality_failure_blocks_export_and_protected_fields_cannot_drop(tmp_path):
    source=data()
    assert quality(source,['income'],'supervised',False,'target')['status']=='blocked'
    with pytest.raises(DataError,match='PROTECTED_FIELD'):select(source,['income'])
    parts,_=split(source,method='random',train_fraction=.6,validation_fraction=.2,seed=42)
    with pytest.raises(DataError,match='QUALITY_GATE'):export_bundle(parts,tmp_path/'bad',feature_columns=['income'],target='target',purpose='supervised',allow_null=False,recipe={})
    assert not (tmp_path/'bad').exists()
    assert inspect(source)['fields']['income']['nulls']==72


def test_transformers_cannot_cross_split_versions():
    first,_=split(data(),method='random',train_fraction=.6,validation_fraction=.2,seed=42)
    other,_=split(data(),method='random',train_fraction=.6,validation_fraction=.2,seed=43)
    state=fit(first['train'],'median',['income'],10,'ignore')
    with pytest.raises(DataError,match='SPLIT_MISMATCH'):transform(other['test'],state)


def test_export_rejects_swapped_partition_labels(tmp_path):
    parts,_=split(data(),method='random',train_fraction=.6,validation_fraction=.2,seed=42)
    parts['train'],parts['test']=parts['test'],parts['train']
    with pytest.raises(DataError,match='EXPORT_PARTITION'):
        export_bundle(parts,tmp_path/'swapped',feature_columns=['income'],target='target',purpose='supervised',allow_null=True,recipe={})
    assert not (tmp_path/'swapped').exists()
