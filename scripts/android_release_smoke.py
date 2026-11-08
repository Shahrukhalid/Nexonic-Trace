"""Run actual release UI instrumentation without WebView remote debugging."""
import json
import os
from pathlib import Path
import re
import subprocess
from apk_checks import verify
from production import ROOT

sdk=Path(os.environ['ANDROID_HOME'])
adb=sdk/'platform-tools/adb'
serial=os.environ.get('ANDROID_SERIAL','emulator-5554')
def command(*args):
    result=subprocess.run([str(adb),'-s',serial,*map(str,args)],capture_output=True,text=True,timeout=180)
    if result.returncode: raise SystemExit('Dedicated Android release test command failed')
    return result.stdout
if command('shell','getprop','ro.boot.qemu.avd_name').strip()!='NexonicTraceTest':
    raise SystemExit('Refusing to change a non-test Android device')
expected=json.loads((ROOT/'release/android-signing.json').read_text())['sha256']
apps=list((ROOT/'src-tauri/gen/android/app/build/outputs/apk/x86_64/release').glob('*.apk'))
tests=list((ROOT/'src-tauri/gen/android/app/build/outputs/apk/androidTest/x86_64/release').glob('*.apk'))
if len(apps)!=1 or len(tests)!=1: raise SystemExit('Release app and instrumentation APKs are required')
verify(apps[0],'x86_64',sdk,release=True,certificate=expected)
# Ensure instrumentation has the same app identity even if an AGP version uses
# its default test certificate. This test APK is never published or cached.
tools=sorted((sdk/'build-tools').iterdir(),key=lambda p:tuple(int(x) for x in p.name.split('.') if x.isdigit()))[-1]
signed=Path(os.environ['RUNNER_TEMP'])/'nexonic-release-instrumentation.apk'
result=subprocess.run([tools/'apksigner','sign','--ks',os.environ['NEXONIC_ANDROID_KEYSTORE'],
    '--ks-key-alias',os.environ['ANDROID_KEY_ALIAS'],'--ks-pass','env:ANDROID_KEYSTORE_PASSWORD',
    '--key-pass','env:ANDROID_KEY_PASSWORD','--out',signed,tests[0]],capture_output=True,text=True)
if result.returncode: raise SystemExit('Release instrumentation signing failed')
command('install','-r',apps[0]);command('install','-r','-t',signed)
command('shell','pm','clear','com.nexonic.trace')
output=command('shell','am','instrument','-w','-r','-e','class','com.nexonic.trace.WorkspaceTest',
               'com.nexonic.trace.test/androidx.test.runner.AndroidJUnitRunner')
if not re.search(r'OK \([1-9][0-9]* tests?\)',output) or 'FAILURES!!!' in output or not re.search(r'^INSTRUMENTATION_CODE: -1\s*$', output, re.MULTILINE) or not re.search(r'^INSTRUMENTATION_STATUS_CODE: 0\s*$', output, re.MULTILINE):
    print(output)
    raise SystemExit('Actual signed release UI instrumentation failed')
proof={'passed':True,'testedAbi':command('shell','getprop','ro.product.cpu.abi').strip(),'certificateSha256':expected}
(ROOT/'test-results').mkdir(exist_ok=True)
(ROOT/'test-results/android-release-native.json').write_text(json.dumps(proof)+'\n')
print('Actual non-debuggable release app passed isolated Android UI instrumentation.')
