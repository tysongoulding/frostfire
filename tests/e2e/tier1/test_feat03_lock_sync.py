"""
Feature 3: Lock Sync & rust-cache (ORIGINAL_REQUEST §R1)
Tests Cargo.lock synchronization, frontend package-lock.json, and compiler cache integration.
"""

import unittest
from pathlib import Path
from ..harness import WorkflowValidator
from ..harness.config import PACKAGE_LOCK_PATH, CI_WORKFLOW_PATH, RELEASE_WORKFLOW_PATH


class TestFeature03LockSync(unittest.TestCase):
    """Verifies that lockfiles are synchronized and compilation caching is active."""

    def test_feat03_01_package_lock_exists_and_valid(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 & survey_report.md."""
        self.assertTrue(
            PACKAGE_LOCK_PATH.exists(),
            "application/package-lock.json must exist to enable deterministic npm ci"
        )
        data = WorkflowValidator.load_json(PACKAGE_LOCK_PATH)
        self.assertIn("lockfileVersion", data)
        self.assertGreaterEqual(data["lockfileVersion"], 2)

    def test_feat03_02_ci_setup_node_cache_path(self):
        """Authoritative Source: survey_report.md Observation 1."""
        ci = WorkflowValidator.get_ci_workflow()
        frontend_job = ci.get("jobs", {}).get("test-frontend", {})
        steps = frontend_job.get("steps", [])

        node_step = next(
            (s for s in steps if "setup-node" in s.get("uses", "")),
            None
        )
        self.assertIsNotNone(node_step, "ci.yml must have a setup-node step")
        with_block = node_step.get("with", {})
        self.assertEqual(
            with_block.get("cache-dependency-path"),
            "application/package-lock.json",
            "setup-node must cache against application/package-lock.json"
        )

    def test_feat03_03_rust_cache_present_in_workflows(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 line 24 (Swatinem/rust-cache@v2)."""
        ci = WorkflowValidator.get_ci_workflow()
        rel = WorkflowValidator.get_release_workflow()

        self.assertIn("Swatinem/rust-cache@v2", str(ci), "ci.yml must utilize Swatinem/rust-cache@v2")
        self.assertIn("Swatinem/rust-cache@v2", str(rel), "release.yml must utilize Swatinem/rust-cache@v2")

    def test_feat03_04_update_workspace_job_logic(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 line 23 (update-workspace job)."""
        rel = WorkflowValidator.get_release_workflow()
        jobs = rel.get("jobs", {})
        self.assertIn("update-workspace", jobs, "release.yml must contain update-workspace job")
        job = jobs["update-workspace"]
        self.assertEqual(job.get("needs"), "release-please")
        steps_str = str(job.get("steps", []))
        self.assertIn("Cargo.lock", steps_str, "update-workspace must sync Cargo.lock")

    def test_feat03_05_sync_lock_post_release_job(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 line 23 (sync-lock job)."""
        rel = WorkflowValidator.get_release_workflow()
        jobs = rel.get("jobs", {})
        self.assertIn("sync-lock", jobs, "release.yml must contain sync-lock job")
        job = jobs["sync-lock"]
        steps_str = str(job.get("steps", []))
        self.assertIn("git commit -m", steps_str, "sync-lock must commit updated Cargo.lock")


if __name__ == "__main__":
    unittest.main()
