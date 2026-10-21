"""Regression checks for archive discovery and the public latest selection."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from versioned_site import current_latest, fetch_archive, should_be_latest, validate_version


def git(directory: Path, *args: str) -> str:
    return subprocess.run(['git', *args], cwd=directory, check=True,
                          text=True, capture_output=True).stdout.strip()


class ArchiveVersionTests(unittest.TestCase):
    def test_latest_is_numeric_and_an_older_rebuild_cannot_downgrade_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / 'remote.git'
            source = root / 'source'
            git(root, 'init', '--bare', str(remote))
            git(root, 'init', str(source))
            git(source, 'config', 'user.name', 'Archive Test')
            git(source, 'config', 'user.email', 'archive-test@example.invalid')
            git(source, 'remote', 'add', 'origin', str(remote))
            (source / 'versions.json').write_text(json.dumps([
                {'version': '1.10.0', 'title': '1.10.0', 'aliases': ['latest']},
                {'version': '1.9.0', 'title': '1.9.0', 'aliases': []},
            ]), encoding='utf-8')
            git(source, 'add', 'versions.json')
            git(source, 'commit', '-m', 'Archive versions')
            git(source, 'branch', 'gh-pages')
            git(source, 'push', 'origin', 'gh-pages')
            git(source, 'branch', '-D', 'gh-pages')

            self.assertTrue(fetch_archive(source))
            latest = current_latest(source, True)
            self.assertEqual(latest, '1.10.0')
            self.assertFalse(should_be_latest('1.9.0', latest))
            self.assertFalse(should_be_latest('preview', latest))
            self.assertTrue(should_be_latest('1.11.0', latest))
            self.assertTrue(should_be_latest('v2.0.0', latest))
            self.assertFalse(should_be_latest('1.10.0-rc.1', latest))
            self.assertTrue(should_be_latest('1.11.0-rc.1+build.2', latest))
            self.assertFalse(should_be_latest('1.11.0-rc.1', '1.11.0-rc.2'))
            self.assertFalse(should_be_latest('1.11.0-rc.2', '1.11.0'))

    def test_missing_archive_is_first_release_not_a_fetch_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / 'remote.git'
            source = root / 'source'
            git(root, 'init', '--bare', str(remote))
            git(root, 'init', str(source))
            git(source, 'remote', 'add', 'origin', str(remote))
            self.assertFalse(fetch_archive(source))
            self.assertIsNone(current_latest(source, False))
            self.assertTrue(should_be_latest('1.0.0', None))

    def test_version_identifiers_cannot_escape_the_archive(self):
        for invalid in ('latest', 'LATEST', '../1.0.0', '1/2', '1\\2', '.git',
                        '1.0.0\n', 'versions.json', '1..2'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_version(invalid)
        validate_version('preview')
        validate_version('v1.2.3-rc.1')


if __name__ == '__main__':
    unittest.main()
