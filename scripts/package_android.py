"""Verify development APK signatures, ABI contents and native 16 KiB alignment."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import zipfile
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
proof=json.loads((ROOT/'test-results/android-native.json').read_text())
if proof.get('passed') is not True or proof.get('testedAbi') not in {'x86_64','arm64-v8a','armeabi-v7a'}:
    raise SystemExit('Actual Android native acceptance proof required')
reports=list((ROOT/'src-tauri/gen/android/app/build/outputs/androidTest-results').rglob('TEST-*.xml'))
if not reports:
    raise SystemExit('Android instrumentation results required')
count=0
for report in reports:
    suite=ET.parse(report).getroot()
    if int(suite.get('failures','0')) or int(suite.get('errors','0')):
        raise SystemExit('Android instrumentation failed')
    count+=int(suite.get('tests','0'))-int(suite.get('skipped','0'))
if count<1:
    raise SystemExit('No Android instrumentation tests ran')
sdk=Path(os.environ['ANDROID_HOME'])
tools=sorted((sdk/'build-tools').iterdir(),key=lambda p:tuple(int(x) for x in p.name.split('.') if x.isdigit()))[-1]
out=ROOT/'release-assets'
out.mkdir(exist_ok=True)
records=[]
for abi,label,variant in [('arm64-v8a','ARM64','arm64'),('armeabi-v7a','ARM32','arm')]:
    candidates=list((ROOT/'src-tauri/gen/android/app/build/outputs/apk').glob(f'{variant}/debug/*-debug.apk'))
    if len(candidates)!=1:
        raise SystemExit(f'Expected one {abi} debug APK; found {candidates}')
    apk=candidates[0]
    subprocess.run([tools/'apksigner','verify','--verbose',apk],check=True)
    subprocess.run([tools/'zipalign','-c','-P','16','4',apk],check=True)
    with zipfile.ZipFile(apk) as archive:
        libraries=[n for n in archive.namelist() if n.startswith('lib/') and n.endswith('.so')]
        if not libraries or any(n.split('/')[1]!=abi for n in libraries):
            raise SystemExit('APK ABI mismatch')
        if not {'assets/notices/INDEX.json','assets/notices/rust-standard-library/COPYRIGHT-library.html'}.issubset(archive.namelist()):
            raise SystemExit('Android dependency notices missing')
        for name in libraries:
            elf=archive.read(name)
            if elf[:4]!=b'\x7fELF' or elf[5]!=1:
                raise SystemExit('Unrecognized native library')
            is64=elf[4]==2
            offset=struct.unpack_from('<Q' if is64 else '<I',elf,32 if is64 else 28)[0]
            size,count=struct.unpack_from('<HH',elf,54 if is64 else 42)
            for index in range(count):
                position=offset+size*index
                kind=struct.unpack_from('<I',elf,position)[0]
                alignment=struct.unpack_from('<Q' if is64 else '<I',elf,position+(48 if is64 else 28))[0]
                if kind==1 and alignment<16384:
                    raise SystemExit(f'{name} has incompatible native page alignment')
    name=f'NexonicTrace-Android-{label}-Development.apk'
    shutil.copyfile(apk,out/name)
    records.append({'name':name,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'bytes':apk.stat().st_size,'signature':'Android development certificate verified','alignment':'16 KiB ELF and APK verified'})
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
(out/'VALIDATION-Android.json').write_text(json.dumps({'sourceCommit':commit,'testedAbi':proof['testedAbi'],'level':'development test build','productionSigned':False,'nativeAcceptance':'installation, launch, real IPC, navigation, history, cancellation and deletion passed on testedAbi; published ARM APK signatures, architecture, contents and alignment verified','assets':records},indent=2)+'\n')
print('Android signatures, contents, architecture and 16 KiB alignment passed.')
