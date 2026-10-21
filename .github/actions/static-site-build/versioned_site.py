"""Build a Zensical release into mike's gh-pages archive and export its tree."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

from build_site import required_file, zensical_config


ARCHIVE_BRANCH = 'gh-pages'
VERSION_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._+-]*\Z', re.ASCII)


def command(*args: str, cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True)
    if result.returncode:
        raise ValueError(f'{args[0]} {args[1]} failed: {result.stderr.strip() or result.stdout.strip()}')
    return result


def validate_version(version: str) -> None:
    if (not VERSION_NAME.fullmatch(version) or version in {'.', '..'}
            or version.lower() in {'latest', 'versions.json', 'index.html', '.nojekyll'}
            or version.endswith('.') or '..' in version):
        raise ValueError(f'Invalid documentation version: {version!r}')


def fetch_archive(source: Path) -> bool:
    remote = subprocess.run(
        ['git', 'ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/gh-pages'],
        cwd=source, text=True, capture_output=True,
    )
    if remote.returncode == 2 and not remote.stdout.strip():
        if subprocess.run(['git', 'show-ref', '--verify', '--quiet', 'refs/heads/gh-pages'],
                          cwd=source).returncode == 0:
            raise ValueError('Local gh-pages exists although origin/gh-pages is absent')
        # A missing branch is expected for the first documentation release.
        return False
    if remote.returncode or not re.fullmatch(r'[0-9a-f]{40,64}\trefs/heads/gh-pages\n', remote.stdout):
        raise ValueError(f'Cannot read origin/gh-pages: {remote.stderr.strip() or remote.stdout.strip()}')
    command('git', 'fetch', '--no-tags', 'origin',
            'refs/heads/gh-pages:refs/remotes/origin/gh-pages', cwd=source)
    # mike commits to a local branch via fast-import, without checking it out.
    command('git', 'update-ref', 'refs/heads/gh-pages', 'refs/remotes/origin/gh-pages', cwd=source)
    return True


def current_latest(source: Path, has_archive: bool) -> str | None:
    if not has_archive:
        return None
    versions = json.loads(command('git', 'show', 'gh-pages:versions.json', cwd=source).stdout)
    if not isinstance(versions, list):
        raise ValueError('Invalid versions.json in gh-pages')
    latest = [item['version'] for item in versions if 'latest' in item['aliases']]
    if len(latest) > 1:
        raise ValueError('Multiple versions claim the latest alias')
    return latest[0] if latest else None


def semver_key(version: str) -> tuple | None:
    match = re.fullmatch(
        r'v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)'
        r'(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'
        r'(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\Z', version, re.ASCII,
    )
    if match is None:
        return None
    major, minor, patch = (int(part) for part in match.group(1, 2, 3))
    prerelease = match.group(4)
    if prerelease is None:
        return major, minor, patch, (1,)
    # SemVer: numeric identifiers sort before nonnumeric identifiers, and a
    # shorter prerelease sorts before a longer one with the same prefix.
    identifiers = tuple((0, int(part)) if part.isdecimal() else (1, part)
                        for part in prerelease.split('.'))
    return major, minor, patch, (0, identifiers)


def should_be_latest(version: str, latest: str | None) -> bool:
    if latest is None or latest == version:
        return True
    candidate = semver_key(version)
    if candidate is None:  # A preview never displaces a published release.
        return False
    current = semver_key(latest)
    return current is None or candidate >= current


def export_archive(source: Path, output: Path, temporary: Path) -> None:
    archive = temporary / 'archive.tar'
    with archive.open('wb') as stream:
        subprocess.run(['git', 'archive', '--format=tar', ARCHIVE_BRANCH],
                       cwd=source, stdout=stream, check=True)
    staged = temporary / 'export'
    staged.mkdir()
    with tarfile.open(archive) as contents:
        # Do not export repository internals or follow historical symlinks.
        members = contents.getmembers()
        if any('.git' in Path(member.name).parts or
               not (member.isfile() or member.isdir()) for member in members):
            raise ValueError('gh-pages contains unsupported repository entries')
        contents.extractall(staged, members=members, filter='data')
    if output.exists():
        if not output.is_dir() or output.is_symlink():
            raise ValueError(f'Site output is not a directory: {output}')
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(staged, output)


def build_versioned(project: Path, source: Path, output: Path, site_url: str,
                    version: str, publish: bool) -> None:
    validate_version(version)
    if publish and version == 'preview':
        raise ValueError('Preview documentation cannot be published as a release')
    original = required_file(project / 'zensical.toml', source)
    required_file(project / 'pyproject.toml', source)
    required_file(project / 'uv.lock', source)
    if output.is_relative_to(project) and output != project / 'site':
        raise ValueError('Versioned site output inside the docs project must be docs/site')
    with (tempfile.TemporaryDirectory(prefix='stax-versioned-') as directory,
          tempfile.TemporaryDirectory(prefix='.stax-site-', dir=project) as build_directory):
        temporary = Path(directory)
        env = os.environ.copy()
        env.pop('VIRTUAL_ENV', None)
        env['UV_PROJECT_ENVIRONMENT'] = str(temporary / 'venv')
        # Keep the override next to the source config: docs/assets and CSS stay
        # relative to the project, while site_url remains the site root.
        generated = Path(build_directory)
        override = zensical_config(original, generated, site_url)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8',
                                         prefix='.stax-zensical-', suffix='.toml',
                                         dir=project, delete=False) as file:
            config = Path(file.name)
            file.write(override)
        try:
            command('uv', 'sync', '--locked', '--project', str(project), cwd=project, env=env)
            has_archive = fetch_archive(source)
            latest = current_latest(source, has_archive)
            promote = should_be_latest(version, latest)
            # mike fast-import uses the checkout's local git identity; no global
            # config or checkout of gh-pages is necessary.
            command('git', 'config', '--local', 'user.name', 'github-actions[bot]', cwd=source)
            command('git', 'config', '--local', 'user.email',
                    '41898282+github-actions[bot]@users.noreply.github.com', cwd=source)
            mike = ['uv', 'run', '--locked', '--project', str(project), 'mike']
            args = ['deploy', '--config-file', str(config), '--branch', ARCHIVE_BRANCH,
                    '--alias-type', 'redirect', '--update-aliases']
            args.append(version)
            if promote:
                args.append('latest')
            command(*mike, *args, cwd=project, env=env)
            if promote or latest is not None:
                command(*mike, 'set-default', '--config-file', str(config),
                        '--branch', ARCHIVE_BRANCH, 'latest', cwd=project, env=env)
            export_archive(source, output, temporary)
            if publish:
                command('git', 'push', 'origin', 'refs/heads/gh-pages:refs/heads/gh-pages', cwd=source)
        finally:
            config.unlink()
