"""Verify and collect release-signed ARM APKs after actual release instrumentation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET
from apk_checks import verify
from production import ROOT, FILES, record

proof=json.loads((ROOT/'test-results/android-release-native.json').read_text())
if proof.get('passed') is not True or proof.get('testedAbi')!='x86_64':
    raise SystemExit('Actual release-build instrumentation proof required')
expected=json.loads((ROOT/'release/android-signing.json').read_text())['sha256']
if proof.get('certificateSha256')!=expected: raise SystemExit('Instrumentation used a different release signer')
out=ROOT/'production-assets';out.mkdir(exist_ok=True)
for abi,variant,name in [('arm64-v8a','arm64',FILES['Android'][0]),('armeabi-v7a','arm',FILES['Android'][1])]:
    matches=list((ROOT/f'src-tauri/gen/android/app/build/outputs/apk/{variant}/release').glob('*.apk'))
    if len(matches)!=1: raise SystemExit('Exactly one signed release APK per architecture is required')
    verify(matches[0],abi,os.environ['ANDROID_HOME'],release=True,certificate=expected)
    shutil.copyfile(matches[0],out/name)
record('Android',{'nativeInstrumentation':True,'testedAbi':'x86_64','certificatePinned':True,
                  'certificateSha256':expected,'notDebuggable':True,'alignment':True})
print('Signed release APK identities, manifest, notices, alignment and native instrumentation passed.')
