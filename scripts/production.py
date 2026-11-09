"""Protected release builds: source policy, key staging and signature verification."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
REPO='Shahrukhalid/Nexonic-Trace'
REQUIRED=['Frontend and responsive UI','Native (windows-latest)','Native (macos-15)',
          'Release policy','Security and licenses','Desktop packages (windows-latest)',
          'Desktop packages (macos-15)','Desktop packages (macos-15-intel)','Android packages and device tests']
FILES={
 'Windows-x64': ['NexonicTrace-Windows-x64-Setup.exe','NexonicTrace-Windows-x64-Portable.zip'],
 'macOS-AppleSilicon': ['NexonicTrace-macOS-AppleSilicon.zip','NexonicTrace-macOS-AppleSilicon.dmg'],
 'macOS-Intel': ['NexonicTrace-macOS-Intel.zip','NexonicTrace-macOS-Intel.dmg'],
 'Android': ['NexonicTrace-Android-ARM64.apk','NexonicTrace-Android-ARM32.apk'],
}


def run(command, *, capture=False, environment=None):
    result=subprocess.run([str(x) for x in command],cwd=ROOT,env=environment,capture_output=capture,text=True)
    if result.returncode:
        raise ValueError(f'{Path(str(command[0])).name} verification failed; private diagnostic output was withheld')
    return result.stdout if capture else ''


def require(*names):
    missing=[name for name in names if not os.environ.get(name,'').strip()]
    if missing:
        raise ValueError('Required protected settings missing: '+', '.join(missing))


def version():
    package=json.loads((ROOT/'package.json').read_text())['version']
    config=json.loads((ROOT/'src-tauri/tauri.conf.json').read_text())['version']
    if package!=config or not re.fullmatch(r'\d+\.\d+\.\d+',package):
        raise ValueError('Package and native production versions must match')
    return package


def policy():
    event=os.environ['GITHUB_EVENT_NAME']
    ref=os.environ['GITHUB_REF']
    publish=event=='push' or os.environ.get('PUBLISH_REQUESTED')=='true'
    if event=='workflow_dispatch' and ref!='refs/heads/main':
        raise ValueError('Signed candidates must run from protected main')
    if event=='push' and ref!='refs/tags/v'+version():
        raise ValueError('Production tag must match the application version exactly')
    if publish and os.environ.get('PRODUCTION_RELEASES_ENABLED')!='true':
        raise ValueError('Production publication is locked until signing and acceptance are completed')
    platform=os.environ.get('SELECTED_PLATFORM','all')
    if platform not in {'all','android','windows','macos'} or (publish and platform!='all'):
        raise ValueError('Public production releases require every platform')
    run(['git','fetch','origin','main'])
    run(['git','merge-base','--is-ancestor','HEAD','origin/main'])
    commit=run(['git','rev-parse','HEAD'],capture=True).strip()
    if publish:
        tag='v'+version()
        run(['git','fetch','origin',f'refs/tags/{tag}:refs/tags/{tag}'])
        if run(['git','rev-parse',f'{tag}^{{commit}}'],capture=True).strip()!=commit:
            raise ValueError('Production tag points to a different source commit')
    require_main_acceptance(commit)
    with open(os.environ['GITHUB_OUTPUT'],'a') as output:
        output.write(f'publish={str(publish).lower()}\nplatform={platform}\nversion={version()}\ncommit={commit}\n')
    print('Protected source, version and acceptance policy passed.')


def require_main_acceptance(commit):
    # Tag and pull request runs can share a commit and job name. Only main's
    # push runs are evidence that the protected source passed on main.
    for workflow, expected in [('ci.yml', REQUIRED[:3]), ('packages.yml', REQUIRED[3:])]:
        endpoint = f'repos/{REPO}/actions/workflows/{workflow}/runs?branch=main&event=push&head_sha={commit}&per_page=30'
        runs = json.loads(run(['gh', 'api', endpoint], capture=True))['workflow_runs']
        main_runs = [item for item in runs if item['head_sha'] == commit
                     and item['head_branch'] == 'main' and item['event'] == 'push']
        latest = max(main_runs, key=lambda item: item['id'], default=None)
        if not latest or latest['conclusion'] != 'success':
            raise ValueError(f'Source acceptance is not successful on main: {workflow}')
        jobs_endpoint = f"repos/{REPO}/actions/runs/{latest['id']}/jobs?filter=latest&per_page=100"
        jobs = json.loads(run(['gh', 'api', jobs_endpoint], capture=True))['jobs']
        for name in expected:
            matches = [job for job in jobs if job['name'] == name]
            if len(matches) != 1 or matches[0]['conclusion'] != 'success':
                raise ValueError(f'Source acceptance is not successful on main: {name}')


def stage(platform):
    require('RUNNER_TEMP','GITHUB_ENV')
    names={'android':['ANDROID_KEYSTORE_BASE64','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD','ANDROID_SIGNING_CERT_SHA256'],
           'macos':['APPLE_CERTIFICATE_BASE64','APPLE_CERTIFICATE_PASSWORD','APPLE_API_PRIVATE_KEY_BASE64','APPLE_API_KEY_ID','APPLE_API_ISSUER','APPLE_TEAM_ID','APPLE_SIGNING_IDENTITY'],
           'windows':['WINDOWS_SIGNING_MODE','WINDOWS_EXPECTED_PUBLISHER']}[platform]
    require(*names)
    if platform=='windows' and os.environ['WINDOWS_SIGNING_MODE'] not in {'pfx','azure'}:
        raise ValueError('Unsupported Windows signing mode')
    if platform=='windows':
        require(*(['WINDOWS_CERTIFICATE_BASE64','WINDOWS_CERTIFICATE_PASSWORD','WINDOWS_CERTIFICATE_THUMBPRINT'] if os.environ['WINDOWS_SIGNING_MODE']=='pfx' else ['AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID','AZURE_SIGNING_ENDPOINT','AZURE_SIGNING_ACCOUNT','AZURE_CERTIFICATE_PROFILE']))
    root=Path(tempfile.mkdtemp(prefix='nexonic-signing-',dir=os.environ['RUNNER_TEMP']))
    os.chmod(root,0o700)
    (root/'.owned-by-nexonic').write_text('v1\n')
    values={'NEXONIC_SIGNING_DIR':str(root)}
    def decode(name,filename):
        try:
            body=base64.b64decode(os.environ[name],validate=True)
        except ValueError:
            raise ValueError('Invalid encoded signing material: '+name)
        if not body or len(body)>1_048_576:
            raise ValueError('Invalid signing material size: '+name)
        path=root/filename
        descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'wb') as stream: stream.write(body)
        return str(path)
    # Record the cleanup directory before decoding so failure cleanup still works.
    with open(os.environ['GITHUB_ENV'],'a') as environment:
        environment.write('NEXONIC_SIGNING_DIR='+str(root)+'\n')
    if platform=='android':
        values['NEXONIC_ANDROID_KEYSTORE']=decode('ANDROID_KEYSTORE_BASE64','android-release.p12')
        expected=json.loads((ROOT/'release/android-signing.json').read_text())['sha256']
        if os.environ['ANDROID_SIGNING_CERT_SHA256']!=expected:
            raise ValueError('Android environment certificate pin differs from the committed identity')
    elif platform=='macos':
        if not os.environ['APPLE_SIGNING_IDENTITY'].startswith('Developer ID Application:'):
            raise ValueError('Production macOS signing requires a Developer ID Application identity')
        values['APPLE_API_KEY_PATH']=decode('APPLE_API_PRIVATE_KEY_BASE64','notary-key.p8')
    elif os.environ['WINDOWS_SIGNING_MODE']=='pfx':
        values['NEXONIC_WINDOWS_PFX']=decode('WINDOWS_CERTIFICATE_BASE64','windows-signing.pfx')
    with open(os.environ['GITHUB_ENV'],'a') as environment:
        for name,value in values.items(): environment.write(f'{name}={value}\n')
    print('Private signing material staged in the isolated runner directory.')


def cleanup():
    raw=os.environ.get('NEXONIC_SIGNING_DIR')
    if not raw: return
    root=Path(raw).resolve()
    parent=Path(os.environ['RUNNER_TEMP']).resolve()
    if root.parent!=parent or not root.name.startswith('nexonic-signing-') or (root/'.owned-by-nexonic').read_text()!='v1\n':
        raise ValueError('Refusing to clean an unrelated signing directory')
    shutil.rmtree(root)


def record(label, verification):
    out=ROOT/'production-assets';out.mkdir(exist_ok=True)
    assets=[]
    for name in FILES[label]:
        path=out/name
        assets.append({'name':name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    result={'sourceCommit':run(['git','rev-parse','HEAD'],capture=True).strip(),'version':version(),
            'level':'signed release candidate','productionSigned':True,'platform':label,
            'verification':verification,'assets':assets}
    (out/f'VALIDATION-{label}.json').write_text(json.dumps(result,indent=2)+'\n')


def macos():
    require('APPLE_TEAM_ID','APPLE_API_KEY_PATH','APPLE_API_KEY_ID','APPLE_API_ISSUER')
    import platform
    label='macOS-'+('AppleSilicon' if platform.machine()=='arm64' else 'Intel')
    app=ROOT/'target/release/bundle/macos/Nexonic Trace.app'
    if not (app/'Contents/Resources/notices/rust-standard-library/COPYRIGHT-library.html').is_file():
        raise ValueError('Application notices missing')
    run(['codesign','--verify','--deep','--strict',app])
    info=subprocess.run(['codesign','-d','--verbose=4',app],capture_output=True,text=True)
    if f'TeamIdentifier={os.environ["APPLE_TEAM_ID"]}' not in info.stderr or 'Authority=Developer ID Application:' not in info.stderr or 'runtime' not in info.stderr:
        raise ValueError('Developer ID, team or hardened runtime verification failed')
    run(['xcrun','stapler','validate',app])
    run(['spctl','--assess','--type','execute','--verbose=4',app])
    run([sys.executable,'scripts/release_smoke.py',app/'Contents/MacOS/nexonic-trace'])
    images=list((ROOT/'target/release/bundle/dmg').glob('*.dmg'))
    if len(images)!=1: raise ValueError('Expected one production disk image')
    image=images[0]
    result=json.loads(run(['xcrun','notarytool','submit',image,'--key',os.environ['APPLE_API_KEY_PATH'],
        '--key-id',os.environ['APPLE_API_KEY_ID'],'--issuer',os.environ['APPLE_API_ISSUER'],'--wait','--timeout','30m','--output-format','json'],capture=True))
    if result.get('status')!='Accepted': raise ValueError('Apple did not accept disk-image notarization')
    run(['xcrun','stapler','staple',image]);run(['xcrun','stapler','validate',image])
    run(['hdiutil','verify',image])
    out=ROOT/'production-assets';out.mkdir(exist_ok=True)
    run(['ditto','-c','-k','--sequesterRsrc','--keepParent',app,out/FILES[label][0]])
    shutil.copyfile(image,out/FILES[label][1])
    record(label,{'startup':True,'developerId':True,'teamId':os.environ['APPLE_TEAM_ID'],'notarized':True,'stapled':True,'imageIntegrity':True})


def windows():
    require('WINDOWS_EXPECTED_PUBLISHER')
    out=ROOT/'production-assets';out.mkdir(exist_ok=True)
    setup=list((ROOT/'target/release/bundle/nsis').glob('*.exe'))
    if len(setup)!=1: raise ValueError('Expected one signed production installer')
    exe=ROOT/'target/release/nexonic-trace.exe'
    for file in [exe,setup[0]]:
        run(['pwsh','-File','scripts/sign_windows.ps1','-Action','Verify','-Path',file])
    with tempfile.TemporaryDirectory(prefix='NexonicTraceAcceptance-') as temporary:
        root=Path(temporary).resolve();installed=root/'Installed'
        run([setup[0],'/S',f'/D={installed}'])
        run(['pwsh','-File','scripts/sign_windows.ps1','-Action','Verify','-Path',installed/exe.name])
        if not (installed/'notices/rust-standard-library/COPYRIGHT-library.html').is_file():
            raise ValueError('Installed production notices missing')
        run([sys.executable,'scripts/release_smoke.py',installed/exe.name])
    shutil.copyfile(setup[0],out/FILES['Windows-x64'][0])
    with tempfile.TemporaryDirectory(prefix='NexonicTraceAcceptance-') as temporary:
        root=Path(temporary).resolve();portable=root/'NexonicTrace';portable.mkdir()
        shutil.copyfile(exe,portable/exe.name)
        shutil.copytree(ROOT/'src-tauri/notices',portable/'notices')
        (portable/'portable.txt').write_text('Ordinary data is stored beside this application. Provider keys stay session-only.\n')
        (portable/'README.txt').write_text('Extract this entire folder to a writable location. Microsoft Edge WebView2 Runtime is required.\n')
        run([sys.executable,'scripts/release_smoke.py',portable/exe.name,'--root',root,'--portable'])
        shutil.rmtree(portable/'NexonicTraceData')
        (root/'.nexonic-release-verification').unlink();(root/'result.json').unlink()
        shutil.make_archive(str(out/FILES['Windows-x64'][1][:-4]),'zip',root)
    record('Windows-x64',{'startup':True,'installer':True,'portable':True,'authenticode':True,'timestamped':True,'publisher':os.environ['WINDOWS_EXPECTED_PUBLISHER']})


def validate_inventory(out, commit):
    expected=set().union(*map(set,FILES.values()))
    allowed=expected|{f'VALIDATION-{label}.json' for label in FILES}
    if {p.name for p in out.iterdir()}!=allowed or any(not p.is_file() for p in out.iterdir()):
        raise ValueError('Incomplete or unexpected production release payload')
    for label,names in FILES.items():
        proof=json.loads((out/f'VALIDATION-{label}.json').read_text())
        if proof.get('sourceCommit')!=commit or proof.get('version')!=version() or proof.get('productionSigned') is not True or proof.get('level')!='signed release candidate':
            raise ValueError('Invalid production signature/source evidence')
        verification=proof['verification']
        if proof.get('platform')!=label:
            raise ValueError('Production platform evidence mismatch')
        if label=='Android' and verification.get('certificateSha256')!=json.loads((ROOT/'release/android-signing.json').read_text())['sha256']:
            raise ValueError('Android certificate identity mismatch')
        if label=='Android' and verification.get('testedAbi')!='x86_64':
            raise ValueError('Android release instrumentation evidence missing')
        if label.startswith('macOS') and not verification.get('teamId'):
            raise ValueError('Apple signing team evidence missing')
        if label=='Windows-x64' and not verification.get('publisher'):
            raise ValueError('Windows publisher evidence missing')
        required={'Windows-x64':['startup','installer','portable','authenticode','timestamped'],
                  'Android':['nativeInstrumentation','certificatePinned','notDebuggable','alignment'],
                  'macOS-AppleSilicon':['startup','developerId','notarized','stapled','imageIntegrity'],
                  'macOS-Intel':['startup','developerId','notarized','stapled','imageIntegrity']}[label]
        if any(verification.get(key) is not True for key in required): raise ValueError('Production acceptance evidence missing')
        if len(proof['assets'])!=2 or {p['name'] for p in proof['assets']}!=set(names): raise ValueError('Production asset inventory mismatch')
        for item in proof['assets']:
            file=out/item['name']
            if file.stat().st_size!=item['bytes'] or hashlib.sha256(file.read_bytes()).hexdigest()!=item['sha256']:
                raise ValueError('Production artifact integrity mismatch')
    return ''.join(f'{hashlib.sha256((out/name).read_bytes()).hexdigest()}  {name}\n' for name in sorted(expected))


def publish_inventory():
    out=ROOT/'production-assets'
    commit=run(['git','rev-parse','HEAD'],capture=True).strip()
    (out/'SHA256SUMS.txt').write_text(validate_inventory(out,commit))
    print('Every production platform signature, acceptance record, source commit and checksum passed.')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['policy','stage','cleanup','macos','windows','inventory'])
    parser.add_argument('--platform',choices=['android','macos','windows'])
    args=parser.parse_args()
    if args.action=='stage': stage(args.platform)
    else: {'policy':policy,'cleanup':cleanup,'macos':macos,'windows':windows,'inventory':publish_inventory}[args.action]()


if __name__=='__main__':
    try: main()
    except (ValueError,OSError,KeyError) as error: raise SystemExit(str(error))
