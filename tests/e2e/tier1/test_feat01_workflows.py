"""
Feature 1: Multi-Platform CI/CD Workflows (ORIGINAL_REQUEST §R1)
Tests workflow matrix, runner targets, Linux dependencies, and triggers.
"""

import unittest
from pathlib import Path
from ..harness import WorkflowValidator
from ..harness.config import (
    CI_WORKFLOW_PATH,
    RELEASE_WORKFLOW_PATH,
    DESKTOP_TARGETS,
    MOBILE_TARGETS,
    LINUX_SYS_DEPENDENCIES,
)


class TestFeature01MultiPlatformWorkflows(unittest.TestCase):
    """Verifies that GitHub Actions workflows define the complete multi-platform matrix."""

    def test_feat01_01_release_workflow_triggers_and_permissions(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 lines 12-14."""
        rel = WorkflowValidator.get_release_workflow()
        on_block = rel.get("on") or rel.get(True, {})
        push_block = on_block.get("push", {})
        branches = push_block.get("branches", [])
        self.assertIn("production", branches, "Release workflow must trigger on 'production' branch")
        self.assertIn("main", branches, "Release workflow must trigger on 'main' branch")

        permissions = rel.get("permissions", {})
        self.assertEqual(permissions.get("contents"), "write", "Release workflow must have contents: write")
        self.assertEqual(permissions.get("pull-requests"), "write", "Release workflow must have pull-requests: write")

    def test_feat01_02_desktop_matrix_targets(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 lines 14-17."""
        desktop_targets = WorkflowValidator.get_desktop_matrix_targets()
        for target in DESKTOP_TARGETS:
            self.assertIn(
                target,
                desktop_targets,
                f"Missing desktop matrix target: {target} (required by R1)"
            )

    def test_feat01_03_mobile_matrix_targets(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 lines 18-20."""
        rel = WorkflowValidator.get_release_workflow()
        jobs = rel.get("jobs", {})

        # Android targets
        android_job = jobs.get("build-release-android", {})
        android_steps_str = str(android_job)
        self.assertIn("aarch64-linux-android", android_steps_str, "Android job must target aarch64-linux-android")
        self.assertIn("x86_64-linux-android", android_steps_str, "Android job must target x86_64-linux-android")

        # iOS targets
        ios_job = jobs.get("build-release-ios", {})
        self.assertIn("build-release-ios", jobs, "release.yml must include build-release-ios job")

    def test_feat01_04_linux_system_dependencies(self):
        """Authoritative Source: PROJECT.md Feature 3 & survey_report.md."""
        ci = WorkflowValidator.get_ci_workflow()
        rel = WorkflowValidator.get_release_workflow()

        ci_str = str(ci)
        for dep in LINUX_SYS_DEPENDENCIES:
            self.assertIn(dep, ci_str, f"CI workflow must install Linux dependency: {dep}")

        rel_str = str(rel)
        for dep in LINUX_SYS_DEPENDENCIES:
            self.assertIn(dep, rel_str, f"Release workflow must install Linux dependency: {dep}")

    def test_feat01_05_ci_workflow_rust_and_frontend_matrix(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 & Acceptance Criteria lines 44-48."""
        ci = WorkflowValidator.get_ci_workflow()
        jobs = ci.get("jobs", {})
        self.assertIn("test-rust", jobs, "ci.yml must define test-rust job")
        self.assertIn("test-frontend", jobs, "ci.yml must define test-frontend job")

        rust_job = jobs["test-rust"]
        strategy = rust_job.get("strategy", {})
        matrix = strategy.get("matrix", {})
        os_list = matrix.get("os", [])
        self.assertIn("ubuntu-latest", os_list)
        self.assertIn("windows-latest", os_list)
        self.assertIn("macos-latest", os_list)


if __name__ == "__main__":
    unittest.main()
