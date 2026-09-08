"""
Feature 4: Checksum Generation & Publish (ORIGINAL_REQUEST §R1)
Tests SHA256SUMS generation, release upload automation, and discrete packaging.
"""

import unittest
from pathlib import Path
from ..harness import WorkflowValidator


class TestFeature04Checksums(unittest.TestCase):
    """Verifies that release checksums and release asset uploads are properly automated."""

    def test_feat04_01_checksums_job_depends_on_all_builds(self):
        """Authoritative Source: survey_report.md Observation 6 & Logic Chain 5."""
        rel = WorkflowValidator.get_release_workflow()
        job = rel.get("jobs", {}).get("checksums", {})
        needs = job.get("needs", [])
        self.assertIn("build-release-desktop", needs)
        self.assertIn("build-release-android", needs)
        self.assertIn("build-release-ios", needs)

    def test_feat04_02_sha256sums_generation_command(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 line 25 (SHA256SUMS)."""
        rel = WorkflowValidator.get_release_workflow()
        job = rel.get("jobs", {}).get("checksums", {})
        steps_str = str(job.get("steps", []))
        self.assertIn("sha256sum", steps_str, "checksums job must invoke sha256sum")
        self.assertIn("SHA256SUMS", steps_str, "checksums job must write SHA256SUMS")

    def test_feat04_03_gh_release_upload_invocation(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 line 25 (gh release upload)."""
        rel = WorkflowValidator.get_release_workflow()
        job = rel.get("jobs", {}).get("checksums", {})
        steps_str = str(job.get("steps", []))
        self.assertIn("gh release upload", steps_str, "checksums job must execute gh release upload")

    def test_feat04_04_discrete_desktop_installers_packaged(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 lines 14-17."""
        rel = WorkflowValidator.get_release_workflow()
        desktop_job = rel.get("jobs", {}).get("build-release-desktop", {})
        steps_str = str(desktop_job.get("steps", []))
        self.assertIn(".exe", steps_str, "Desktop packaging must collect .exe")
        self.assertIn(".msi", steps_str, "Desktop packaging must collect .msi")

    def test_feat04_05_mobile_artifacts_uploaded(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 lines 18-20."""
        rel = WorkflowValidator.get_release_workflow()
        android_job = rel.get("jobs", {}).get("build-release-android", {})
        steps_str = str(android_job.get("steps", []))
        self.assertIn(".apk", steps_str, "Android job must package .apk")
        self.assertIn(".aab", steps_str, "Android job must package .aab")


if __name__ == "__main__":
    unittest.main()
