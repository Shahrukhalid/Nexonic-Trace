"""Retry transient bundler errors without touching unrelated mounted images."""
import argparse
from collections import deque
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def owned_dmg_devices(info, bundle_directory):
    devices = set()
    directory = bundle_directory.resolve()
    for image in info.get('images', []):
        image_path = image.get('image-path')
        if not image_path or not Path(image_path).resolve().is_relative_to(directory):
            continue
        for entity in image.get('system-entities', []):
            device = entity.get('dev-entry', '')
            if re.fullmatch(r'/dev/disk[0-9]+', device):
                devices.add(device)
    return sorted(devices)


def cleanup_own_images():
    result = subprocess.run(['hdiutil', 'info', '-plist'], capture_output=True)
    if result.returncode:
        return
    try:
        devices = owned_dmg_devices(plistlib.loads(result.stdout), ROOT/'target/debug/bundle')
    except (ValueError, plistlib.InvalidFileException):
        print('Could not inspect task disk images; leaving mounted images unchanged.', flush=True)
        return
    for device in devices:
        print(f'Detaching this build\'s temporary image: {device}', flush=True)
        result = subprocess.run(['hdiutil', 'detach', device])
        if result.returncode:
            subprocess.run(['hdiutil', 'detach', '-force', device], check=True)


def transient_failure(output):
    return any(message in output.lower() for message in [
        'failed to download', 'download error', 'connection reset',
        'connection timed out', 'operation timed out', 'resource busy',
        'device not configured', 'hdiutil:', 'http status 502',
        'http status 503', 'http status 504',
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundles', choices=['nsis', 'app,dmg'], required=True)
    args = parser.parse_args()
    command = ['npm', 'run', 'tauri', '--', 'build', '--debug', '--bundles', args.bundles, '--ci']
    if platform.system() == 'Windows':
        command = [os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/c'] + command
    environment = dict(os.environ, CI='true', CARGO_TERM_COLOR='never')
    for attempt in range(1, 4):
        tail = deque(maxlen=2000)
        process = subprocess.Popen(command, cwd=ROOT, env=environment,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding='utf-8', errors='replace')
        for line in process.stdout:
            print(line, end='', flush=True)
            tail.append(line)
        code = process.wait()
        if code == 0:
            return
        if attempt == 3 or not transient_failure(''.join(tail)):
            raise SystemExit(code)
        print(f'Transient bundling failure; retrying attempt {attempt + 1}/3.', flush=True)
        if platform.system() == 'Darwin':
            cleanup_own_images()
        time.sleep(20)


if __name__ == '__main__':
    main()
