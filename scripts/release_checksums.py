"""Fail closed unless the complete development release set and validation evidence exist."""
from pathlib import Path
import hashlib
import json

out=Path('release-assets')
expected={
'NexonicTrace-Windows-x64-Development-Setup.exe',
'NexonicTrace-Windows-x64-Development-Portable.zip',
'NexonicTrace-macOS-AppleSilicon-Development.zip',
'NexonicTrace-macOS-AppleSilicon-Development.dmg',
'NexonicTrace-macOS-Intel-Development.zip',
'NexonicTrace-macOS-Intel-Development.dmg',
'NexonicTrace-Android-ARM64-Development.apk',
'NexonicTrace-Android-ARM32-Development.apk',
}
records=[]
for label in ['Windows-x64','macOS-AppleSilicon','macOS-Intel','Android']:
    record=json.loads((out/f'VALIDATION-{label}.json').read_text())
    if record['productionSigned'] or record['level']!='development test build':
        raise SystemExit('Invalid development release evidence')
    records.extend(record['assets'])
if {r['name'] for r in records}!=expected:
    raise SystemExit('Release validation inventory does not match expected assets')
for record in records:
    path=out/record['name']
    if not path.is_file() or path.stat().st_size!=record['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest()!=record['sha256']:
        raise SystemExit(f'Package integrity failed: {path.name}')
actual={p.name for p in out.iterdir() if p.suffix in {'.exe','.zip','.dmg','.apk'}}
if actual!=expected:
    raise SystemExit('Unexpected release payload')
(out/'SHA256SUMS.txt').write_text(''.join(f"{hashlib.sha256((out/name).read_bytes()).hexdigest()}  {name}\n" for name in sorted(expected)))
print('Complete release inventory and checksums verified.')
