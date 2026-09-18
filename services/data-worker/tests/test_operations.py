import json
from decimal import Decimal
import polars as pl
import pytest
from engine import Dataset, DataError, ROW_ID, import_table, identity, sha_file, fit, transform, split
from importer import ImportApproval
from operators import apply_operation


def sample():
    return Dataset(pl.DataFrame({ROW_ID:['s:0','s:1','s:2','s:3'],'id':['a','a','b','c'],'value':[1.,None,10.,-2.],
        'denominator':[0.,2.,5.,1.],'category':[' A ',' A ','b',None],'target':[1,0,1,0]}),
        {'id':'entity_id','value':'feature','denominator':'feature','category':'feature','target':'target'},'s')


def test_fill_protects_target_and_does_not_change_legal_zero():
    source=sample();result,_=apply_operation(source,'fill_constant',{'columns':['value'],'value':0})
    assert result.frame['value'].to_list()==[1,0,10,-2]
    assert source.frame['value'].null_count()==1
    with pytest.raises(DataError,match='PROTECTED_FIELD'):apply_operation(source,'fill_constant',{'columns':['target'],'value':0})
    with pytest.raises(DataError,match='CONSTANT_TYPE'):apply_operation(source,'fill_constant',{'columns':['category'],'value':0})


def test_mapping_is_simultaneous_and_null_is_preserved():
    normalized,_=apply_operation(sample(),'normalize',{'columns':['category'],'trim':True,'case':'lower'})
    result,_=apply_operation(normalized,'map_categories',{'column':'category','mapping':{'a':'b','b':'c'},'unmatched':'preserve','unknown_value':'?'})
    assert result.frame['category'].to_list()==['b','b','c',None]
    assert len(result.operations)==2


def test_deduplicate_is_stable_under_input_shuffle_and_records_real_impact():
    source=sample();params={'keys':['id'],'order_by':['value'],'descending':True,'keep':'first'}
    first,report=apply_operation(source,'deduplicate',params)
    second,_=apply_operation(source.derive(source.frame.reverse()),'deduplicate',params)
    assert first.frame[ROW_ID].to_list()==second.frame[ROW_ID].to_list()
    assert first.frame[ROW_ID].to_list()==['s:2','s:0','s:3']
    assert report['removed_rows']==1 and report['removed_fraction']==.25
    assert report['removed_row_ids_digest']==identity(['s:1'])
    with pytest.raises(DataError,match='SAMPLE_CHANGE_AFTER_SPLIT'):apply_operation(source.derive(source.frame,partition='test'),'deduplicate',params)


def test_filters_are_restricted_expressions_with_explicit_null_semantics():
    result,report=apply_operation(sample(),'filter_rows',{'condition':{'column':'value','comparison':'gte','value':1},'keep_null':True})
    assert result.frame[ROW_ID].to_list()==['s:0','s:1','s:2'] and report['removed_rows']==1
    with pytest.raises(DataError,match='FILTER_COMPARISON'):apply_operation(sample(),'filter_rows',{'condition':{'column':'value','comparison':'eval','value':'__import__("os")'},'keep_null':False})


def test_bounds_default_flag_and_derived_ratio_zero_policy():
    flagged,_=apply_operation(sample(),'bounds',{'column':'value','lower':0,'upper':5,'action':'flag','output':'异常'})
    assert flagged.frame['异常'].to_list()==[False,False,True,True]
    assert flagged.frame['value'].to_list()==sample().frame['value'].to_list()
    params={'left':'value','right':'denominator','output':'ratio','method':'divide','invalid':'null'}
    ratio,_=apply_operation(sample(),'derive',params)
    assert ratio.frame['ratio'].to_list()==[None,None,2.,-2.]
    with pytest.raises(DataError,match='DIVIDE_ZERO'):apply_operation(sample(),'derive',{**params,'invalid':'error'})
    with pytest.raises(DataError,match='FEATURE_COLLISION'):apply_operation(sample(),'derive',{**params,'output':'id'})


def test_bad_rows_require_exact_approval_and_stable_source_positions(tmp_path):
    path=tmp_path/'bad.csv';path.write_text('id,x\n001,1\n002,2,extra\n003,3\n')
    roles={'id':'record_id','x':'feature'};config={'format':'csv','bad_rows':'quarantine','types':{'x':'int64'}}
    quarantine=tmp_path/'quarantine.jsonl'
    with pytest.raises(DataError,match='IMPORT_APPROVAL_REQUIRED'):import_table(path,config,roles,10000,quarantine=quarantine)
    approval=ImportApproval(sha_file(path),identity(config),1)
    result=import_table(path,config,roles,10000,approval=approval,quarantine=quarantine)
    assert [value.split(':')[-1] for value in result.frame[ROW_ID]]==['0','2']
    bad=json.loads(quarantine.read_text());assert bad['row_id']==result.source+':1'
    assert result.import_report['quarantined_records']==1
    with pytest.raises(FileExistsError):import_table(path,config,roles,10000,approval=approval,quarantine=quarantine)
    with pytest.raises(DataError,match='IMPORT_APPROVAL_EXCEEDED'):import_table(path,config,roles,10000,approval=ImportApproval(sha_file(path),identity(config),0),quarantine=tmp_path/'other')
    with pytest.raises(DataError,match='IMPORT_APPROVAL_REQUIRED'):import_table(path,{**config,'null_values':['NA']},roles,10000,approval=approval,quarantine=tmp_path/'third')


def test_gb18030_headerless_import_and_explicit_decimal_rounding(tmp_path):
    path=tmp_path/'data.csv';path.write_bytes('001;中文;1.235\n002;北京;2.345\n'.encode('gb18030'))
    config={'format':'csv','encoding':'gb18030','delimiter':';','has_header':False,'columns':['id','城市','金额'],
            'types':{'金额':{'type':'decimal','precision':8,'scale':2,'rounding':'half_even'}}}
    roles={'id':'record_id','城市':'feature','金额':'feature'}
    result=import_table(path,config,roles,10000)
    assert result.frame['id'].to_list()==['001','002']
    assert result.frame['金额'].to_list()==[Decimal('1.24'),Decimal('2.34')]
    assert result.frame['城市'].to_list()==['中文','北京']


def test_boolean_and_decimal_overflow_are_explicit(tmp_path):
    path=tmp_path/'data.csv';path.write_text('flag,amount\ntrue,999.999\nfalse,1.000\n')
    config={'format':'csv','types':{'flag':'boolean','amount':{'type':'decimal','precision':4,'scale':2,'rounding':'half_up'}}}
    with pytest.raises(DataError,match='DECIMAL_OVERFLOW'):import_table(path,config,{'flag':'feature','amount':'feature'},10000)
    config['types']['amount']['precision']=6
    result=import_table(path,config,{'flag':'feature','amount':'feature'},10000)
    assert result.frame['flag'].to_list()==[True,False]


def test_mode_fit_tie_break_is_deterministic():
    source=sample().derive(sample().frame,partition='train',split_digest='split')
    state=fit(source,'mode',['category'],10,'ignore')
    assert state['params']['category']['fill']==' A '
    result=transform(source,state)
    assert result.frame['category'].null_count()==0


def test_stratified_split_has_exact_per_label_counts_and_rejects_rare_strata():
    frame=pl.DataFrame({ROW_ID:[str(i) for i in range(100)],'target':[i%2 for i in range(100)],'x':list(range(100))})
    data=Dataset(frame,{'target':'target','x':'feature'},'s')
    parts,_=split(data,method='stratified',column='target',train_fraction=.6,validation_fraction=.2,seed=42)
    assert [p.frame.height for p in parts.values()]==[60,20,20]
    for part in parts.values(): assert part.frame['target'].sum()==part.frame.height//2
    again,_=split(data.derive(frame.reverse()),method='stratified',column='target',train_fraction=.6,validation_fraction=.2,seed=42)
    assert parts['train'].frame[ROW_ID].to_list()==again['train'].frame[ROW_ID].to_list()
    with pytest.raises(DataError,match='STRATUM_TOO_SMALL'):split(data.derive(frame.head(4)),method='stratified',column='target',train_fraction=.6,validation_fraction=.2,seed=42)


def test_train_quantile_clipping_does_not_refit_test_extremes():
    source=sample().derive(sample().frame,partition='train',split_digest='split')
    state=fit(source,'quantile_clip',['value'],10,'ignore',lower_quantile=.1,upper_quantile=.9)
    test=source.derive(source.frame.with_columns(pl.lit(99999.).alias('value')),partition='test')
    assert transform(test,state).frame['value'].max()==state['params']['value']['upper']
    with pytest.raises(DataError,match='FIT_SCOPE'):fit(test,'quantile_clip',['value'],10,'ignore',lower_quantile=.1,upper_quantile=.9)


def test_event_time_features_use_a_recorded_reference_date():
    frame=pl.DataFrame({ROW_ID:['a','b'],'date':['2024-01-01','2024-01-03']})
    source=Dataset(frame,{'date':'event_time'},'s')
    result,_=apply_operation(source,'derive',{'left':'date','output':'elapsed','method':'days_since','reference_date':'2024-01-01'})
    assert result.frame['elapsed'].to_list()==[0,2]
    assert result.operations[0]['params']['reference_date']=='2024-01-01'


def test_preview_limits_rows_and_preserves_column_selection(tmp_path):
    from execute import execute
    from engine import sha_file
    import polars as pl
    data=tmp_path/'input.parquet'
    pl.DataFrame({'__row_id':['a','b','c'],'id':['001','002','003'],'income':[1,2,3]}).write_parquet(data)
    result=execute({'spec':{'operator':'preview','operator_version':'1','params':{'offset':1,'limit':1,'columns':['id']}},'inputs':{'data':{'kind':'DatasetRef','path':str(data),'digest':sha_file(data),'metadata':{'roles':{'id':'record_id','income':'feature'},'source':'s'}}},'object_prefix':'p/r/j/1','max_columns':10},tmp_path/'out')
    import json
    report=json.loads((tmp_path/'out/report.json').read_text())
    assert report=={'offset':1,'total':3,'columns':['id'],'rows':[{'id':'002'}]}
    assert result['outputs']['report']['kind']=='ReportRef'


def test_csv_empty_fields_follow_explicit_null_policy_before_numeric_conversion(tmp_path):
    path=tmp_path/'empty.csv'
    path.write_text('id,income,target\n00001,,1\n00002,0,0\n00003,-2,1\n')
    roles={'id':'entity_id','income':'feature','target':'target'}
    options={'format':'csv','encoding':'utf-8','delimiter':',','has_header':True}
    preserved=import_table(path,options,roles,10000)
    assert preserved.frame['income'].to_list()==['','0','-2']
    declared=import_table(path,{**options,'null_values':[''],'types':{'income':'float64','target':'int64'}},roles,10000)
    assert declared.frame['income'].to_list()==[None,0.,-2.]
    assert declared.frame['id'].to_list()==['00001','00002','00003']
    assert declared.frame['target'].to_list()==[1,0,1]
    assert declared.source!=preserved.source


def test_replace_missing_and_numeric_cast_preserve_rows_and_protected_fields():
    source = Dataset(pl.DataFrame({ROW_ID:['s:0','s:1','s:2'], 'value':[' 12.5 ','0',None], 'category':['?', 'ok', None], 'target':['1','0','1']}), {'value':'feature','category':'feature','target':'target'}, 's')
    normalized,_ = apply_operation(source,'normalize',{'columns':['value'],'trim':True,'case':'preserve'})
    missing,_ = apply_operation(normalized,'replace_missing',{'columns':['category'],'tokens':['?']})
    converted,report = apply_operation(missing,'cast_numeric',{'columns':['value'],'dtype':'Float64'})
    assert converted.frame['value'].to_list()==[12.5,0.,None]
    assert converted.frame['category'].to_list()==[None,'ok',None]
    assert converted.frame[ROW_ID].to_list()==source.frame[ROW_ID].to_list()
    assert source.frame['category'].to_list()==['?','ok',None]
    assert report['removed_rows']==0
    for operator,params in [('replace_missing',{'columns':['target'],'tokens':['1']}),('cast_numeric',{'columns':['target'],'dtype':'Int64'})]:
        with pytest.raises(DataError,match='PROTECTED_FIELD'):apply_operation(source,operator,params)
    with pytest.raises(DataError,match='LOSSY_CAST'):apply_operation(converted,'cast_numeric',{'columns':['value'],'dtype':'Int64'})
    with pytest.raises(DataError,match='TYPE_CONVERSION'):apply_operation(source,'cast_numeric',{'columns':['category'],'dtype':'Float64'})
    bad = source.derive(source.frame.with_columns(pl.lit('inf').alias('value')))
    with pytest.raises(DataError,match='NON_FINITE'):apply_operation(bad,'cast_numeric',{'columns':['value'],'dtype':'Float64'})
