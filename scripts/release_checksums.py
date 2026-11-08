"""Reject incomplete, mixed-commit or unexpected development release payloads."""
from pathlib import Path
import hashlib
import json
import subprocess

PLATFORMS = {
    'Windows-x64': {'NexonicTrace-Windows-x64-Development-Setup.exe', 'NexonicTrace-Windows-x64-Development-Portable.zip'},
    'macOS-AppleSilicon': {'NexonicTrace-macOS-AppleSilicon-Development.zip', 'NexonicTrace-macOS-AppleSilicon-Development.dmg'},
    'macOS-Intel': {'NexonicTrace-macOS-Intel-Development.zip', 'NexonicTrace-macOS-Intel-Development.dmg'},
    'Android': {'NexonicTrace-Android-ARM64-Development.apk', 'NexonicTrace-Android-ARM32-Development.apk'},
}


def validate_release(out, source_commit):
    expected = set().union(*PLATFORMS.values())
    records = []
    for label, names in PLATFORMS.items():
        record = json.loads((out/f'VALIDATION-{label}.json').read_text())
        if record.get('productionSigned') is not False or record.get('level') != 'development test build':
            raise ValueError('Invalid development release evidence')
        if record.get('sourceCommit') != source_commit:
            raise ValueError(f'{label} was built from a different source commit')
        assets = record['assets']
        if len(assets) != len(names) or {item['name'] for item in assets} != names:
            raise ValueError(f'{label} validation inventory does not match expected assets')
        records.extend(assets)
    for record in records:
        path = out/record['name']
        if not path.is_file() or path.stat().st_size == 0 or path.stat().st_size != record['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError(f'Package integrity failed: {path.name}')
    # The upload step uses a wildcard, so reject *any* unexpected file or folder,
    # including databases, signing files and leftover test data.
    allowed = expected | {f'VALIDATION-{label}.json' for label in PLATFORMS} | {'SHA256SUMS.txt'}
    if any(not path.is_file() or path.name not in allowed for path in out.iterdir()):
        raise ValueError('Unexpected release payload')
    return ''.join(f"{hashlib.sha256((out/name).read_bytes()).hexdigest()}  {name}\n" for name in sorted(expected))


if __name__ == '__main__':
    directory = Path('release-assets')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    try:
        checksums = validate_release(directory, commit)
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(str(error))
    (directory/'SHA256SUMS.txt').write_text(checksums)
    print('Complete release inventory, source commit and checksums verified.')
