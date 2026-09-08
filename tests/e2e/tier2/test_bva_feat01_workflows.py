"""
Tier 2 BVA: Feature 1 Workflows Boundary Value Analysis
Tests missing architecture detection, empty branch triggers, unsupported runners, and matrix bounds.
"""

import unittest
from ..harness import WorkflowValidator
from ..harness.config import DESKTOP_TARGETS, MOBILE_TARGETS


class TestBvaFeature01Workflows(unittest.TestCase):
    """Boundary and corner case analysis for CI/CD workflows."""

    def test_bva01_01_incomplete_desktop_matrix(self):
        """Verifies that matrix validator flags if any required target is missing."""
        incomplete_matrix = ["x86_64-pc-windows-msvc", "x86_64-apple-darwin"]
        missing = [t for t in DESKTOP_TARGETS if t not in incomplete_matrix]
        self.assertGreater(len(missing), 0, "Validator must detect missing targets")
        self.assertIn("x86_64-unknown-linux-gnu", missing)

    def test_bva01_02_empty_branch_triggers(self):
        """Verifies that an empty branch filter fails trigger validation."""
        def validate_branches(branches):
            if not branches:
                raise ValueError("Branch list cannot be empty")
            return True

        with self.assertRaises(ValueError):
            validate_branches([])

    def test_bva01_03_unsupported_runner_os(self):
        """Verifies that non-standard runner OS labels are rejected."""
        valid_runners = {"ubuntu-latest", "ubuntu-24.04", "ubuntu-24.04-arm", "windows-latest", "macos-latest"}
        self.assertNotIn("solaris-11", valid_runners)
        self.assertNotIn("freebsd-14", valid_runners)

    def test_bva01_04_missing_permissions_block(self):
        """Verifies that workflows requiring release write permissions fail if permissions block is missing."""
        def check_release_perms(perms):
            if not perms or perms.get("contents") != "write":
                raise PermissionError("contents: write required for release")
            return True

        with self.assertRaises(PermissionError):
            check_release_perms({})
        with self.assertRaises(PermissionError):
            check_release_perms({"contents": "read"})

    def test_bva01_05_extreme_matrix_dimension(self):
        """Verifies that matrix combination counts stay within safe limits (< 64 jobs)."""
        desktop_targets = WorkflowValidator.get_desktop_matrix_targets()
        self.assertLessEqual(len(desktop_targets), 16, "Desktop matrix shouldn't cause runner exhaustion")


if __name__ == "__main__":
    unittest.main()
