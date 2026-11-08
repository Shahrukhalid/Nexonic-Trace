"""Fail-closed regression checks for private key handling and publication."""
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import production


class ProductionInventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name); self.commit='a'*40
        self.pin=json.loads((production.ROOT/'release/android-signing.json').read_text())['sha256']
        for label,names in production.FILES.items():
            assets=[]
            for name in names:
                body=('fixture '+name).encode();(self.root/name).write_bytes(body)
                assets.append({'name':name,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
            checks=dict.fromkeys(['startup','installer','portable','authenticode','timestamped','nativeInstrumentation',
                                   'certificatePinned','notDebuggable','alignment','developerId','notarized','stapled','imageIntegrity'],True)
            checks.update(certificateSha256=self.pin,testedAbi='x86_64',teamId='EXAMPLE',publisher='Fixture Publisher')
            proof={'sourceCommit':self.commit,'version':production.version(),'platform':label,
                   'productionSigned':True,'level':'signed release candidate','verification':checks,'assets':assets}
            (self.root/f'VALIDATION-{label}.json').write_text(json.dumps(proof))

    def change(self, edit):
        path=self.root/'VALIDATION-Android.json';proof=json.loads(path.read_text());edit(proof);path.write_text(json.dumps(proof))

    def test_all_platforms_and_exact_payload_are_required(self):
        self.assertEqual(len(production.validate_inventory(self.root,self.commit).splitlines()),8)
        (self.root/'private.p12').write_bytes(b'fixture')
        with self.assertRaisesRegex(ValueError,'unexpected'):production.validate_inventory(self.root,self.commit)

    def test_android_only_cannot_activate(self):
        for name in production.FILES['Windows-x64']:(self.root/name).unlink()
        with self.assertRaisesRegex(ValueError,'Incomplete'):production.validate_inventory(self.root,self.commit)

    def test_mixed_commit_and_unsigned_evidence_are_rejected(self):
        with self.assertRaisesRegex(ValueError,'source evidence'):production.validate_inventory(self.root,'b'*40)
        self.change(lambda p:p.update(productionSigned=False))
        with self.assertRaisesRegex(ValueError,'source evidence'):production.validate_inventory(self.root,self.commit)

    def test_pinned_certificate_and_release_test_proof_required(self):
        self.change(lambda p:p['verification'].update(certificateSha256='f'*64))
        with self.assertRaisesRegex(ValueError,'certificate identity'):production.validate_inventory(self.root,self.commit)
        self.change(lambda p:p['verification'].update(certificateSha256=self.pin,notDebuggable=False))
        with self.assertRaisesRegex(ValueError,'acceptance evidence'):production.validate_inventory(self.root,self.commit)

    def test_tamper_and_duplicate_records_are_rejected(self):
        file=self.root/production.FILES['Android'][0];original=file.read_bytes();file.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'integrity'):production.validate_inventory(self.root,self.commit)
        file.write_bytes(original)
        self.change(lambda p:p['assets'].append(p['assets'][0]))
        with self.assertRaisesRegex(ValueError,'inventory'):production.validate_inventory(self.root,self.commit)


class MainAcceptanceTests(unittest.TestCase):
    def test_same_commit_tag_cannot_replace_main_evidence(self):
        commit = 'a' * 40
        def api(command, **kwargs):
            endpoint = command[-1]
            if '/workflows/' in endpoint:
                run_id = 1 if '/ci.yml/' in endpoint else 2
                return json.dumps({'workflow_runs': [
                    {'id': 99, 'head_sha': commit, 'head_branch': 'v0.1.0-dev.5', 'event': 'push', 'conclusion': None},
                    {'id': run_id, 'head_sha': commit, 'head_branch': 'main', 'event': 'push', 'conclusion': 'success'},
                ]})
            names = production.REQUIRED[:3] if '/runs/1/' in endpoint else production.REQUIRED[3:]
            return json.dumps({'jobs': [{'name': name, 'conclusion': 'success'} for name in names]})
        with patch('production.run', side_effect=api):
            production.require_main_acceptance(commit)
        with patch('production.run', return_value=json.dumps({'workflow_runs': [
            {'id': 99, 'head_sha': commit, 'head_branch': 'v0.1.0-dev.5', 'event': 'push', 'conclusion': 'success'},
        ]})):
            with self.assertRaisesRegex(ValueError, 'on main'):
                production.require_main_acceptance(commit)


class SigningMaterialTests(unittest.TestCase):
    def test_missing_credentials_fail_before_creating_files(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'RUNNER_TEMP':directory,'GITHUB_ENV':str(Path(directory)/'environment')},clear=True):
            with self.assertRaisesRegex(ValueError,'Required protected settings'):production.stage('android')
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_failed_staging_can_clean_only_its_own_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=root/'environment'
            settings={'RUNNER_TEMP':directory,'GITHUB_ENV':str(env),'ANDROID_KEYSTORE_BASE64':'invalid!',
                      'ANDROID_KEYSTORE_PASSWORD':'fixture','ANDROID_KEY_ALIAS':'fixture','ANDROID_KEY_PASSWORD':'fixture',
                      'ANDROID_SIGNING_CERT_SHA256':'fixture'}
            with patch.dict(os.environ,settings,clear=True):
                with self.assertRaisesRegex(ValueError,'Invalid encoded'):production.stage('android')
                owned=next(root.glob('nexonic-signing-*'))
                self.assertIn(str(owned),env.read_text())
                with patch.dict(os.environ,{'NEXONIC_SIGNING_DIR':str(root)}):
                    with self.assertRaisesRegex(ValueError,'unrelated'):production.cleanup()
                self.assertTrue(root.exists())
                with patch.dict(os.environ,{'NEXONIC_SIGNING_DIR':str(owned)}):production.cleanup()
                self.assertFalse(owned.exists())

    def test_production_stays_locked_and_branch_candidates_are_rejected(self):
        with patch.dict(os.environ,{'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/feature','PUBLISH_REQUESTED':'false'},clear=True):
            with self.assertRaisesRegex(ValueError,'protected main'):production.policy()
        with patch.dict(os.environ,{'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main','PUBLISH_REQUESTED':'true','PRODUCTION_RELEASES_ENABLED':'false'},clear=True):
            with self.assertRaisesRegex(ValueError,'locked'):production.policy()

    def test_manual_publication_cannot_use_a_different_tag_commit(self):
        def fake_run(command,**kwargs):
            if command==['git','rev-parse','HEAD']:return 'a'*40+'\n'
            if command[0:2]==['git','rev-parse']:return 'b'*40+'\n'
            return ''
        with patch.dict(os.environ,{'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main','PUBLISH_REQUESTED':'true','PRODUCTION_RELEASES_ENABLED':'true'},clear=True),patch('production.run',side_effect=fake_run):
            with self.assertRaisesRegex(ValueError,'different source commit'):production.policy()


if __name__=='__main__':unittest.main()
