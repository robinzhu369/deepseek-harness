"""Versioned synthetic capacity inputs; no business data or model-generated code."""
import argparse
import hashlib
import json
import platform
import time
from pathlib import Path
import polars as pl


def generate(config, output):
    start = time.monotonic()
    count, numeric, categories = config['rows'], config['numeric_columns'], config['category_columns']
    frame = pl.DataFrame({'i': pl.arange(0, count, eager=True)})
    # Two observations per entity exercise entity-disjoint splitting.
    expressions = [(pl.col('i')//2).cast(pl.String).str.pad_start(12, '0').alias('entity_id'),
                   (pl.col('i') % 2).alias('target'),
                   (pl.date(2024, 1, 1) + pl.duration(days=pl.col('i') % 365)).alias('event_time')]
    for j in range(numeric):
        expressions.append(pl.when((pl.col('i')+j) % config['null_modulus'] == 0).then(None)
                           .when((pl.col('i')+j) % config['dirty_modulus'] == 0).then(-999.)
                           .otherwise(((pl.col('i')*(j+1)) % 10007)/10).alias(f'x{j}'))
    for j in range(categories):
        cardinality = config.get('stress_category_cardinality', config['category_cardinality']) if j == 0 else config['category_cardinality']
        byte_width = config.get('stress_category_utf8_bytes', config['category_utf8_bytes']) if j == 0 else config['category_utf8_bytes']
        width = byte_width - len('类别-'.encode())
        expressions.append((pl.lit('类别-') + ((pl.col('i')+j) % cardinality)
                            .cast(pl.String).str.pad_start(width, '0')).alias(f'c{j}'))
    frame = frame.select(expressions)
    assert frame.width == config['columns']
    frame.write_parquet(output)
    roles = {'entity_id':'entity_id','target':'target','event_time':'event_time',
             **{f'x{j}':'feature' for j in range(numeric)}, **{f'c{j}':'feature' for j in range(categories)}}
    facts = {'rows':count,'columns':frame.width,'bytes':output.stat().st_size,
             'sha256':hashlib.sha256(output.read_bytes()).hexdigest(), 'roles':roles,
             'nulls':{f'x{j}':frame[f'x{j}'].null_count() for j in range(numeric)},
             'dirty_values':{f'x{j}':int((frame[f'x{j}']==-999).sum()) for j in range(numeric)},
             'category_cardinality':frame['c0'].n_unique(),
             'category_utf8_bytes':frame['c0'].str.len_bytes().max(),
             'generation_seconds':time.monotonic()-start, 'python':platform.python_version(),
             'polars':pl.__version__, 'configuration':config}
    output.with_suffix('.json').write_text(json.dumps(facts,ensure_ascii=False,indent=2)+'\n')
    return facts


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--config',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();print(json.dumps(generate(json.loads(args.config.read_text()),args.output),ensure_ascii=False))
