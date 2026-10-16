#!/usr/bin/env python3
"""Pin selected shared reusable-workflow references to a release tag."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Sequence

CONFIGURATION_ERROR = (
    "shared-code-workflow-files-to-pin must be a JSON array of repository-relative "
    ".github/workflows/*.yml or *.yaml paths"
)
_VERSION_ERROR = "Version must be non-empty and must not contain whitespace, quotes, or #."
_WORKFLOWS_DIRECTORY = PurePosixPath(".github/workflows")
_SHARED_WORKFLOW_PREFIX = (
    "GEBITSolutions/stax/.github/workflows/"
)
_SHARED_WORKFLOW_RE = re.compile(
    r"^(?P<prefix>[ \t]*(?:-[ \t]+)?uses:[ \t]+)"
    r"(?:"
    r"(?P<quote>['\"])(?P<quoted_target>"
    + re.escape(_SHARED_WORKFLOW_PREFIX)
    + r"[^@\s\"'#]+@)(?P<quoted_ref>[^\s\"'#]+)(?P=quote)"
    r"|(?P<target>"
    + re.escape(_SHARED_WORKFLOW_PREFIX)
    + r"[^@\s\"'#]+@)(?P<ref>[^\s\"'#]+)"
    r")"
    r"(?P<suffix>[ \t]*(?:#[^\r\n]*)?)$",
    re.MULTILINE,
)
_BLOCK_SCALAR_START_RE = re.compile(
    r"^[ \t]*[^#\r\n]+:[ \t]*[>|](?:[+-]|[1-9][+-]?|[+-][1-9])?[ \t]*(?:#.*)?$"
)


def parse_workflow_file_list(raw: str) -> list[str]:
    """Validate and normalize the configured workflow path list."""
    try:
        values = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError(CONFIGURATION_ERROR) from error

    if not isinstance(values, list):
        raise ValueError(CONFIGURATION_ERROR)

    paths: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value or "\\" in value:
            raise ValueError(CONFIGURATION_ERROR)

        raw_segments = value.split("/")
        if "." in raw_segments or ".." in raw_segments:
            raise ValueError(CONFIGURATION_ERROR)

        path = PurePosixPath(value)
        if (
            path.is_absolute()
            or path.parent != _WORKFLOWS_DIRECTORY
            or path.suffix not in {".yml", ".yaml"}
        ):
            raise ValueError(CONFIGURATION_ERROR)

        normalized = path.as_posix()
        if normalized not in seen:
            seen.add(normalized)
            paths.append(normalized)

    return paths


def _block_scalar_indent(line: str) -> int | None:
    if not _BLOCK_SCALAR_START_RE.match(line):
        return None
    return len(line) - len(line.lstrip(" \t"))


def replace_shared_workflow_refs(content: str, version: str) -> tuple[str, int, int]:
    """Replace active shared reusable-workflow refs and return match statistics."""
    _validate_version(version)
    matched = 0
    changed = 0
    block_indent: int | None = None
    updated_lines: list[str] = []

    for line in content.splitlines(keepends=True):
        indent = len(line) - len(line.lstrip(" \t"))
        if block_indent is not None and line.strip() and indent <= block_indent:
            block_indent = None

        if block_indent is None:
            def replace_match(match: re.Match[str]) -> str:
                nonlocal matched, changed
                matched += 1
                ref = match.group("quoted_ref") or match.group("ref")
                if ref == version:
                    return match.group(0)
                changed += 1
                if match.group("quote") is not None:
                    return (
                        f"{match.group('prefix')}{match.group('quote')}"
                        f"{match.group('quoted_target')}{version}{match.group('quote')}"
                        f"{match.group('suffix')}"
                    )
                return f"{match.group('prefix')}{match.group('target')}{version}{match.group('suffix')}"

            line = _SHARED_WORKFLOW_RE.sub(replace_match, line)
            block_indent = _block_scalar_indent(line)

        updated_lines.append(line)

    return "".join(updated_lines), matched, changed


def _validate_version(version: str) -> None:
    if not isinstance(version, str) or not version or re.search(r"[\s\"'#]", version):
        raise ValueError(_VERSION_ERROR)


def pin_workflow_files(root: Path, workflow_files_json: str, version: str) -> list[str]:
    """Pin matching refs in configured files, atomically across the file list."""
    paths = parse_workflow_file_list(workflow_files_json)
    _validate_version(version)
    prepared_changes: list[tuple[Path, str]] = []

    for relative_path in paths:
        workflow_path = root / relative_path
        if not workflow_path.is_file():
            raise ValueError(f"Configured workflow file does not exist: {relative_path}")

        with workflow_path.open("r", encoding="utf-8", newline="") as workflow_file:
            original_content = workflow_file.read()
        updated_content, matched_refs, changed_refs = replace_shared_workflow_refs(
            original_content, version
        )
        if matched_refs == 0:
            raise ValueError(
                "Configured workflow file contains no stax reusable "
                f"workflow references: {relative_path}"
            )
        if changed_refs:
            prepared_changes.append((workflow_path, updated_content))

    for workflow_path, updated_content in prepared_changes:
        with workflow_path.open("w", encoding="utf-8", newline="") as workflow_file:
            workflow_file.write(updated_content)

    return [
        workflow_path.relative_to(root).as_posix()
        for workflow_path, _ in prepared_changes
    ]


def main(argv: Sequence[str] | None = None) -> int:
    """Run the pinning utility and publish its changed file list."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--workflow-files-json", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--github-output", required=True, type=Path)
    arguments = parser.parse_args(argv)

    try:
        changed_files = pin_workflow_files(
            arguments.root, arguments.workflow_files_json, arguments.version
        )
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1

    changed_files_json = json.dumps(changed_files, separators=(",", ":"))
    with arguments.github_output.open("a", encoding="utf-8", newline="") as github_output:
        github_output.write(f"changed-files-json={changed_files_json}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
