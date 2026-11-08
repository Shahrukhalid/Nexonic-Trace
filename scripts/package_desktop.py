"""Validate and collect development desktop bundles after native acceptance tests."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--out', default='release-assets')
args=parser.parse_args()
out=ROOT/args.out
out.mkdir(parents=True,exist_ok=True)
notices=ROOT/'src-tauri/notices'
if not (notices/'INDEX.json').is_file():
    raise SystemExit('Dependency notices must be collected before packaging')
build=ROOT/'target/debug'
smoke=ROOT/'scripts/native_smoke.py'

def run(*args):
    subprocess.run([str(x) for x in args],check=True,cwd=ROOT)

if platform.system()=='Windows':
    executable=build/'nexonic-trace.exe'
    setup=list((build/'bundle/nsis').glob('*.exe'))
    if len(setup)!=1:
        raise SystemExit('Exactly one per-user installer required')
    with tempfile.TemporaryDirectory(prefix='nexonic-install-') as temporary:
        installed=Path(temporary)/'Application'
        run(setup[0],'/S',f'/D={installed}')
        run('python',smoke,installed/'nexonic-trace.exe')
        uninstaller=installed/'uninstall.exe'
        if uninstaller.exists():
            run(uninstaller,'/S')
    shutil.copyfile(setup[0],out/'NexonicTrace-Windows-x64-Development-Setup.exe')
    with tempfile.TemporaryDirectory(prefix='nexonic-portable-') as temporary:
        portable=Path(temporary)/'NexonicTrace'
        portable.mkdir()
        shutil.copyfile(executable,portable/executable.name)
        shutil.copytree(notices,portable/'notices')
        (portable/'portable.txt').write_text('Keep this marker beside the executable to store ordinary data in NexonicTraceData.\n')
        (portable/'README.txt').write_text('Nexonic Trace development test build. Unsigned. Windows x64.\nExtract the whole folder to a writable location, then open nexonic-trace.exe.\nMicrosoft Edge WebView2 Runtime is required: https://developer.microsoft.com/microsoft-edge/webview2/\nOrdinary settings and opted-in history remain in NexonicTraceData beside this app.\nAPI keys stay in memory for the current session. Passwords are never saved.\n')
        run('python',smoke,portable/executable.name,'--portable')
        shutil.rmtree(portable/'NexonicTraceData')
        shutil.make_archive(str(out/'NexonicTrace-Windows-x64-Development-Portable'),'zip',temporary)
    label='Windows-x64'
else:
    label='macOS-'+('AppleSilicon' if platform.machine()=='arm64' else 'Intel')
    app=build/'bundle/macos/Nexonic Trace.app'
    if not (app/'Contents/Resources/notices/INDEX.json').exists():
        raise SystemExit('Application bundle is missing its dependency notices')
    run('codesign','--verify','--deep','--strict',app)
    run('python3',smoke,app/'Contents/MacOS/nexonic-trace')
    run('ditto','-c','-k','--sequesterRsrc','--keepParent',app,out/f'NexonicTrace-{label}-Development.zip')
    images=list((build/'bundle/dmg').glob('*.dmg'))
    if len(images)!=1:
        raise SystemExit('Exactly one disk image required')
    run('hdiutil','verify',images[0])
    shutil.copyfile(images[0],out/f'NexonicTrace-{label}-Development.dmg')
record={'platform':label,'level':'development test build','productionSigned':False,'nativeAcceptance':'passed: launch, real IPC, restart persistence, navigation, deletion', 'assets':[]}
for item in sorted(out.iterdir()):
    if item.is_file() and item.suffix in {'.exe','.zip','.dmg'}:
        record['assets'].append({'name':item.name,'sha256':hashlib.sha256(item.read_bytes()).hexdigest(),'bytes':item.stat().st_size})
(out/f'VALIDATION-{label}.json').write_text(json.dumps(record,indent=2)+'\n')
print('Desktop package contents and native acceptance passed.')
