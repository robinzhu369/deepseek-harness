"""Real kernel resource enforcement, plus credential and endpoint policy regression."""
import json
import os
import uuid
from pathlib import Path
import pytest
from remote import DockerAttempt, Client, validate_config, WorkerError, AttemptFailure, RemoteWorker


def config(tmp_path,image):
    return dict(root=str(tmp_path),docker='/usr/local/bin/docker',docker_home=os.environ['HOME'],instance_id='isolation-test',
        image=image,memory_bytes=536870912,cpus=1,pids=64,output_bytes=16000000,temporary_bytes=8000000,polars_threads=1,
        manifest_bytes=100000,execution_seconds=20,docker_timeout_seconds=20,http_timeout_seconds=5,heartbeat_seconds=.2,
        poll_seconds=.1,input_bytes=10000000)


def test_reject_public_plaintext_and_mutable_image(tmp_path):
    c=config(tmp_path,'latest')
    with pytest.raises(WorkerError,match='IMAGE_DIGEST'):validate_config(c)
    for endpoint in ['http://example.com','https://user:secret@example.com','https://example.com/?redirect=x']:
        with pytest.raises(WorkerError):Client({**c,'endpoint':endpoint})


@pytest.mark.skipif(not os.environ.get('DATA_AGENT_ISOLATION_IMAGE'),reason='requires the built isolation fixture image')
def test_container_enforces_network_filesystem_and_cgroup_budgets(tmp_path,monkeypatch):
    c=config(tmp_path,os.environ['DATA_AGENT_ISOLATION_IMAGE'])
    monkeypatch.setenv('APPLICATION_SECRET','must-never-enter-container')
    inputs=tmp_path/'inputs';inputs.mkdir(mode=0o755)
    attempt=DockerAttempt(c,'data-agent-'+uuid.uuid4().hex)
    try:
        attempt.create(inputs)
        result=attempt.run({},lambda:None)
        assert result['root'] and result['input'] and result['network'] and result['disk']
        assert result['uid']==65532
        assert 'APPLICATION_SECRET' not in result['env']
        assert 'CapEff:\t0000000000000000' in result['status']
        assert 'NoNewPrivs:\t1' in result['status']
        assert result['cgroup']=={'memory.max':'536870912','pids.max':'64','cpu.max':'100000 100000'}
    finally:attempt.stop()
    assert not attempt.command('ps','-aq','--filter','name=^/'+attempt.name+'$').stdout.strip()


@pytest.mark.skipif(not os.environ.get('DATA_AGENT_ISOLATION_IMAGE'),reason='requires the built isolation fixture image')
@pytest.mark.parametrize('mode,code', [('memory','MEMORY_LIMIT'),('timeout','EXECUTION_TIMEOUT'),
    ('malformed','INVALID_WORKER_RESPONSE'),('untrusted-code','INVALID_WORKER_RESPONSE'),('dimension','DIMENSION_LIMIT')])
def test_container_failure_classification_and_quiescent_cleanup(tmp_path,mode,code):
    c=config(tmp_path,os.environ['DATA_AGENT_ISOLATION_IMAGE']);c['execution_seconds']=3
    inputs=tmp_path/'inputs';inputs.mkdir(mode=0o755)
    attempt=DockerAttempt(c,'data-agent-'+uuid.uuid4().hex)
    try:
        attempt.create(inputs)
        with pytest.raises(AttemptFailure,match='^'+code+'$'):
            attempt.run({'failure_mode':mode},lambda:None)
    finally:attempt.stop()
    assert all(not thread.is_alive() for thread in attempt.readers)
    assert attempt.process.poll() is not None
    assert not attempt.command('ps','-aq','--filter','name=^/'+attempt.name+'$').stdout.strip()


@pytest.mark.parametrize('cancel,stale',[(False,False),(True,False),(False,True)])
def test_saved_failure_recovery_keeps_cancellation_and_fencing(tmp_path,monkeypatch,cancel,stale):
    c={**config(tmp_path,'sha256:'+'a'*64),'endpoint':'http://127.0.0.1:1','credential_env':'WORKER_TOKEN'}
    monkeypatch.setenv('WORKER_TOKEN','synthetic')
    worker=RemoteWorker(c);calls=[]
    worker.save({'container':'data-agent-'+'b'*32,'token':'attempt','failure':'DIMENSION_LIMIT'})
    monkeypatch.setattr(DockerAttempt,'stop',lambda self:None)
    def request(route,token,body):
        calls.append((route,body))
        if route=='cancelled':
            if cancel:return {'status':'cancelled'}
            raise WorkerError('STALE_ATTEMPT')
        if stale:raise WorkerError('STALE_ATTEMPT')
        return {'accepted':True}
    monkeypatch.setattr(worker.client,'request',request)
    result=worker.recover()
    assert calls==([('cancelled',{})] if cancel else [('cancelled',{}),('failure',{'code':'DIMENSION_LIMIT'})])
    assert not worker.journal.exists()
    assert result==({'status':'cancelled'} if cancel else None if stale else {'status':'failed','error':'DIMENSION_LIMIT'})


def test_failure_ack_transport_loss_retains_exact_journal(tmp_path,monkeypatch):
    c={**config(tmp_path,'sha256:'+'a'*64),'endpoint':'http://127.0.0.1:1','credential_env':'WORKER_TOKEN'}
    monkeypatch.setenv('WORKER_TOKEN','synthetic');worker=RemoteWorker(c)
    worker.save({'container':'data-agent-'+'b'*32,'token':'attempt','failure':'MEMORY_LIMIT'})
    monkeypatch.setattr(DockerAttempt,'stop',lambda self:None)
    def request(route,token,body):
        if route=='cancelled':raise WorkerError('STALE_ATTEMPT')
        raise OSError('transport closed')
    monkeypatch.setattr(worker.client,'request',request)
    with pytest.raises(OSError):worker.recover()
    assert json.loads(worker.journal.read_text())['failure']=='MEMORY_LIMIT'
