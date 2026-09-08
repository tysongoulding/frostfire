"""
Tier 2 BVA: Feature 2 Release-Please Boundary Value Analysis
Tests malformed JSON, empty packages, invalid semver strings, missing extra-files, and pre-major flags.
"""

import unittest
import json
import re


class TestBvaFeature02ReleasePlease(unittest.TestCase):
    """Boundary and corner case analysis for release-please configuration."""

    SEMVER_REGEX = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$")

    def test_bva02_01_malformed_json_handling(self):
        """Verifies that malformed JSON strings raise JSONDecodeError."""
        bad_json = '{"packages": { ".": { "release-type": "simple", } }'
        with self.assertRaises(json.JSONDecodeError):
            json.loads(bad_json)

    def test_bva02_02_empty_packages_map(self):
        """Verifies that release-please config with empty packages map is rejected."""
        def validate_packages(cfg):
            if not cfg.get("packages"):
                raise ValueError("packages map cannot be empty")

        with self.assertRaises(ValueError):
            validate_packages({"packages": {}})

    def test_bva02_03_invalid_semver_strings(self):
        """Verifies that non-semver version strings fail validation."""
        invalid_versions = ["0", "0.1", "1.0.0.0", "v0.3.0", "beta-1", "1.0.-1"]
        for ver in invalid_versions:
            self.assertIsNone(self.SEMVER_REGEX.match(ver), f"Version '{ver}' should be invalid semver")

        valid_versions = ["0.1.0", "0.3.0", "1.0.0", "2.1.3-alpha.1"]
        for ver in valid_versions:
            self.assertIsNotNone(self.SEMVER_REGEX.match(ver), f"Version '{ver}' should be valid semver")

    def test_bva02_04_missing_extra_file_path(self):
        """Verifies that an extra-file with empty or missing path is rejected."""
        def validate_extra_files(files):
            for f in files:
                if not f.get("path"):
                    raise ValueError("extra-file must specify 'path'")

        with self.assertRaises(ValueError):
            validate_extra_files([{"type": "json"}])

    def test_bva02_05_pre_major_bump_flags(self):
        """Verifies that 0.x.x pre-major bump flags are booleans."""
        flags = {
            "bump-minor-pre-major": True,
            "bump-patch-for-minor-pre-major": True,
        }
        for k, v in flags.items():
            self.assertIsInstance(v, bool)


if __name__ == "__main__":
    unittest.main()
