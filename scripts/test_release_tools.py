"""Regression coverage for package notices and bounded disk-image cleanup."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import bundle
import notices
import release_checksums


class PackagingTests(unittest.TestCase):
    def test_cleanup_selects_only_task_images_and_whole_devices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'target/debug/bundle'
            info = {'images': [
                {'image-path': str(root/'macos/temporary.dmg'),
                 'system-entities': [{'dev-entry': '/dev/disk5'}, {'dev-entry': '/dev/disk5s1'}]},
                {'image-path': str(Path(directory)/'personal.dmg'),
                 'system-entities': [{'dev-entry': '/dev/disk6'}]},
                {'system-entities': [{'dev-entry': '/dev/disk7'}]},
            ]}
            self.assertEqual(bundle.owned_dmg_devices(info, root), ['/dev/disk5'])

    def test_cleanup_rejects_symlinks_to_unrelated_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'bundle'
            root.mkdir()
            unrelated = Path(directory)/'other.dmg'
            unrelated.touch()
            try:
                (root/'link.dmg').symlink_to(unrelated)
            except OSError:
                self.skipTest('Creating symlinks requires local Windows privileges')
            info = {'images': [{'image-path': str(root/'link.dmg'),
                                'system-entities': [{'dev-entry': '/dev/disk8'}]}]}
            self.assertEqual(bundle.owned_dmg_devices(info, root), [])

    def test_unicode_build_output_survives_windows_legacy_encoding(self):
        environment = dict(os.environ, PYTHONIOENCODING='cp1252', PYTHONPATH=str(Path(__file__).resolve().parent))
        result = subprocess.run([sys.executable, '-c', "import bundle; bundle.configure_output(); print('\\u2713 package')"],
                                env=environment, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.decode('utf-8').splitlines(), ['\u2713 package'])

    def test_only_transient_errors_are_retried(self):
        self.assertTrue(bundle.transient_failure('hdiutil: Resource busy'))
        self.assertTrue(bundle.transient_failure('failed to download bundler tools'))
        self.assertFalse(bundle.transient_failure('error[E0308]: mismatched types'))

    def test_standard_library_notice_is_required_and_copied_verbatim(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'copyright notices are missing'):
                notices.rust_standard_library_notices(root/'toolchain', root/'out')
            source = root/'toolchain/share/doc/rust/COPYRIGHT-library.html'
            source.parent.mkdir(parents=True)
            source.write_bytes(b'<html>Original upstream copyright and licenses</html>')
            with patch('notices.subprocess.check_output', return_value='rustc test-version\n'):
                record = notices.rust_standard_library_notices(root/'toolchain', root/'out')
            self.assertEqual((root/'out'/record['notices'][0]).read_bytes(), source.read_bytes())
            self.assertNotIn(str(root), str(record))


class ReleaseInventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.commit = 'a' * 40
        for label, names in release_checksums.PLATFORMS.items():
            assets = []
            for name in names:
                data = ('development fixture ' + name).encode()
                (self.root/name).write_bytes(data)
                assets.append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
            record = {'sourceCommit':self.commit,'productionSigned':False,'level':'development test build','assets':assets}
            (self.root/f'VALIDATION-{label}.json').write_text(json.dumps(record))

    def test_complete_set_has_eight_checksums(self):
        self.assertEqual(len(release_checksums.validate_release(self.root, self.commit).splitlines()), 8)

    def test_mixed_commit_cannot_publish(self):
        with self.assertRaisesRegex(ValueError, 'different source commit'):
            release_checksums.validate_release(self.root, 'b' * 40)

    def test_modified_binary_cannot_publish(self):
        (self.root/'NexonicTrace-Android-ARM64-Development.apk').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'integrity failed'):
            release_checksums.validate_release(self.root, self.commit)

    def test_private_or_unexpected_payload_cannot_publish(self):
        (self.root/'trace.db').write_bytes(b'private fixture')
        with self.assertRaisesRegex(ValueError, 'Unexpected release payload'):
            release_checksums.validate_release(self.root, self.commit)

    def test_duplicate_evidence_cannot_publish(self):
        path = self.root/'VALIDATION-Android.json'
        record = json.loads(path.read_text())
        record['assets'].append(record['assets'][0])
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'inventory'):
            release_checksums.validate_release(self.root, self.commit)


if __name__ == '__main__':
    unittest.main()
