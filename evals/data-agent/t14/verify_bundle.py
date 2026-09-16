"""Full-row training export reconciliation against synthetic generation rules and train-only statistics."""
import argparse
import hashlib
import io
import json
import zipfile
import polars as pl


def check(bundle, config):
    with zipfile.ZipFile(bundle) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        assert manifest['status']=='ready_for_training_contract' and manifest['rows']==config['rows']
        for name, entry in manifest['files'].items():
            assert hashlib.sha256(archive.read(name)).hexdigest()==entry['sha256']
        states=json.loads(archive.read('transformers.json'))
        recipe=json.loads(archive.read('recipe.json'))
        assert recipe['plan']['business_task_id']
        frames={name:pl.read_parquet(io.BytesIO(archive.read(name+'.parquet'))) for name in ['train','validation','test']}
        indexes={name:frame['__row_id'].str.split(':').list.last().cast(pl.Int64) for name,frame in frames.items()}
        all_ids=pl.concat(list(indexes.values())).sort()
        assert all_ids.to_list()==list(range(config['rows']))
        entities={name:set(frame['entity_id']) for name,frame in frames.items()}
        assert not entities['train']&entities['test'] and not entities['train']&entities['validation'] and not entities['test']&entities['validation']
        def raw(index,j):
            return pl.DataFrame({'i':index}).select(pl.when((pl.col('i')+j)%config['null_modulus']==0).then(None)
                .when((pl.col('i')+j)%config['dirty_modulus']==0).then(-999.)
                .otherwise(((pl.col('i')*(j+1))%10007)/10).alias('x'))['x']
        expected_width=3+config['numeric_columns']+config['category_columns']*config['category_cardinality']
        for name,frame in frames.items():
            idx=indexes[name]
            assert frame.width-1==expected_width
            assert frame['entity_id'].equals((idx//2).cast(pl.String).str.pad_start(12,'0').rename('entity_id'))
            assert frame['target'].equals((idx%2).rename('target'))
            for j in range(config['numeric_columns']):
                train=raw(indexes['train'],j);values=raw(idx,j)
                if j==0:train=train.clip(0,1001);values=values.clip(0,1001)
                median=train.median();filled=train.fill_null(median)
                offset,scale=filled.mean(),filled.std(ddof=0) or 1.
                expected=(values.fill_null(median)-offset)/scale
                actual=frame[f'x{j}']
                assert actual.null_count()==0 and actual.is_finite().all()
                assert ((actual-expected).abs()<1e-9).all(), (name,j)
            for j in range(config['category_columns']):
                for k in range(config['category_cardinality']):
                    assert frame[f'c{j}__category_{k}'].cast(pl.Int64).equals((((idx+j)%config['category_cardinality'])==k).cast(pl.Int64).rename(f'c{j}__category_{k}'))
        assert len(states)==3
        return {'status':manifest['status'],'rows_reconciled':config['rows'],'input_columns':config['columns'],
                'output_columns':expected_width,'all_files_sha256_verified':True,'labels_and_entity_ids_preserved':True,
                'entity_partitions_disjoint':True,'train_only_statistics_recomputed':True,'all_feature_values_checked':True,
                'partition_rows':{name:frame.height for name,frame in frames.items()},'transformer_count':len(states)}


if __name__=='__main__':
    from pathlib import Path
    parser=argparse.ArgumentParser();parser.add_argument('--bundle',required=True);parser.add_argument('--config',type=Path,required=True)
    args=parser.parse_args();print(json.dumps(check(args.bundle,json.loads(args.config.read_text()))))
