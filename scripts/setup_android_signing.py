"""Create an Android release identity without printing or committing private material.

Run on the owner's Mac. Password recovery uses the login Keychain. An encrypted
PKCS#12 backup lives outside the repository, and GitHub receives sealed environment
secrets over stdin. Existing release identities are never overwritten.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Shahrukhalid/Nexonic-Trace'
ENVIRONMENT = 'production-signing'
SERVICE = 'Nexonic Trace Android Release'
ALIAS = 'nexonic-trace-release'


def run(command, *, data=None, env=None):
    result = subprocess.run(command, input=data, capture_output=True, env=env)
    if result.returncode:
        # Certificate tools and credential clients must never dump private input.
        raise RuntimeError(f'{Path(command[0]).name} failed; no private output was logged')
    return result.stdout


def main():
    if platform.system() != 'Darwin':
        raise SystemExit('This setup helper requires the owner\'s macOS login Keychain')
    backup = ROOT.parent/'signing-private'
    if backup.exists() and any(backup.iterdir()):
        raise SystemExit('Signing backup already exists; refusing to rotate or overwrite an identity')
    existing = json.loads(run(['gh','secret','list','--repo',REPO,'--env',ENVIRONMENT,'--json','name']))
    if any(item['name'].startswith('ANDROID_') for item in existing):
        raise SystemExit('Android environment secrets already exist; refusing to overwrite them')
    probe = subprocess.run(['security','find-generic-password','-a',ALIAS,'-s',SERVICE], capture_output=True)
    if probe.returncode == 0:
        raise SystemExit('A signing password already exists in Keychain; refusing to replace it')
    password = secrets.token_urlsafe(48)
    # Interactive input avoids putting the password in command-line arguments.
    run(['security','-i'], data=f'add-generic-password -a "{ALIAS}" -s "{SERVICE}" -w "{password}"\n'.encode())
    recovered = run(['security','find-generic-password','-a',ALIAS,'-s',SERVICE,'-w']).decode().strip()
    if recovered != password:
        raise SystemExit('Keychain recovery verification failed; no signing key was generated')
    os.umask(0o077)
    backup.mkdir(mode=0o700, exist_ok=True)
    os.chmod(backup,0o700)
    keyfile=backup/'Nexonic-Trace-Android-Release.p12'
    java=os.environ.get('JAVA_HOME')
    keytool=str(Path(java)/'bin/keytool') if java else shutil.which('keytool')
    environment=dict(os.environ, NEXONIC_NEW_SIGNING_PASSWORD=password)
    base=[keytool,'-keystore',str(keyfile),'-storetype','PKCS12','-storepass:env','NEXONIC_NEW_SIGNING_PASSWORD']
    run(base+['-genkeypair','-alias',ALIAS,'-keypass:env','NEXONIC_NEW_SIGNING_PASSWORD',
              '-keyalg','RSA','-keysize','3072','-sigalg','SHA256withRSA','-validity','10000',
              '-dname','CN=Nexonic Trace, O=Nexonic Technologies','-noprompt'],env=environment)
    os.chmod(keyfile,0o600)
    certificate=run(base+['-exportcert','-alias',ALIAS],env=environment)
    pem=run(base+['-exportcert','-rfc','-alias',ALIAS],env=environment)
    if b'BEGIN CERTIFICATE' not in pem or b'PRIVATE KEY' in pem:
        raise SystemExit('Invalid public certificate export')
    fingerprint=hashlib.sha256(certificate).hexdigest()
    public=ROOT/'release'
    public.mkdir(exist_ok=True)
    (public/'android-signing-certificate.pem').write_bytes(pem)
    (public/'android-signing.json').write_text(json.dumps({'alias':ALIAS,'sha256':fingerprint,'certificate':'android-signing-certificate.pem','keyType':'RSA-3072','purpose':'Android APK release signing; self-signed app identity'},indent=2)+'\n')
    (backup/'README.txt').write_text('PRIVATE ANDROID RELEASE KEY BACKUP\n\nThis PKCS#12 file is encrypted. Keep an offline backup. Never commit or attach it to a public issue.\nThe password is stored in your macOS login Keychain:\nService: '+SERVICE+'\nAccount: '+ALIAS+'\nUse Keychain Access to recover it and move a recovery copy to your own secure password store. GitHub secrets cannot be read back.\n\nPublic certificate SHA-256: '+fingerprint+'\nGitHub environment: '+ENVIRONMENT+'\n')
    values={'ANDROID_KEYSTORE_BASE64':base64.b64encode(keyfile.read_bytes()).decode(),
            'ANDROID_KEYSTORE_PASSWORD':password,'ANDROID_KEY_PASSWORD':password,'ANDROID_KEY_ALIAS':ALIAS}
    for name,value in values.items():
        run(['gh','secret','set',name,'--repo',REPO,'--env',ENVIRONMENT],data=value.encode())
        print(f'Protected environment secret configured: {name}')
    run(['gh','variable','set','ANDROID_SIGNING_CERT_SHA256','--repo',REPO,'--env',ENVIRONMENT,'--body',fingerprint])
    print('Android release identity created. Private backup: '+str(keyfile))
    print('Public certificate SHA-256: '+fingerprint)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error))
