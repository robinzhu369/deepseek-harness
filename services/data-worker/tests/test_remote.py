"""Real kernel resource enforcement, plus credential and endpoint policy regression."""
import json
import os
import uuid
from pathlib import Path
import pytest
from remote import DockerAttempt, Client, validate_config, WorkerError


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
