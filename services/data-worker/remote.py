"""HTTP Worker supervisor. Docker owns compute isolation; this process owns credentials."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import http.client
import json
import os
import queue
import re
import shutil
import signal
import select
import ssl
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from failure_codes import FAILURE_CODES


class WorkerError(Exception):
    """Stable public error code, without driver output or credentials."""


class AttemptFailure(WorkerError):
    """Confirmed attempt failure; its stable code survives supervisor recovery."""
    def __init__(self, code):
        super().__init__(code if code in FAILURE_CODES else 'INVALID_WORKER_RESPONSE')


class Client:
    def __init__(self, config):
        self.config = config
        self.url = urlsplit(config['endpoint'])
        if self.url.username or self.url.password or self.url.query or self.url.fragment or self.url.path not in ('', '/'):
            raise WorkerError('ENDPOINT_CONFIG')
        if self.url.scheme != 'https' and not (self.url.scheme == 'http' and self.url.hostname in ('127.0.0.1', 'localhost', '::1')):
            raise WorkerError('TLS_REQUIRED')
        self.tls = ssl.create_default_context(cafile=config.get('ca_file'))

    def connection(self):
        cls = http.client.HTTPSConnection if self.url.scheme == 'https' else http.client.HTTPConnection
        extra = {'context': self.tls} if self.url.scheme == 'https' else {}
        return cls(self.url.hostname, self.url.port, timeout=self.config['http_timeout_seconds'], **extra)

    def request(self, route, token, body, headers=None, destination=None, check=lambda: None):
        connection = self.connection()
        try:
            head = {'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'}
            if headers: head.update(headers)
            payload = json.dumps(body).encode() if isinstance(body, dict) else body
            connection.request('POST', '/v1/worker/'+route, payload, head)
            response = connection.getresponse()
            if response.status != 200:
                # Consume only a bounded response; never echo server text or credentials.
                response.read(4096)
                raise WorkerError('STALE_ATTEMPT' if response.status == 409 else 'HTTP_REJECTED')
            if destination:
                size, digest = 0, hashlib.sha256()
                with destination.open('xb') as output:
                    while chunk := response.read(65536):
                        check();size += len(chunk)
                        if size > self.config['input_bytes']: raise AttemptFailure('INPUT_LIMIT')
                        digest.update(chunk);output.write(chunk)
                return size, digest.hexdigest()
            raw = response.read(self.config['manifest_bytes']+1)
            if len(raw) > self.config['manifest_bytes']: raise WorkerError('RESPONSE_LIMIT')
            return json.loads(raw)
        finally:
            connection.close()


class DockerAttempt:
    def __init__(self, config, name):
        if not re.fullmatch(r'data-agent-[a-f0-9]{32}',name): raise WorkerError('CONTAINER_NAME')
        self.config, self.name, self.process = config, name, None
        self.readers = []

    def command(self, *args, check=True):
        result = subprocess.run([self.config['docker'], *args], stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=self.config['docker_timeout_seconds'],
            env={'PATH': '/usr/bin:/bin', 'HOME': self.config['docker_home']})
        if check and result.returncode: raise WorkerError('DOCKER_'+args[0].upper()+'_FAILED')
        return result

    def create(self, inputs):
        c = self.config
        self.command('create', '--pull=never', '--name', self.name, '--label', 'data-agent.instance='+c['instance_id'],
            '-i', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--user=65532:65532', '--pids-limit='+str(c['pids']), '--memory='+str(c['memory_bytes']),
            '--memory-swap='+str(c['memory_bytes']), '--cpus='+str(c['cpus']),
            '--tmpfs', '/output:rw,noexec,nosuid,nodev,size='+str(c['output_bytes'])+',uid=65532,gid=65532,mode=0700',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size='+str(c['temporary_bytes'])+',uid=65532,gid=65532,mode=0700',
            '--mount', 'type=bind,src='+str(inputs)+',dst=/input,readonly',
            '--env', 'POLARS_MAX_THREADS='+str(c['polars_threads']), c['image'])

    def run(self, request, check):
        self.process = subprocess.Popen([self.config['docker'], 'start', '-ai', self.name],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={'PATH':'/usr/bin:/bin', 'HOME':self.config['docker_home']})
        messages, overflow = queue.Queue(), threading.Event()
        limit = self.config['manifest_bytes']
        def read_stdout():
            line = self.process.stdout.readline(limit+1)
            if len(line)>limit: overflow.set()
            else: messages.put(line)
        def read_stderr():
            size = 0
            while chunk := self.process.stderr.read(4096):
                size += len(chunk)
                if size>limit: overflow.set();return
        self.readers = [threading.Thread(target=read_stdout,daemon=True), threading.Thread(target=read_stderr,daemon=True)]
        for thread in self.readers: thread.start()
        self.process.stdin.write(json.dumps(request).encode()+b'\n');self.process.stdin.flush()
        deadline = time.monotonic()+self.config['execution_seconds']
        while True:
            check()
            if overflow.is_set(): raise AttemptFailure('OUTPUT_LIMIT')
            if time.monotonic()>deadline: raise AttemptFailure('EXECUTION_TIMEOUT')
            try:
                raw = messages.get(timeout=.05)
                if not raw:
                    state = self.command('inspect', '--format', '{{json .State}}', self.name, check=False)
                    if state.returncode == 0:
                        observed = json.loads(state.stdout)
                        if observed.get('OOMKilled') is True: raise AttemptFailure('MEMORY_LIMIT')
                        if observed.get('ExitCode') == 128 + signal.SIGALRM: raise AttemptFailure('EXECUTION_TIMEOUT')
                    raise AttemptFailure('COMPUTE_FAILED')
                try:
                    result = json.loads(raw)
                except (ValueError, UnicodeError):
                    raise AttemptFailure('INVALID_WORKER_RESPONSE') from None
                if not isinstance(result, dict): raise AttemptFailure('INVALID_WORKER_RESPONSE')
                if 'failure' in result:
                    failure = result['failure']
                    if set(result) != {'failure'} or not isinstance(failure, dict) or set(failure) != {'code'}:
                        raise AttemptFailure('INVALID_WORKER_RESPONSE')
                    code = failure['code']
                    raise AttemptFailure(code if isinstance(code, str) else 'INVALID_WORKER_RESPONSE')
                return result
            except queue.Empty:
                continue

    def copy(self, manifest, output, check):
        if sum(a['bytes'] for a in manifest['outputs'].values())>self.config['output_bytes']:
            raise AttemptFailure('OUTPUT_LIMIT')
        for artifact in manifest['outputs'].values():
            filename=artifact['object_key'].rsplit('/',1)[-1]
            if not re.fullmatch(r'[a-z_]+\.(json|parquet|zip)',filename): raise AttemptFailure('OUTPUT_PATH')
            process=subprocess.Popen([self.config['docker'],'exec',self.name,'cat','/output/result/'+filename],
                stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','HOME':self.config['docker_home']})
            size=0;deadline=time.monotonic()+self.config['docker_timeout_seconds']
            try:
                with (output/filename).open('xb') as file:
                    while True:
                        check()
                        if time.monotonic()>deadline: raise AttemptFailure('OUTPUT_TRANSFER_TIMEOUT')
                        if not select.select([process.stdout],[],[],.05)[0]: continue
                        chunk=os.read(process.stdout.fileno(),65536)
                        if not chunk: break
                        size+=len(chunk)
                        if size>artifact['bytes']: raise AttemptFailure('OUTPUT_SIZE')
                        file.write(chunk)
                if process.wait(timeout=self.config['docker_timeout_seconds']) or size!=artifact['bytes']:
                    raise AttemptFailure('OUTPUT_TRANSFER_FAILED')
            finally:
                if process.poll() is None: process.kill();process.wait()
                process.stdout.close()

    def stop(self):
        state = self.command('inspect', '--format', '{{.State.Running}}', self.name, check=False)
        if state.returncode:
            # Only a confirmed absent container allows cancellation acknowledgement.
            ids = self.command('ps', '-aq', '--filter', 'name=^/'+self.name+'$').stdout.strip()
            if ids: raise WorkerError('CONTAINER_STATE_UNKNOWN')
            self.finish_process();return
        if state.stdout.strip() == b'true': self.command('kill', self.name)
        self.command('wait', self.name)
        self.finish_process()
        self.command('rm', self.name)

    def finish_process(self):
        if self.process:
            try: self.process.wait(timeout=self.config['docker_timeout_seconds'])
            except subprocess.TimeoutExpired:
                self.process.kill();self.process.wait()
            for thread in self.readers: thread.join()
            for pipe in [self.process.stdin,self.process.stdout,self.process.stderr]: pipe.close()


def validate_config(config):
    required = ['http_timeout_seconds','docker_timeout_seconds','heartbeat_seconds','poll_seconds','execution_seconds',
        'input_bytes','output_bytes','temporary_bytes','manifest_bytes','memory_bytes','pids','cpus','polars_threads']
    for key in required:
        if isinstance(config[key],bool) or not isinstance(config[key],(int,float)) or config[key]<=0: raise WorkerError('WORKER_CONFIG')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',config['image']): raise WorkerError('IMAGE_DIGEST_REQUIRED')
    if not re.fullmatch(r'[a-z0-9-]{1,60}',config['instance_id']): raise WorkerError('INSTANCE_ID')
    for key in ['root','docker','docker_home']:
        if not Path(config[key]).is_absolute(): raise WorkerError('ABSOLUTE_PATH_REQUIRED')
    if config['output_bytes']+config['temporary_bytes']>=config['memory_bytes']: raise WorkerError('RESOURCE_BUDGET')
    return config


class RemoteWorker:
    def __init__(self, config, stop=None):
        self.config = validate_config(config)
        self.client = Client(config)
        self.stop = stop or threading.Event()
        self.root = Path(config['root'])
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.journal = self.root/'active.json'
        self.service_token = os.environ[config['credential_env']]

    def save(self, value):
        temporary=self.root/('journal-'+uuid.uuid4().hex)
        with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as file:
            json.dump(value,file);file.flush();os.fsync(file.fileno())
        os.replace(temporary,self.journal)

    def recover(self):
        if not self.journal.exists():
            self.cleanup();return
        value=json.loads(self.journal.read_text());result=None
        DockerAttempt(self.config,value['container']).stop()
        try:
            try:
                result=self.client.request('cancelled',value['token'],{})
            except WorkerError as error:
                if str(error) != 'STALE_ATTEMPT': raise
                if value.get('manifest'):
                    result=self.client.request('submit',value['token'],value['manifest'])
                else:
                    code=value.get('failure','WORKER_RESTARTED')
                    if code!='WORKER_RESTARTED' and code not in FAILURE_CODES: raise WorkerError('JOURNAL_CONFIG')
                    self.client.request('failure',value['token'],{'code':code})
                    result={'status':'failed','error':code}
        except WorkerError as error:
            if str(error) != 'STALE_ATTEMPT': raise
        self.journal.unlink();self.cleanup();return result

    def cleanup(self):
        for path in self.root.glob('attempt-*'):
            if path.is_dir() and not path.is_symlink(): shutil.rmtree(path)

    def once(self):
        item=self.client.request('acquire',self.service_token,{})
        if item['claim'] is None: return None
        if self.config['heartbeat_seconds']*3000 >= item['lease_ms']: raise WorkerError('HEARTBEAT_CONFIG')
        claim,token=item['claim'],item['credential']
        name='data-agent-'+uuid.uuid4().hex
        self.save({'container':name,'token':token})
        docker=DockerAttempt(self.config,name)
        interrupted,finished=threading.Event(),threading.Event()
        state={'cancel':False,'lost':False}
        def heartbeat():
            while not finished.wait(self.config['heartbeat_seconds']):
                try:
                    state['cancel']=self.client.request('heartbeat',token,{})['cancel_requested']
                    if state['cancel']: interrupted.set();return
                except Exception:
                    state['lost']=True;interrupted.set();return
        pulse=threading.Thread(target=heartbeat);pulse.start()
        def check():
            if self.stop.is_set(): raise WorkerError('WORKER_INTERRUPTED')
            if interrupted.is_set(): raise WorkerError('CANCELLED' if state['cancel'] else 'STALE_ATTEMPT')
        directory=Path(tempfile.mkdtemp(prefix='attempt-',dir=self.root))
        stopped=False
        try:
            inputs=directory/'inputs';inputs.mkdir(mode=0o755)
            resolved={};total=0
            for index,(port,ref) in enumerate(item['inputs'].items()):
                path=inputs/str(index)
                count,digest=self.client.request('input',token,{'port':port},destination=path,check=check)
                total+=count
                if total>self.config['input_bytes']: raise AttemptFailure('INPUT_LIMIT')
                if digest!=ref['digest']: raise AttemptFailure('INPUT_CHECKSUM')
                path.chmod(0o444);resolved[port]={**ref,'path':'/input/'+str(index)}
            prefix='/'.join(str(claim[k]) for k in ['project_id','run_id','job_id','attempt_no'])
            check();docker.create(inputs)
            manifest=docker.run({'spec':claim['spec'],'inputs':resolved,'seed':claim['seed'],'recipe':claim.get('recipe'),
                'object_prefix':prefix,'max_columns':self.config['max_columns'],'execution_seconds':self.config['execution_seconds'],'transfer_seconds':2*self.config['docker_timeout_seconds']},check)
            check()
            output=directory/'outputs';output.mkdir(mode=0o700)
            docker.copy(manifest,output,check)
            docker.stop();stopped=True
            for artifact in manifest['outputs'].values():
                key=artifact['object_key'];filename=key.removeprefix(prefix+'/')
                if key != prefix+'/'+filename or not re.fullmatch(r'[a-z_]+\.(json|parquet|zip)',filename): raise AttemptFailure('OUTPUT_PATH')
                path=output/filename
                if path.is_symlink() or not path.is_file() or path.stat().st_size!=artifact['bytes']: raise AttemptFailure('OUTPUT_CHECKSUM')
                with path.open('rb') as file:
                    digest=hashlib.file_digest(file,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else self.checksum(file)
                if digest!=artifact['digest']: raise AttemptFailure('OUTPUT_CHECKSUM')
                check()
                with path.open('rb') as file:
                    self.client.request('output?name='+filename,token,file,headers={'Content-Type':'application/octet-stream',
                        'Content-Length':str(artifact['bytes']),'X-Content-SHA256':digest})
            check()
            status=self.client.request('heartbeat',token,{})
            if status['cancel_requested']:
                self.client.request('cancelled',token,{});self.journal.unlink();return {'status':'cancelled'}
            # Persist the exact submission for replay after a lost response or supervisor restart.
            self.save({'container':name,'token':token,'manifest':manifest})
            result=self.client.request('submit',token,manifest)
            self.journal.unlink();return result
        except Exception as error:
            if isinstance(error,AttemptFailure):
                self.save({'container':name,'token':token,'failure':str(error)})
            if not stopped: docker.stop();stopped=True
            if state['cancel']:
                self.client.request('cancelled',token,{});self.journal.unlink();return {'status':'cancelled'}
            # Keep the journal after uncertain transport/submit failure; recovery owns classification.
            raise error
        finally:
            finished.set();pulse.join()
            if not stopped: docker.stop()
            shutil.rmtree(directory)

    @staticmethod
    def checksum(file):
        digest=hashlib.sha256()
        for chunk in iter(lambda:file.read(65536),b''): digest.update(chunk)
        return digest.hexdigest()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--once',action='store_true')
    args=parser.parse_args();stop=threading.Event()
    signal.signal(signal.SIGTERM,lambda *_:stop.set());signal.signal(signal.SIGINT,lambda *_:stop.set())
    worker=RemoteWorker(json.loads(Path(args.config).read_text()),stop)
    with (worker.root/'supervisor.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        worker.recover()
        while not stop.is_set():
            try:
                result=worker.once()
                if args.once: print(json.dumps(result));return
            except Exception as error:
                code=str(error) if isinstance(error,WorkerError) else type(error).__name__
                print(json.dumps({'error':code}),file=os.sys.stderr,flush=True)
                recovered=worker.recover()
                if args.once:
                    if recovered and recovered.get('status') in ('published','waiting_approval'):
                        print(json.dumps(recovered));return
                    raise
            stop.wait(worker.config['poll_seconds'])

if __name__=='__main__':
    try: main()
    except Exception:
        print('{"error":"WORKER_STOPPED"}',file=os.sys.stderr)
        raise SystemExit(1)
