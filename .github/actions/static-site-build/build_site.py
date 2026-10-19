"""Build a site in source_repo/ without changing its checked-in configuration.

Run locally from a directory containing source_repo/ with SOURCE_TYPE,
DOCS_RELATIVE_PATH, APP_LOCATION, and INPUT_SITE_URL environment variables.
GITHUB_OUTPUT is optional outside GitHub Actions.
"""

import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import tomllib


MKDOCS_BUILD = """\
import mkdocs.commands.build
import mkdocs.config
import os
import sys

config = mkdocs.config.load_config(
    config_file=sys.argv[1],
    site_dir=sys.argv[2],
    site_url=os.environ.get('INPUT_SITE_URL') or None,
)
mkdocs.commands.build.build(config)
"""


def relative_path(value: str, name: str) -> Path:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(part == '..' for part in path.parts):
        raise ValueError(f"{name} must be a non-empty relative path without '..': {value!r}")
    if any(char in value for char in ('\\', '\n', '\r', '\0')):
        raise ValueError(f"{name} contains an invalid character: {value!r}")
    return Path(*path.parts)


def inside_source(path: Path, source: Path, name: str) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(source):
        raise ValueError(f"{name} escapes source_repo: {path}")
    return resolved


def required_file(path: Path, source: Path) -> Path:
    inside_source(path, source, str(path))
    if not path.is_file():
        raise ValueError(f"Required file not found: {path}")
    return path


def zensical_config(original: Path, site_dir: Path, site_url: str) -> str:
    """Override scalar project settings in a temporary peer of zensical.toml.

    A peer config is essential: Zensical resolves relative docs/theme paths from
    the config directory. TOML has no override CLI flags for these settings.
    """
    source = original.read_text(encoding='utf-8')
    parsed = tomllib.loads(source)
    if not isinstance(parsed.get('project'), dict):
        raise ValueError(f"Missing [project] in {original}")
    replacements = {'site_dir': os.path.relpath(site_dir, original.parent)}
    if site_url:
        replacements['site_url'] = site_url
    lines = source.splitlines(keepends=True)
    project_header = re.compile(r'^\s*\[project\]\s*(?:#.*)?$')
    scalar = re.compile(r'^\s*(site_dir|site_url)\s*=')
    in_project = False
    found = set()
    insert_at = None
    for index, line in enumerate(lines):
        if project_header.fullmatch(line.rstrip('\r\n')):
            in_project = True
            insert_at = index + 1
            continue
        if line.lstrip().startswith('['):
            in_project = False
        if in_project:
            match = scalar.match(line)
            if match and match.group(1) in replacements:
                key = match.group(1)
                # These fields are scalar TOML strings; refuse unusual expressions
                # rather than accidentally modifying only part of a multiline value.
                if not isinstance(parsed['project'].get(key), str) or not re.fullmatch(
                    r"\s*(?:\"(?:[^\"\\]|\\.)*\"|'[^']*')\s*(?:#.*)?",
                    line[match.end():].rstrip('\r\n'),
                ):
                    raise ValueError(f"Cannot safely override {key} in {original}")
                lines[index] = f'{key} = {json.dumps(replacements[key])}\n'
                found.add(key)
    if insert_at is None:
        raise ValueError(f"Missing [project] in {original}")
    for key, value in replacements.items():
        if key not in found:
            lines.insert(insert_at, f'{key} = {json.dumps(value)}\n')
            insert_at += 1
    return ''.join(lines)


def build_mkdocs(project: Path, source: Path, output: Path, site_url: str) -> None:
    configs = [project / 'mkdocs.yml', project / 'mkdocs.yaml']
    config = next((path for path in configs if path.is_file()), None)
    if config is None:
        raise ValueError(f"No MkDocs config found (mkdocs.yml or mkdocs.yaml) in {project}")
    required_file(config, source)
    requirements = required_file(project / 'requirements.txt', source)
    with tempfile.TemporaryDirectory(prefix='stax-mkdocs-') as temporary:
        python = Path(temporary) / 'venv' / 'bin' / 'python'
        subprocess.run(['uv', 'venv', '--python', sys.executable, str(python.parent.parent)], check=True)
        subprocess.run(['uv', 'pip', 'install', '--python', str(python), '-r', str(requirements)], check=True)
        env = os.environ.copy()
        if site_url:
            env['SITE_URL'] = site_url
        subprocess.run([str(python), '-c', MKDOCS_BUILD, str(config), str(output)], env=env, check=True)


def build_zensical(project: Path, source: Path, output: Path, site_url: str) -> None:
    original = required_file(project / 'zensical.toml', source)
    required_file(project / 'pyproject.toml', source)
    required_file(project / 'uv.lock', source)
    override = zensical_config(original, output, site_url)
    with tempfile.TemporaryDirectory(prefix='stax-zensical-') as temporary:
        env = os.environ.copy()
        env['UV_PROJECT_ENVIRONMENT'] = str(Path(temporary) / 'venv')
        # Keep the config beside the original so relative paths retain their meaning.
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', prefix='.stax-zensical-', suffix='.toml', dir=project, delete=False) as file:
            config = Path(file.name)
            file.write(override)
        try:
            subprocess.run(['uv', 'sync', '--locked', '--project', str(project)], env=env, check=True)
            subprocess.run(['uv', 'run', '--locked', '--project', str(project), 'zensical', 'build', '--config-file', str(config)], cwd=project, env=env, check=True)
        finally:
            config.unlink()


def main() -> None:
    source_type = os.environ.get('SOURCE_TYPE', 'mkdocs')
    if source_type not in {'mkdocs', 'zensical', 'prebuilt'}:
        raise ValueError(f"Unsupported source-type: {source_type!r}; expected mkdocs, zensical, or prebuilt")
    source = (Path.cwd() / 'source_repo').resolve(strict=True)
    if not source.is_dir():
        raise ValueError('source_repo must be a directory')
    docs_relative = relative_path(os.environ.get('DOCS_RELATIVE_PATH', 'docs'), 'docs-path')
    app_location = os.environ.get('APP_LOCATION', '')
    site_relative = relative_path(app_location, 'app-location') if app_location else docs_relative / 'site'
    project = inside_source(source / docs_relative, source, 'docs-path')
    output = inside_source(source / site_relative, source, 'app-location')
    if output == source or output == project:
        raise ValueError('Site output must be a separate directory inside source_repo')
    if source_type != 'prebuilt' and not project.is_dir():
        raise ValueError(f"Documentation project directory not found: {project}")
    site_url = os.environ.get('INPUT_SITE_URL', '')
    if source_type == 'mkdocs':
        build_mkdocs(project, source, output, site_url)
    elif source_type == 'zensical':
        build_zensical(project, source, output, site_url)
    if not output.is_dir() or not inside_source(output, source, 'site directory').is_dir():
        raise ValueError(f"Site directory not found: {output}")
    result = f"source_repo/{site_relative.as_posix()}"
    print(f"Site directory: {result}")
    if github_output := os.environ.get('GITHUB_OUTPUT'):
        with open(github_output, 'a', encoding='utf-8') as file:
            file.write(f"site-dir={result}\n")


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, tomllib.TOMLDecodeError) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
