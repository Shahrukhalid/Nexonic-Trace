"""Shared APK signature, contents and native-alignment verification."""
import re
import struct
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
import zipfile


def verify(apk, abi, sdk, *, release=False, certificate=None):
    tools=sorted((Path(sdk)/'build-tools').iterdir(),key=lambda p:tuple(int(x) for x in p.name.split('.') if x.isdigit()))[-1]
    result=subprocess.run([tools/'apksigner','verify','--verbose','--print-certs',apk],capture_output=True,text=True)
    if result.returncode: raise ValueError('APK signature verification failed')
    fingerprints=re.findall(r'Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)',result.stdout)
    if release and (len(fingerprints)!=1 or fingerprints[0].lower()!=certificate):
        raise ValueError('APK signer does not match the committed Android release identity')
    subprocess.run([tools/'zipalign','-c','-P','16','4',apk],check=True,capture_output=True)
    with zipfile.ZipFile(apk) as archive:
        files=archive.namelist()
        if not {'assets/notices/INDEX.json','assets/notices/rust-standard-library/COPYRIGHT-library.html'}.issubset(files):
            raise ValueError('APK dependency notices missing')
        libraries=[name for name in files if name.startswith('lib/') and name.endswith('.so')]
        if not libraries or any(name.split('/')[1]!=abi for name in libraries): raise ValueError('APK architecture mismatch')
        for name in libraries:
            with archive.open(name) as stream: elf=stream.read(65536)
            if len(elf)<64 or elf[:4]!=b'\x7fELF' or elf[4] not in (1,2) or elf[5]!=1: raise ValueError('Invalid native library')
            is64=elf[4]==2
            offset=struct.unpack_from('<Q' if is64 else '<I',elf,32 if is64 else 28)[0]
            size,count=struct.unpack_from('<HH',elf,54 if is64 else 42)
            if size<(56 if is64 else 32) or offset+size*count>len(elf): raise ValueError('Invalid native program headers')
            for index in range(count):
                position=offset+size*index
                kind=struct.unpack_from('<I',elf,position)[0]
                alignment=struct.unpack_from('<Q' if is64 else '<I',elf,position+(48 if is64 else 28))[0]
                if kind==1 and alignment<16384: raise ValueError('Native library lacks 16 KiB page alignment')
    if release:
        analyzers=list((Path(sdk)/'cmdline-tools').glob('*/bin/apkanalyzer'))
        if not analyzers: raise ValueError('Android APK analyzer is missing')
        result=subprocess.run([str(sorted(analyzers)[-1]),'manifest','print',str(apk)],capture_output=True,text=True)
        if result.returncode: raise ValueError('Release manifest inspection failed')
        manifest=ET.fromstring(result.stdout)
        application=manifest.find('application')
        prefix='{http://schemas.android.com/apk/res/android}'
        if manifest.get('package')!='com.nexonic.trace' or application is None: raise ValueError('Unexpected Android application')
        if application.get(prefix+'debuggable','false')!='false' or application.get(prefix+'testOnly','false')!='false':
            raise ValueError('Debuggable or test-only APK cannot be published as production')
        if application.get(prefix+'allowBackup')!='false' or application.get(prefix+'usesCleartextTraffic')!='false':
            raise ValueError('Production Android backup/network policy is not enforced')
    return fingerprints[0].lower() if fingerprints else None
