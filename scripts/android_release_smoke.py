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
harness = ROOT/'src-tauri/gen/android/releaseAcceptance/build/outputs/apk'
tests = list((harness/'androidTest/debug').glob('*.apk'))
hosts = list((harness/'debug').glob('*.apk'))
if len(apps) != 1 or len(tests) != 1 or len(hosts) != 1:
    raise SystemExit('Release app and standalone acceptance APKs are required')
verify(apps[0], 'x86_64', sdk, release=True, certificate=expected)
command('install', '-r', apps[0])
command('install', '-r', hosts[0])
command('install', '-r', '-t', tests[0])
command('shell','pm','clear','com.nexonic.trace')
output=command('shell','am','instrument','-w','-r','-e','class','com.nexonic.trace.WorkspaceTest',
               'com.nexonic.trace.acceptance.test/androidx.test.runner.AndroidJUnitRunner')
summary_passed = re.search(r'OK \([1-9][0-9]* tests?\)', output)
session_passed = re.search(r'^INSTRUMENTATION_CODE: -1\s*$', output, re.MULTILINE)
test_passed = re.search(r'^INSTRUMENTATION_STATUS_CODE: 0\s*$', output, re.MULTILINE)
if not (summary_passed and session_passed and test_passed) or 'FAILURES!!!' in output:
    print(output)
    raise SystemExit('Actual signed release UI instrumentation failed')
proof={'passed':True,'testedAbi':command('shell','getprop','ro.product.cpu.abi').strip(),'certificateSha256':expected}
(ROOT/'test-results').mkdir(exist_ok=True)
(ROOT/'test-results/android-release-native.json').write_text(json.dumps(proof)+'\n')
print('Actual non-debuggable release app passed isolated Android UI instrumentation.')
