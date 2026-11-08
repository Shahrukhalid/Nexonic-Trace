"""Verify the actual release executable renders and reads native settings.

Normal application data is never used. Portable checks require a clean copy
inside the caller-owned verification temp directory. Remote debugging stays off.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


def check(application, root, portable=False):
    application = Path(application).resolve()
    if not application.is_file():
        raise ValueError('Release executable missing')
    marker = root/'.nexonic-release-verification'
    marker.write_bytes(b'v1\n')
    result = root/'result.json'
    result.unlink(missing_ok=True)
    environment = dict(os.environ, CI='true', NEXONIC_RELEASE_SMOKE_DATA=str(root))
    process = subprocess.Popen([str(application)], env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        _, errors = process.communicate(timeout=90)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise ValueError('Release startup verification timed out')
    if process.returncode or not result.is_file():
        raise ValueError('Release startup failed to confirm rendering and native settings')
    proof = json.loads(result.read_text())
    if proof != {'passed':True,'rendered':True,'nativePreferences':True}:
        raise ValueError('Invalid release startup evidence')
    if portable and not (application.parent/'NexonicTraceData/trace.db').is_file():
        raise ValueError('Portable release did not create its database beside the executable')
    print('Actual release rendering and native preferences passed; personal data was not used.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('application')
    parser.add_argument('--root')
    parser.add_argument('--portable', action='store_true')
    args = parser.parse_args()
    if args.root:
        root = Path(args.root).resolve()
        if root.parent != Path(tempfile.gettempdir()).resolve() or not root.name.startswith('NexonicTraceAcceptance-'):
            raise SystemExit('Verification root must be a dedicated OS temporary directory')
        check(args.application, root, args.portable)
    else:
        if args.portable:
            raise SystemExit('Portable checks require an explicit caller-owned verification root')
        with tempfile.TemporaryDirectory(prefix='NexonicTraceAcceptance-') as temporary:
            check(args.application, Path(temporary).resolve())


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
