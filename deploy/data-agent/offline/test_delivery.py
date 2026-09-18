"""Negative controls for offline integrity, activation and recovery preconditions."""
import json
import os
from pathlib import Path
import pytest
from delivery import DeliveryError, verify, write_manifest, install, activate, assert_stopped
import platform


def bundle(path,release='v1',schema=8):
    path.mkdir();(path/'run-dsh').write_text('immutable app')
    write_manifest(path,{'format':1,'kind':'application','release':release,
        'platform':{'os':platform.system(),'machine':platform.machine()},
        'images':{},'compatibility':{'database_schema':schema}})
    return path


def test_integrity_rejects_tampering_missing_files_and_external_links(tmp_path):
    root=bundle(tmp_path/'bundle');verify(root)
    (root/'run-dsh').write_text('tampered')
    with pytest.raises(DeliveryError,match='INTEGRITY'):verify(root)
    (root/'run-dsh').unlink()
    with pytest.raises(DeliveryError,match='INTEGRITY'):verify(root)
    (root/'outside').symlink_to('/etc/passwd')
    with pytest.raises(DeliveryError,match='EXTERNAL_SYMLINK'):verify(root)


def test_install_activate_upgrade_rollback_and_reject_incompatible(tmp_path):
    dest=tmp_path/'installation';state=tmp_path/'state';state.mkdir()
    for name,schema in [('v1',8),('v2',8),('v3',9)]:
        install(bundle(tmp_path/name,name,schema),dest,'unused',load_images=False)
    assert not (dest/'current').exists()
    assert activate(dest,'v1',state)['previous'] is None
    assert activate(dest,'v2',state)['previous']=='v1'
    assert activate(dest,'v1',state)['previous']=='v2'
    with pytest.raises(DeliveryError,match='INCOMPATIBLE'):activate(dest,'v3',state)
    assert (dest/'current').resolve().name=='v1'
    (state/'app.pid').write_text(str(os.getpid()))
    with pytest.raises(DeliveryError,match='SERVICE_STILL_RUNNING'):assert_stopped(state)
    with pytest.raises(DeliveryError,match='SERVICE_STILL_RUNNING'):activate(dest,'v2',state)


def test_platform_and_extra_file_are_rejected(tmp_path):
    root=bundle(tmp_path/'bundle');m=json.loads((root/'manifest.json').read_text())
    m['platform']['machine']='other-cpu';(root/'manifest.json').write_text(json.dumps(m))
    with pytest.raises(DeliveryError,match='PLATFORM_MISMATCH'):verify(root)
    (root/'unexpected').write_text('unreviewed')
    with pytest.raises(DeliveryError,match='INTEGRITY'):verify(root,check_platform=False)


def test_operation_lock_rejects_concurrent_activation(tmp_path):
    import fcntl
    dest=tmp_path/'installation';state=tmp_path/'state';state.mkdir()
    install(bundle(tmp_path/'v1'),dest,'unused',load_images=False)
    with (tmp_path/'.installation.delivery.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(DeliveryError,match='OPERATION_IN_PROGRESS'):activate(dest,'v1',state)
    assert activate(dest,'v1',state)['active']=='v1'
