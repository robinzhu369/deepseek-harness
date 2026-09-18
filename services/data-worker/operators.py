"""Stateless, allowlisted business operations; never evaluates user code."""
from __future__ import annotations
import math
from datetime import date
from typing import Any
import polars as pl
from engine import Dataset, DataError, ROW_ID, identity


def feature(dataset: Dataset, column: str):
    if dataset.roles.get(column) != 'feature':
        raise DataError('PROTECTED_FIELD', column)


def output_name(dataset: Dataset, name: str):
    if not name or name in dataset.frame.columns or name.startswith('__'):
        raise DataError('FEATURE_COLLISION', name)


def apply_operation(dataset: Dataset, operation: str, params: dict[str, Any]) -> tuple[Dataset, dict]:
    frame, roles = dataset.frame, dataset.roles.copy()
    report = {'scope':'full_exact','operation':operation,'input_rows':frame.height,'removed_rows':0}
    if operation == 'replace_missing':
        for name in params['columns']:
            feature(dataset, name)
            if frame.schema[name] != pl.String: raise DataError('STRING_TYPE')
            frame = frame.with_columns(pl.when(pl.col(name).is_in(params['tokens'])).then(None).otherwise(pl.col(name)).alias(name))
    elif operation == 'cast_numeric':
        dtype = {'Int64': pl.Int64, 'Float64': pl.Float64}[params['dtype']]
        for name in params['columns']:
            feature(dataset, name)
            source = frame[name]
            if source.dtype != pl.String and not source.dtype.is_numeric(): raise DataError('NUMERIC_TYPE')
            if source.dtype.is_float() and dtype == pl.Int64 and (source.drop_nulls() != source.drop_nulls().floor()).any(): raise DataError('LOSSY_CAST')
            try:
                converted = source.cast(dtype, strict=True)
            except (pl.exceptions.InvalidOperationError, pl.exceptions.ComputeError, pl.exceptions.SchemaError) as error:
                raise DataError('TYPE_CONVERSION') from error
            if dtype == pl.Float64 and converted.drop_nulls().is_finite().not_().any(): raise DataError('NON_FINITE')
            frame = frame.with_columns(converted.alias(name))
    elif operation == 'fill_constant':
        value = params['value']
        for name in params['columns']:
            feature(dataset,name)
            dtype = frame.schema[name]
            if value is None or (isinstance(value,float) and not math.isfinite(value)):
                raise DataError('INVALID_CONSTANT')
            if dtype == pl.String and not isinstance(value,str): raise DataError('CONSTANT_TYPE')
            if dtype == pl.Boolean and not isinstance(value,bool): raise DataError('CONSTANT_TYPE')
            if dtype.is_numeric() and (isinstance(value,bool) or not isinstance(value,(int,float))): raise DataError('CONSTANT_TYPE')
            if dtype.is_integer() and isinstance(value,float) and not value.is_integer(): raise DataError('LOSSY_CAST')
            literal = pl.lit(value).cast(dtype,strict=True)
            frame = frame.with_columns(pl.col(name).fill_null(literal))
    elif operation == 'normalize':
        for name in params['columns']:
            feature(dataset,name)
            if frame.schema[name] != pl.String: raise DataError('STRING_TYPE')
            expr = pl.col(name)
            if params['trim']: expr = expr.str.strip_chars()
            if params['case'] == 'lower': expr = expr.str.to_lowercase()
            elif params['case'] == 'upper': expr = expr.str.to_uppercase()
            frame = frame.with_columns(expr)
    elif operation == 'map_categories':
        name = params['column'];feature(dataset,name)
        if frame.schema[name] != pl.String: raise DataError('STRING_TYPE')
        expr = pl.col(name)
        if params['unmatched'] == 'unknown': expr = pl.when(expr.is_null()).then(None).otherwise(pl.lit(params['unknown_value']))
        # Nested expressions compare original values, so A→B and B→C cannot cascade.
        for old,new in reversed(list(params['mapping'].items())):
            expr = pl.when(pl.col(name) == old).then(pl.lit(new)).otherwise(expr)
        frame = frame.with_columns(expr.alias(name))
    elif operation == 'deduplicate':
        if dataset.partition is not None: raise DataError('SAMPLE_CHANGE_AFTER_SPLIT')
        keys=params['keys']
        if not keys or any(name not in roles for name in keys): raise DataError('INVALID_COLUMNS')
        order=params['order_by']
        if any(name not in roles for name in order): raise DataError('INVALID_COLUMNS')
        ordered=frame.sort([*order,ROW_ID],descending=[params['descending']]*len(order)+[False],nulls_last=True)
        frame=ordered.unique(subset=keys,keep=params['keep'],maintain_order=True)
    elif operation == 'filter_rows':
        if dataset.partition is not None: raise DataError('SAMPLE_CHANGE_AFTER_SPLIT')
        condition=params['condition'];name=condition['column']
        if name not in roles: raise DataError('INVALID_COLUMNS')
        column=pl.col(name);value=condition.get('value');comparison=condition['comparison']
        if comparison=='is_null': expr=column.is_null()
        elif comparison=='is_not_null': expr=column.is_not_null()
        elif comparison=='eq': expr=column==pl.lit(value)
        elif comparison=='ne': expr=column!=pl.lit(value)
        elif comparison=='gt': expr=column>pl.lit(value)
        elif comparison=='gte': expr=column>=pl.lit(value)
        elif comparison=='lt': expr=column<pl.lit(value)
        elif comparison=='lte': expr=column<=pl.lit(value)
        else: raise DataError('FILTER_COMPARISON')
        frame=frame.filter(expr.fill_null(params['keep_null']))
    elif operation == 'bounds':
        name=params['column'];feature(dataset,name)
        if not frame.schema[name].is_numeric(): raise DataError('NUMERIC_TYPE')
        lower,upper=params['lower'],params['upper']
        if lower>upper: raise DataError('INVALID_BOUNDS')
        if params['action']=='clip': frame=frame.with_columns(pl.col(name).clip(lower,upper))
        else:
            output=params['output'];output_name(dataset,output)
            frame=frame.with_columns(((pl.col(name)<lower)|(pl.col(name)>upper)).fill_null(False).alias(output))
            roles[output]='feature'
    elif operation == 'derive':
        output=params['output'];output_name(dataset,output)
        left=params['left'];method=params['method']
        if method in {'year','month','day','weekday','days_since'}:
            if dataset.roles.get(left) not in {'feature','event_time','prediction_time'}: raise DataError('PROTECTED_FIELD')
        else: feature(dataset,left)
        expr=pl.col(left)
        if method=='missing': expr=expr.is_null().cast(pl.UInt8)
        elif method in {'year','month','day','weekday','days_since'}:
            if frame.schema[left]==pl.String: expr=expr.str.to_date(strict=True)
            elif frame.schema[left]!=pl.Date: raise DataError('DATE_TYPE')
            if method=='days_since': expr=(expr-pl.lit(date.fromisoformat(params['reference_date']))).dt.total_days()
            else: expr=getattr(expr.dt,method)()
        else:
            if not frame.schema[left].is_numeric(): raise DataError('NUMERIC_TYPE')
            if method=='log1p':
                if frame.filter(pl.col(left)<=-1).height and params['invalid']=='error': raise DataError('LOG_DOMAIN')
                expr=pl.when(expr>-1).then(expr.log1p()).otherwise(None)
            else:
                right=params['right'];feature(dataset,right)
                if not frame.schema[right].is_numeric(): raise DataError('NUMERIC_TYPE')
                rhs=pl.col(right)
                if method=='add': expr=expr.cast(pl.Float64)+rhs
                elif method=='subtract': expr=expr.cast(pl.Float64)-rhs
                elif method=='multiply': expr=expr.cast(pl.Float64)*rhs
                elif method=='divide':
                    if frame.filter(rhs==0).height and params['invalid']=='error': raise DataError('DIVIDE_ZERO')
                    expr=pl.when(rhs!=0).then(expr.cast(pl.Float64)/rhs).otherwise(None)
                else: raise DataError('DERIVE_METHOD')
        frame=frame.with_columns(expr.alias(output));roles[output]='feature'
        if frame.schema[output].is_float() and frame[output].drop_nulls().is_finite().not_().any(): raise DataError('NON_FINITE')
    else:
        raise DataError('UNSUPPORTED_OPERATOR')
    removed=dataset.frame.join(frame.select(ROW_ID),on=ROW_ID,how='anti').select(ROW_ID)
    report.update(output_rows=frame.height,removed_rows=removed.height,
                  removed_fraction=removed.height/dataset.frame.height if dataset.frame.height else 0,
                  removed_row_ids_digest=identity(removed[ROW_ID].sort().to_list()))
    history=dataset.operations+[{'operator':operation,'params':params}]
    result=dataset.derive(frame,roles=roles,operations=history)
    return result,report
