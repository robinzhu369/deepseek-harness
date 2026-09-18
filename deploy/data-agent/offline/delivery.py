"""Offline delivery operations. No package managers, downloads, or implicit migration at install time."""
from __future__ import annotations
import argparse
import fcntl
from functools import wraps
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path


class DeliveryError(Exception):
    """Operator-visible stable code without secret values."""


def exclusive_operation(function):
    """Serialize mutations and verification of the same delivery root across processes."""
    @wraps(function)
    def run(first, *args, **kwargs):
        root = Path(first).resolve()
        root.parent.mkdir(parents=True, exist_ok=True)
        lock = root.parent / ('.' + root.name + '.delivery.lock')
        descriptor = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise DeliveryError('OPERATION_IN_PROGRESS')
            return function(first, *args, **kwargs)
    return run


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def inventory(root):
    entries = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if relative == 'manifest.json':
                continue
            if path.is_symlink():
                target = os.readlink(path)
                if Path(target).is_absolute() or not path.resolve().is_relative_to(root.resolve()):
                    raise DeliveryError('EXTERNAL_SYMLINK:' + relative)
                entries[relative] = {'link': target}
            elif path.is_file():
                entries[relative] = {'bytes': path.stat().st_size, 'sha256': sha(path),
                                     'mode': stat.S_IMODE(path.stat().st_mode)}
    return entries


def write_manifest(root, metadata):
    value = {**metadata, 'files': inventory(root)}
    (root / 'manifest.json').write_text(json.dumps(value, indent=2) + '\n')
    return value


def verify(root, check_platform=True):
    root = root.resolve()
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest.get('format') != 1:
        raise DeliveryError('MANIFEST_VERSION')
    if check_platform and manifest['platform'] != {'os': platform.system(), 'machine': platform.machine()}:
        raise DeliveryError('PLATFORM_MISMATCH')
    actual = inventory(root)
    expected = manifest['files']
    if actual != expected:
        changed = sorted(k for k in actual.keys() | expected.keys() if actual.get(k) != expected.get(k))
        raise DeliveryError('INTEGRITY:' + ','.join(changed[:10]))
    return manifest


def command(args, **kwargs):
    # Docker local socket and packaged runtime only. No inherited proxy or cloud credentials.
    environment = {'PATH': '/usr/bin:/bin', 'HOME': str(Path.home())}
    result = subprocess.run(args, env=environment, capture_output=True, timeout=300, **kwargs)
    if result.returncode:
        raise DeliveryError('COMMAND_FAILED:' + Path(args[0]).name)
    return result.stdout


def package(repo, output, node, images, release, docker):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}', release):
        raise DeliveryError('RELEASE_NAME')
    output.mkdir(parents=True, exist_ok=False)
    roots = ['apps', 'packages', 'vendor', 'extensions', 'database', 'domain-contracts',
             'skill-packages', 'deploy', 'services', 'native', 'node_modules', '.dsh-build']
    ignored = shutil.ignore_patterns('.git', '.env', '.env.*', '__pycache__', '.pytest_cache',
                                     '.cache', '.storages', '.sessions', 'session.lock', '.DS_Store')
    app = output / 'app'; app.mkdir()
    for name in roots:
        shutil.copytree(repo / name, app / name, symlinks=True, ignore=ignored)
    for path in repo.glob('tsconfig*.json'):
        shutil.copy2(path, app / path.name)
    for name in ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'LICENSE', 'THIRD_PARTY_NOTICES.md']:
        shutil.copy2(repo / name, app / name)
    runtime = output / 'runtime'; runtime.mkdir(); shutil.copy2(node, runtime / 'node')
    (output / 'images').mkdir()
    locked = {}
    for name, image in images.items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name) or not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
            raise DeliveryError('IMAGE_LOCK')
        inspected = json.loads(command([docker, 'image', 'inspect', image]))[0]
        command([docker, 'save', '-o', str(output / 'images' / (name + '.tar')), image])
        locked[name] = {'id': image, 'os': inspected.get('Os', 'multi-platform'), 'architecture': inspected.get('Architecture', 'multi-platform')}
    (output / 'run-dsh').write_text('#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\ncd "$root/app"\nexec "$root/runtime/node" --import tsx/esm apps/cli/src/bin.ts "$@"\n')
    (output / 'run-dsh').chmod(0o755)
    metadata = {'format': 1, 'kind': 'application', 'release': release,
                'platform': {'os': platform.system(), 'machine': platform.machine()},
                'node': command([str(node), '--version']).decode().strip(), 'images': locked,
                'compatibility': {'database_schema': 8, 'workflow_schema': '1', 'operator': '1', 'skill_contract': '1'},
                'source_commit': command(['git', '-C', str(repo), 'rev-parse', 'HEAD']).decode().strip(),
                'created_at': time.time(), 'release_ready': False}
    return write_manifest(output, metadata)


def install(bundle, destination, docker, load_images=True):
    manifest = verify(bundle)
    if manifest['kind'] != 'application': raise DeliveryError('APPLICATION_REQUIRED')
    release = manifest['release']
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}', release): raise DeliveryError('RELEASE_NAME')
    required = sum(f.get('bytes', 0) for f in manifest['files'].values())
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    if shutil.disk_usage(destination).free < required * 2: raise DeliveryError('DISK_CAPACITY')
    releases = destination / 'releases'; releases.mkdir(exist_ok=True)
    target = releases / release
    if target.exists(): raise DeliveryError('RELEASE_EXISTS')
    staging = Path(tempfile.mkdtemp(prefix='.install-', dir=releases))
    try:
        shutil.copytree(bundle, staging, dirs_exist_ok=True, symlinks=True)
        verify(staging)
        if load_images:
            for name, image in manifest['images'].items():
                command([docker, 'load', '-i', str(staging / 'images' / (name + '.tar'))])
                value = json.loads(command([docker, 'image', 'inspect', image['id']]))[0]
                if value['Id'] != image['id']: raise DeliveryError('IMAGE_DIGEST')
        os.rename(staging, target)
    finally:
        if staging.exists(): shutil.rmtree(staging)
    return {'installed': release, 'bytes': required, 'activated': False}


def assert_stopped(state):
    for name in ['app.pid', 'worker.pid']:
        path = state / name
        if path.exists():
            try: os.kill(int(path.read_text().strip()), 0)
            except ProcessLookupError: continue
            raise DeliveryError('SERVICE_STILL_RUNNING:' + name)


@exclusive_operation
def activate(destination, release, state):
    assert_stopped(state)
    root = destination.resolve(); target = root / 'releases' / release
    if not target.resolve().is_relative_to(root / 'releases'): raise DeliveryError('RELEASE_PATH')
    candidate = verify(target)
    current = root / 'current'
    previous = verify(current.resolve()) if current.is_symlink() else None
    if previous and candidate['compatibility'] != previous['compatibility']:
        raise DeliveryError('INCOMPATIBLE_REQUIRES_RESTORE')
    # Existing release is retained for explicit rollback; no implicit schema downgrade.
    link = root / ('.activate-' + str(os.getpid()))
    link.symlink_to(target.relative_to(root))
    os.replace(link, current)
    return {'active': release, 'previous': previous['release'] if previous else None}


@exclusive_operation
def backup(state, output, pg_container, database, docker):
    assert_stopped(state)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    # These roots are the complete persistent domain state; credential/config roots are separate.
    for name in ['objects', 'harness']:
        source = state / name
        if not source.is_dir(): raise DeliveryError('STATE_ROOT_MISSING:' + name)
        shutil.copytree(source, output / name, symlinks=True,
                        ignore=shutil.ignore_patterns('.credentials.yaml', '.env', 'settings.yaml', 'session.lock', 'node_modules'))
    remote='/tmp/data-agent-'+uuid.uuid4().hex+'.dump'
    command([docker, 'exec', pg_container, 'pg_dump', '-U', 'postgres', '-d', database,
             '--no-owner', '--no-privileges', '--format=custom', '--file='+remote])
    try: command([docker, 'cp', pg_container + ':'+remote, str(output / 'database.dump')])
    finally: command([docker, 'exec', pg_container, 'rm', remote])
    return write_manifest(output, {'format': 1, 'kind': 'backup', 'platform': {'os': platform.system(), 'machine': platform.machine()},
                                  'database': database, 'created_at': time.time(), 'consistency': 'quiescent-services',
                                  'credentials_included': False})


def restore(snapshot, state, pg_container, database, docker):
    manifest = verify(snapshot)
    if manifest['kind'] != 'backup': raise DeliveryError('BACKUP_REQUIRED')
    # No overwrite path: operator must supply an empty recovery database and fresh state root.
    if state.exists(): raise DeliveryError('RESTORE_DESTINATION_EXISTS')
    tables = command([docker, 'exec', pg_container, 'psql', '-U', 'postgres', '-d', database, '-Atc',
                      "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"]).strip()
    if tables != b'0': raise DeliveryError('RESTORE_DATABASE_NOT_EMPTY')
    started = time.monotonic()
    remote='/tmp/data-agent-'+uuid.uuid4().hex+'.dump'
    command([docker, 'cp', str(snapshot / 'database.dump'), pg_container + ':'+remote])
    try: command([docker, 'exec', pg_container, 'pg_restore', '-U', 'postgres', '-d', database,
                  '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', remote])
    finally: command([docker, 'exec', pg_container, 'rm', remote])
    state.mkdir(parents=True, mode=0o700)
    for name in ['objects', 'harness']: shutil.copytree(snapshot / name, state / name, symlinks=True)
    return {'restored': True, 'seconds': time.monotonic() - started, 'checkpoint': manifest['created_at'],
            'loss_after_checkpoint': 'not captured', 'credentials_restored': False}


def main():
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('package');p.add_argument('--repo',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--node',type=Path,required=True);p.add_argument('--images',type=Path,required=True);p.add_argument('--release',required=True)
    p=sub.add_parser('verify');p.add_argument('bundle',type=Path)
    p=sub.add_parser('install');p.add_argument('bundle',type=Path);p.add_argument('destination',type=Path)
    p=sub.add_parser('activate');p.add_argument('destination',type=Path);p.add_argument('release');p.add_argument('state',type=Path)
    p=sub.add_parser('backup');p.add_argument('state',type=Path);p.add_argument('output',type=Path);p.add_argument('--postgres',required=True);p.add_argument('--database',required=True)
    p=sub.add_parser('restore');p.add_argument('snapshot',type=Path);p.add_argument('state',type=Path);p.add_argument('--postgres',required=True);p.add_argument('--database',required=True)
    parser.add_argument('--docker',default='/usr/local/bin/docker');args=parser.parse_args()
    if args.action=='package':result=package(args.repo.resolve(),args.output.resolve(),args.node.resolve(),json.loads(args.images.read_text()),args.release,args.docker)
    elif args.action=='verify':result=verify(args.bundle);result={key:value for key,value in result.items() if key!='files'}
    elif args.action=='install':result=install(args.bundle,args.destination,args.docker)
    elif args.action=='activate':result=activate(args.destination,args.release,args.state)
    elif args.action=='backup':result=backup(args.state,args.output,args.postgres,args.database,args.docker)
    else:result=restore(args.snapshot,args.state,args.postgres,args.database,args.docker)
    print(json.dumps(result if args.action!='package' else {key:value for key,value in result.items() if key!='files'},indent=2))


if __name__=='__main__':
    try:main()
    except (DeliveryError,FileNotFoundError) as error:
        print(json.dumps({'error':str(error) if isinstance(error,DeliveryError) else 'REQUIRED_FILE_MISSING'}))
        raise SystemExit(1)
