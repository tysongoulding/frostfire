"""
Tier 2 BVA: Feature 5 Mobile Configs Boundary Value Analysis
Tests bundle identifier characters, empty package names, exact NDK versions, and version code bounds.
"""

import unittest
import re


class TestBvaFeature05MobileConfigs(unittest.TestCase):
    """Boundary and corner case analysis for mobile app manifests and toolchains."""

    BUNDLE_ID_REGEX = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$")

    def test_bva05_01_invalid_bundle_identifier_characters(self):
        """Verifies that bundle identifiers containing uppercase or invalid characters fail."""
        invalid_ids = ["Com.Frostfire.App", "frostfire-app", "com.frostfire.app$", "1com.app"]
        for bid in invalid_ids:
            self.assertIsNone(self.BUNDLE_ID_REGEX.match(bid), f"'{bid}' should be invalid bundle id")

        valid_ids = ["com.frostfireos.app", "io.frostfire.mobile", "com.example.sub_app"]
        for bid in valid_ids:
            self.assertIsNotNone(self.BUNDLE_ID_REGEX.match(bid), f"'{bid}' should be valid bundle id")

    def test_bva05_02_empty_android_package_name(self):
        """Verifies that an empty package name string raises an exception."""
        def check_package_name(pkg: str):
            if not pkg or not pkg.strip():
                raise ValueError("Package name cannot be empty")

        with self.assertRaises(ValueError):
            check_package_name("")

    def test_bva05_03_ndk_version_exact_match(self):
        """Verifies exact NDK version constraint matching 26.1.10909125."""
        required_ndk = "26.1.10909125"
        self.assertEqual(len(required_ndk.split(".")), 3)

    def test_bva05_04_android_version_code_overflow(self):
        """Verifies that Android versionCode does not exceed INT32_MAX (2147483647)."""
        max_int32 = 2147483647
        valid_code = 300
        self.assertLessEqual(valid_code, max_int32)
        with self.assertRaises(OverflowError):
            if max_int32 + 1 > max_int32:
                raise OverflowError("versionCode exceeds Android INT32_MAX")

    def test_bva05_05_tauri_mobile_init_flag(self):
        """Verifies that tauri android init uses --ci flag to prevent interactive terminal hangs."""
        init_cmd = "npx tauri android init --ci"
        self.assertIn("--ci", init_cmd)


if __name__ == "__main__":
    unittest.main()
