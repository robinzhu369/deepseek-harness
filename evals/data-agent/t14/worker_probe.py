"""Observe the real remote supervisor without modifying compute requests or sandbox limits."""
import argparse
import json
import os
import threading
import time
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'services/data-worker'))
import remote

# Fixed diagnostic code only; the compute container receives no supervisor credential.
SAMPLE = """import json,os
from pathlib import Path
r={}
for name in ['memory.peak','memory.current','memory.events','cpu.stat']:
 p=Path('/sys/fs/cgroup')/name
 if p.exists():r[name]=p.read_text()
for root in ['/tmp','/output']:
 total=0
 for d,_,files in os.walk(root):
  for f in files:
   try:total+=os.stat(os.path.join(d,f)).st_blocks*512
   except FileNotFoundError:pass
 r[root]=total
print(json.dumps(r))"""


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',type=Path,required=True);parser.add_argument('--report',type=Path,required=True);parser.add_argument('--sample-seconds',type=float,required=True)
    args=parser.parse_args();config=json.loads(args.config.read_text());metrics={'samples':[]};start=time.monotonic()
    class Observed(remote.DockerAttempt):
        def create(self, inputs):
            super().create(inputs);metrics['container']=self.name
        def run(self, request, check):
            metrics['operator']=request['spec']['operator'];metrics['node_id']=request['spec']['id']
            ended=threading.Event()
            def sample():
                while not ended.wait(args.sample_seconds):
                    result=self.command('exec',self.name,'python','-c',SAMPLE,check=False)
                    if result.returncode==0:
                        metrics['samples'].append({'elapsed_seconds':time.monotonic()-start,**json.loads(result.stdout)})
            thread=threading.Thread(target=sample);thread.start();began=time.monotonic()
            try:return super().run(request,check)
            finally:
                ended.set();thread.join();metrics['compute_seconds']=time.monotonic()-began
        def stop(self):
            if 'container' in metrics:
                sample=self.command('exec',self.name,'python','-c',SAMPLE,check=False)
                if sample.returncode==0:metrics['samples'].append({'elapsed_seconds':time.monotonic()-start,**json.loads(sample.stdout)})
                state=self.command('inspect',self.name,'--format','{{json .State}}',check=False)
                if state.returncode==0:metrics['docker_state']=json.loads(state.stdout)
            return super().stop()
    remote.DockerAttempt=Observed
    worker=remote.RemoteWorker(config)
    try:
        result=worker.once();metrics['result']=result
        print(json.dumps(result))
    except Exception as error:
        metrics['error']=str(error) if isinstance(error,remote.WorkerError) else type(error).__name__
        worker.recover()
        raise
    finally:
        metrics['wall_seconds']=time.monotonic()-start
        metrics['memory_peak_bytes']=max([int(s.get('memory.peak',0)) for s in metrics['samples']],default=0)
        metrics['observed_tmp_peak_bytes']=max([s['/tmp'] for s in metrics['samples']],default=0)
        metrics['observed_output_peak_bytes']=max([s['/output'] for s in metrics['samples']],default=0)
        args.report.write_text(json.dumps(metrics,indent=2)+'\n')


if __name__=='__main__':main()
