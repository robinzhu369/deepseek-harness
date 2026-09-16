"""Explicit CSV decoding, parse provenance and approval-bound bad-record quarantine."""
from __future__ import annotations
import csv
import json
import shutil
import tempfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, ROUND_HALF_UP, ROUND_DOWN
from pathlib import Path
from zoneinfo import ZoneInfo
import polars as pl
from engine import Dataset, DataError, ROW_ID, TYPES, identity, sha_file


@dataclass(frozen=True)
class ImportApproval:
    """Trusted service supplies approval bound to source bytes and exact parse options."""
    file_digest: str
    parse_digest: str
    max_bad_rows: int


def convert_types(frame: pl.DataFrame, types: dict) -> pl.DataFrame:
    for name,spec in types.items():
        if name not in frame.columns: raise DataError('SCHEMA_TYPE')
        try:
            if isinstance(spec,str):
                if spec not in TYPES: raise DataError('SCHEMA_TYPE')
                if spec=='date': expr=pl.col(name).str.to_date(strict=True)
                elif spec=='boolean':
                    values=frame[name].drop_nulls()
                    if not values.is_in(['true','false']).all(): raise DataError('TYPE_CONVERSION',{'column':name})
                    expr=pl.when(pl.col(name).is_null()).then(None).otherwise(pl.col(name)=='true')
                else: expr=pl.col(name).cast(TYPES[spec],strict=True)
                frame=frame.with_columns(expr.alias(name))
            elif spec.get('type')=='decimal':
                precision,scale=spec['precision'],spec['scale']
                rounding={'half_even':ROUND_HALF_EVEN,'half_up':ROUND_HALF_UP,'down':ROUND_DOWN}.get(spec['rounding'])
                if not isinstance(precision,int) or not isinstance(scale,int) or not 0<=scale<=precision<=28 or rounding is None: raise DataError('DECIMAL_POLICY')
                quantum=Decimal(1).scaleb(-scale);values=[]
                for value in frame[name]:
                    if value is None: values.append(None);continue
                    exact=Decimal(value)
                    if not exact.is_finite(): raise DataError('NON_FINITE')
                    rounded=exact.quantize(quantum,rounding=rounding)
                    if abs(rounded)>=Decimal(10)**(precision-scale): raise DataError('DECIMAL_OVERFLOW')
                    values.append(rounded)
                frame=frame.with_columns(pl.Series(name,values,dtype=pl.Decimal(precision,scale)))
            elif spec.get('type')=='datetime':
                ZoneInfo(spec['timezone'])
                frame=frame.with_columns(pl.col(name).str.to_datetime(format=spec['format'],time_zone=spec['timezone'],strict=True).alias(name))
            else: raise DataError('SCHEMA_TYPE')
        except (pl.exceptions.PolarsError,InvalidOperation,KeyError,ValueError) as error:
            if isinstance(error,DataError): raise
            raise DataError('TYPE_CONVERSION',{'column':name}) from error
    return frame


def import_csv(path: Path, config: dict, roles: dict, max_bytes: int,
               approval: ImportApproval | None = None, quarantine: Path | None = None) -> Dataset:
    if path.stat().st_size>max_bytes: raise DataError('RESOURCE_LIMIT')
    file_digest=sha_file(path);parse_digest=identity(config)
    source=identity({'file':file_digest,'parse':config})
    encoding=config.get('encoding','utf-8-sig')
    if encoding not in {'utf-8','utf-8-sig','gb18030','utf-16','utf-16-le','utf-16-be'}: raise DataError('UNSUPPORTED_ENCODING')
    delimiter=config.get('delimiter',',')
    if not isinstance(delimiter,str) or len(delimiter.encode())!=1 or delimiter in {'\r','\n','"'}: raise DataError('CSV_DELIMITER')
    policy=config.get('bad_rows','error')
    if policy not in {'error','quarantine'}: raise DataError('BAD_ROW_POLICY')
    if policy=='quarantine':
        if approval is None or approval.file_digest!=file_digest or approval.parse_digest!=parse_digest or approval.max_bad_rows<0 or quarantine is None:
            raise DataError('IMPORT_APPROVAL_REQUIRED')
    count=0;bad_count=0;positions=[];examples=[]
    with tempfile.TemporaryDirectory(prefix='dsh-import-') as directory:
        cleaned=Path(directory)/'normalized.csv';rejected=Path(directory)/'rejected.jsonl'
        try:
            with path.open(encoding=encoding,newline='') as stream, cleaned.open('w',encoding='utf-8',newline='') as target, rejected.open('w',encoding='utf-8') as bad:
                reader=csv.reader(stream,delimiter=delimiter,strict=True)
                has_header=config.get('has_header',True)
                header=next(reader) if has_header else config.get('columns')
                if not isinstance(header,list) or not header or any(not isinstance(name,str) or not name for name in header) or len(set(header))!=len(header): raise DataError('DUPLICATE_OR_EMPTY_HEADER')
                if set(header)&{ROW_ID,'__position','__partition'}: raise DataError('RESERVED_COLUMN')
                writer=csv.writer(target);writer.writerow(header)
                for position,row in enumerate(reader):
                    count+=1
                    if len(row)!=len(header):
                        bad_count+=1
                        record={'row_id':source+':'+str(position),'record_index':position,'end_line':reader.line_num,'reason':'field_count','values':row}
                        if len(examples)<100:examples.append({'record_index':position,'end_line':reader.line_num,'reason':'field_count'})
                        bad.write(json.dumps(record,ensure_ascii=False)+'\n')
                    else:
                        writer.writerow(row);positions.append(position)
        except (csv.Error,UnicodeError,StopIteration) as error:
            raise DataError('CSV_PARSE') from error
        if policy=='error' and bad_count: raise DataError('BAD_ROWS',{'count':bad_count,'examples':examples})
        if policy=='quarantine' and bad_count>approval.max_bad_rows: raise DataError('IMPORT_APPROVAL_EXCEEDED',{'count':bad_count})
        if not positions: raise DataError('EMPTY_DATASET')
        frame=pl.read_csv(cleaned,infer_schema_length=0,null_values=config.get('null_values',[]),missing_utf8_is_empty_string='' not in config.get('null_values',[]))
        frame=convert_types(frame,config.get('types',{}))
        frame=frame.with_columns(pl.Series(ROW_ID,[source+':'+str(position) for position in positions]))
        report={'source_file_digest':file_digest,'parse_digest':parse_digest,'parse_config':config,'input_records':count,'accepted_records':len(positions),'quarantined_records':bad_count,'scope':'full_exact'}
        if policy=='quarantine': report['quarantine_digest']=sha_file(rejected)
        dataset=Dataset(frame,roles,source,import_report=report)
        if policy=='quarantine':
            # Exclusive create preserves existing versions and never replaces an existing file.
            with quarantine.open('xb') as target,rejected.open('rb') as content: shutil.copyfileobj(content,target)
        return dataset
