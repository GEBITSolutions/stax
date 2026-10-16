#!/usr/bin/env python3
"""Behavior tests for pin_shared_workflow_refs."""

from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

_ACTION_DIRECTORY = Path(__file__).parent
_SPEC = importlib.util.spec_from_file_location(
    "pin_shared_workflow_refs", _ACTION_DIRECTORY / "pin_shared_workflow_refs.py"
)
assert _SPEC is not None
assert _SPEC.loader is not None
pin_shared_workflow_refs = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = pin_shared_workflow_refs
_SPEC.loader.exec_module(pin_shared_workflow_refs)

CONFIGURATION_ERROR = (
    "shared-code-workflow-files-to-pin must be a JSON array of repository-relative "
    ".github/workflows/*.yml or *.yaml paths"
)
CONFIGURATION_ERROR_PATTERN = f"^{re.escape(CONFIGURATION_ERROR)}$"
TARGET_PATH = ".github/workflows/deploy-stbl.yml"
TARGET_PREFIX = "GEBITSolutions/stax/.github/workflows/"


class PinSharedWorkflowRefsTests(unittest.TestCase):
    def write_file(self, root: Path, relative_path: str, content: str) -> Path:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def configured_files(self, *paths: str) -> str:
        return "[" + ",".join(f'"{path}"' for path in paths) + "]"

    def test_pins_two_refs_in_configured_deploy_workflow(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workflow = self.write_file(
                root,
                TARGET_PATH,
                f"""jobs:
  setup:
    uses: {TARGET_PREFIX}a-wf-setup-ci.yml@main
  deploy:
    uses: {TARGET_PREFIX}a-wf-deploy-levels.yml@main
""",
            )

            changed = pin_shared_workflow_refs.pin_workflow_files(
                root, self.configured_files(TARGET_PATH), "2.15.2"
            )

            self.assertEqual(changed, [TARGET_PATH])
            self.assertEqual(workflow.read_text(encoding="utf-8").count("@2.15.2"), 2)

    def test_replaces_quoted_and_unquoted_uses_values(self) -> None:
        content = f"""jobs:
  quoted:
    uses: \"{TARGET_PREFIX}a-wf-setup-ci.yml@main\"
  step:
    steps:
    - uses: '{TARGET_PREFIX}a-wf-deploy-levels.yml@main'
"""

        updated, matched, changed = pin_shared_workflow_refs.replace_shared_workflow_refs(
            content, "v2.15.2-rc.1"
        )

        self.assertEqual(matched, 2)
        self.assertEqual(changed, 2)
        self.assertIn(f'uses: "{TARGET_PREFIX}a-wf-setup-ci.yml@v2.15.2-rc.1"', updated)
        self.assertIn(f"uses: '{TARGET_PREFIX}a-wf-deploy-levels.yml@v2.15.2-rc.1'", updated)

    def test_already_pinned_workflow_is_a_noop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            content = f"uses: {TARGET_PREFIX}a-wf-setup-ci.yml@2.15.2\n"
            workflow = self.write_file(root, TARGET_PATH, content)
            before_mtime = workflow.stat().st_mtime_ns

            changed = pin_shared_workflow_refs.pin_workflow_files(
                root, self.configured_files(TARGET_PATH), "2.15.2"
            )

            self.assertEqual(changed, [])
            self.assertEqual(workflow.read_text(encoding="utf-8"), content)
            self.assertEqual(workflow.stat().st_mtime_ns, before_mtime)

    def test_preserves_comments_actions_other_repositories_and_unlisted_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            configured_content = f"""# uses: {TARGET_PREFIX}commented.yml@main
jobs:
  active:
    uses: {TARGET_PREFIX}a-wf-setup-ci.yml@main # keep this comment
  action:
    uses: GEBITSolutions/stax/.github/actions/example@main
  other:
    uses: example/other/.github/workflows/example.yml@main
  script:
    run: |2
      uses: {TARGET_PREFIX}literal.yml@main
  folded-script:
    run: >2-
      uses: {TARGET_PREFIX}folded-literal.yml@main
  reversed-indicator-script:
    run: |-2
      uses: {TARGET_PREFIX}reversed-literal.yml@main
"""
            unlisted_content = f"uses: {TARGET_PREFIX}unlisted.yml@main\n"
            configured = self.write_file(root, TARGET_PATH, configured_content)
            unlisted = self.write_file(root, ".github/workflows/unlisted.yml", unlisted_content)

            changed = pin_shared_workflow_refs.pin_workflow_files(
                root, self.configured_files(TARGET_PATH), "2.15.2"
            )

            self.assertEqual(changed, [TARGET_PATH])
            updated = configured.read_text(encoding="utf-8")
            self.assertIn(f"a-wf-setup-ci.yml@2.15.2 # keep this comment", updated)
            self.assertIn(f"# uses: {TARGET_PREFIX}commented.yml@main", updated)
            self.assertIn(".github/actions/example@main", updated)
            self.assertIn("example/other/.github/workflows/example.yml@main", updated)
            self.assertIn(f"uses: {TARGET_PREFIX}literal.yml@main", updated)
            self.assertIn(f"uses: {TARGET_PREFIX}folded-literal.yml@main", updated)
            self.assertIn(f"uses: {TARGET_PREFIX}reversed-literal.yml@main", updated)
            self.assertEqual(unlisted.read_text(encoding="utf-8"), unlisted_content)

    def test_path_list_deduplicates_while_preserving_order(self) -> None:
        result = pin_shared_workflow_refs.parse_workflow_file_list(
            self.configured_files(
                ".github/workflows/second.yml",
                ".github/workflows/first.yaml",
                ".github/workflows/second.yml",
            )
        )

        self.assertEqual(
            result,
            [".github/workflows/second.yml", ".github/workflows/first.yaml"],
        )

    def test_rejects_malformed_or_non_array_file_list(self) -> None:
        for value in ("not json", "{}", "null", '".github/workflows/deploy-stbl.yml"'):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, CONFIGURATION_ERROR_PATTERN):
                    pin_shared_workflow_refs.parse_workflow_file_list(value)

    def test_rejects_invalid_workflow_paths(self) -> None:
        invalid_paths = (
            "",
            "/.github/workflows/deploy.yml",
            ".github\\workflows\\deploy.yml",
            "./.github/workflows/deploy.yml",
            ".github/workflows/../deploy.yml",
            ".github/workflows/nested/deploy.yml",
            ".github/workflows/deploy.txt",
            ".github/actions/deploy.yml",
        )
        for path in invalid_paths:
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, CONFIGURATION_ERROR_PATTERN):
                    pin_shared_workflow_refs.parse_workflow_file_list(self.configured_files(path))

    def test_rejects_missing_configured_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                ValueError,
                "^Configured workflow file does not exist: .github/workflows/missing.yml$",
            ):
                pin_shared_workflow_refs.pin_workflow_files(
                    Path(directory),
                    self.configured_files(".github/workflows/missing.yml"),
                    "2.15.2",
                )

    def test_rejects_listed_file_without_shared_reusable_workflow_ref(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            content = "uses: actions/checkout@v4\n"
            workflow = self.write_file(root, TARGET_PATH, content)

            with self.assertRaisesRegex(
                ValueError,
                "^Configured workflow file contains no stax reusable "
                "workflow references: .github/workflows/deploy-stbl.yml$",
            ):
                pin_shared_workflow_refs.pin_workflow_files(
                    root, self.configured_files(TARGET_PATH), "2.15.2"
                )

            self.assertEqual(workflow.read_text(encoding="utf-8"), content)

    def test_rejects_invalid_version_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            content = f"uses: {TARGET_PREFIX}a-wf-setup-ci.yml@main\n"
            workflow = self.write_file(root, TARGET_PATH, content)
            for version in ("", "2.15.2 release", '"2.15.2"', "2.15.2#tag"):
                with self.subTest(version=version):
                    with self.assertRaisesRegex(ValueError, "^Version must be non-empty"):
                        pin_shared_workflow_refs.replace_shared_workflow_refs(content, version)
                    with self.assertRaisesRegex(ValueError, "^Version must be non-empty"):
                        pin_shared_workflow_refs.pin_workflow_files(
                            root, self.configured_files(TARGET_PATH), version
                        )
                    self.assertEqual(workflow.read_text(encoding="utf-8"), content)

    def test_failure_leaves_all_configured_files_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_content = f"uses: {TARGET_PREFIX}a-wf-setup-ci.yml@main\n"
            second_content = "uses: actions/checkout@v4\n"
            first = self.write_file(root, ".github/workflows/first.yml", first_content)
            second = self.write_file(root, ".github/workflows/second.yml", second_content)

            with self.assertRaisesRegex(
                ValueError,
                "Configured workflow file contains no stax reusable workflow references",
            ):
                pin_shared_workflow_refs.pin_workflow_files(
                    root,
                    self.configured_files(
                        ".github/workflows/first.yml", ".github/workflows/second.yml"
                    ),
                    "2.15.2",
                )

            self.assertEqual(first.read_text(encoding="utf-8"), first_content)
            self.assertEqual(second.read_text(encoding="utf-8"), second_content)

    def test_cli_reports_changed_files_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = self.write_file(
                root,
                TARGET_PATH,
                f"""jobs:
  setup:
    uses: {TARGET_PREFIX}a-wf-setup-ci.yml@main
  deploy:
    uses: {TARGET_PREFIX}a-wf-deploy-levels.yml@main
  action:
    uses: GEBITSolutions/stax/.github/actions/example@main
""",
            )
            unlisted_content = f"uses: {TARGET_PREFIX}unlisted.yml@main\n"
            unlisted = self.write_file(root, ".github/workflows/unlisted.yml", unlisted_content)
            github_output = root / "github-output"
            arguments = [
                "--root",
                str(root),
                "--workflow-files-json",
                self.configured_files(TARGET_PATH),
                "--version",
                "2.15.2",
                "--github-output",
                str(github_output),
            ]

            self.assertEqual(pin_shared_workflow_refs.main(arguments), 0)
            updated_content = target.read_text(encoding="utf-8")
            self.assertEqual(updated_content.count("@2.15.2"), 2)
            self.assertIn(".github/actions/example@main", updated_content)
            self.assertEqual(unlisted.read_text(encoding="utf-8"), unlisted_content)
            self.assertEqual(
                github_output.read_text(encoding="utf-8"),
                f"changed-files-json=[\"{TARGET_PATH}\"]\n",
            )

            before_mtime = target.stat().st_mtime_ns
            before_content = target.read_text(encoding="utf-8")
            github_output.write_text("", encoding="utf-8")
            self.assertEqual(pin_shared_workflow_refs.main(arguments), 0)
            self.assertEqual(github_output.read_text(encoding="utf-8"), "changed-files-json=[]\n")
            self.assertEqual(target.read_text(encoding="utf-8"), before_content)
            self.assertEqual(target.stat().st_mtime_ns, before_mtime)


if __name__ == "__main__":
    unittest.main()
