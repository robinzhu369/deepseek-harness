"""Compute inside bounded tmpfs; retain it until the supervisor copies verified results."""
import json
import math
import signal
import sys
from pathlib import Path
from execute import execute

try:
    request = json.loads(sys.stdin.readline())
    signal.alarm(math.ceil(request['execution_seconds']+request['transfer_seconds']))
    request['output_path'] = '/output/result'
    result = execute(request, Path(request['output_path']))
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
    # The supervisor streams tmpfs files while this process is alive. No credentials enter here.
    if sys.stdin.readline().strip() != 'release':
        sys.exit(2)
except Exception:
    print('{"error":"COMPUTE_FAILED"}', file=sys.stderr, flush=True)
    sys.exit(2)
