"""Compute inside bounded tmpfs; retain it until the supervisor copies verified results."""
import errno
import json
import math
import signal
import sys
from pathlib import Path
from execute import execute
from engine import DataError
from failure_codes import FAILURE_CODES
from jsonschema import ValidationError

try:
    request = json.loads(sys.stdin.readline())
    signal.alarm(math.ceil(request['execution_seconds']+request['transfer_seconds']))
    request['output_path'] = '/output/result'
    result = execute(request, Path(request['output_path']))
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
    # The supervisor streams tmpfs files while this process is alive. No credentials enter here.
    if sys.stdin.readline().strip() != 'release':
        sys.exit(2)
except Exception as error:
    code = 'COMPUTE_FAILED'
    if isinstance(error, DataError) and error.code in FAILURE_CODES:
        code = error.code
    elif isinstance(error, ValidationError):
        code = 'INVALID_PARAMETERS'
    elif isinstance(error, MemoryError):
        code = 'MEMORY_LIMIT'
    elif isinstance(error, OSError) and error.errno in (errno.ENOSPC, errno.EDQUOT):
        code = 'DISK_LIMIT'
    print(json.dumps({'failure': {'code': code}}), flush=True)
    sys.exit(2)
