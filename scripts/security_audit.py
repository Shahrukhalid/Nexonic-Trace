"""Gate every supported native dependency graph against fresh RustSec results.

Cargo.lock also contains Linux/iOS-only libraries. Their advisories are reported,
not silently waived; they cannot fail a Windows/macOS/Android-only release unless
reachable in a supported target (including its build/dev dependencies).
"""
import json
import os
import subprocess

TARGETS=['x86_64-pc-windows-msvc','aarch64-apple-darwin','x86_64-apple-darwin','aarch64-linux-android','armv7-linux-androideabi','x86_64-linux-android']
reachable=set()
for target in TARGETS:
    metadata=json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--filter-platform',target]))
    packages={p['id']:p for p in metadata['packages']}
    nodes={n['id']:n for n in metadata['resolve']['nodes']}
    seen=set()
    stack=list(metadata['workspace_members'])
    while stack:
        key=stack.pop()
        if key in seen:
            continue
        seen.add(key)
        package=packages[key]
        reachable.add((package['name'],package['version']))
        stack.extend(nodes[key]['dependencies'])
command=[os.environ.get('CARGO_AUDIT','cargo-audit'),'audit','--json']
result=subprocess.run(command,capture_output=True,text=True)
if result.returncode not in (0,1):
    raise SystemExit(result.stderr or 'RustSec scanner failed')
try:
    report=json.loads(result.stdout)
except ValueError:
    raise SystemExit('RustSec scanner did not produce a valid report')
if not isinstance(report.get('warnings'),dict) or not isinstance(report.get('vulnerabilities',{}).get('list'),list):
    raise SystemExit('RustSec report schema changed; review required')
findings=report['vulnerabilities']['list'] + [entry for values in report['warnings'].values() for entry in values]
active=[]
for finding in findings:
    package=finding['package']
    identifier=finding.get('advisory',{}).get('id',finding.get('kind','unknown warning'))
    affected=(package['name'],package['version']) in reachable
    print(f"{identifier}: {package['name']} {package['version']}: {'FAIL: reachable in supported graphs' if affected else 'outside all supported target graphs (reported, no ignore waiver)'}")
    if affected:
        active.append(finding)
if active:
    raise SystemExit(f'{len(active)} RustSec findings affect supported build graphs')
print(f'RustSec gate passed for {len(TARGETS)} supported target graphs; {len(findings)} unrelated lockfile findings disclosed.')
