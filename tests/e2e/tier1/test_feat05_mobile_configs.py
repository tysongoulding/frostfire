"""
Feature 5: Mobile Configs & Tauri Check (ORIGINAL_REQUEST §R1)
Tests Tauri 2 mobile configuration, Android NDK integration, and mobile Rust entry points.
"""

import unittest
from pathlib import Path
from ..harness import WorkflowValidator
from ..harness.config import (
    TAURI_LIB_RS_PATH,
    TAURI_ANDROID_CONF_PATH,
    TAURI_IOS_CONF_PATH,
    EXPECTED_ANDROID_NDK,
)


class TestFeature05MobileConfigs(unittest.TestCase):
    """Verifies that Tauri 2 mobile settings and Android/iOS toolchain configurations are valid."""

    def test_feat05_01_mobile_entry_point_in_rust_lib(self):
        """Authoritative Source: survey_report.md Observation 8 & PROJECT.md Feature 7."""
        self.assertTrue(TAURI_LIB_RS_PATH.exists(), "src-tauri/src/lib.rs must exist")
        content = TAURI_LIB_RS_PATH.read_text(encoding="utf-8")
        self.assertIn(
            "#[cfg_attr(mobile, tauri::mobile_entry_point)]",
            content,
            "Tauri lib.rs must export mobile_entry_point macro attribute"
        )

    def test_feat05_02_tauri_android_conf_exists_and_valid(self):
        """Authoritative Source: PROJECT.md Feature 7 & survey_report.md."""
        self.assertTrue(
            TAURI_ANDROID_CONF_PATH.exists(),
            "tauri.android.conf.json must exist in application/src-tauri"
        )
        conf = WorkflowValidator.load_json(TAURI_ANDROID_CONF_PATH)
        self.assertIn("identifier", conf, "tauri.android.conf.json must specify bundle identifier")

    def test_feat05_03_tauri_ios_conf_exists_and_valid(self):
        """Authoritative Source: PROJECT.md Feature 7 & survey_report.md."""
        self.assertTrue(
            TAURI_IOS_CONF_PATH.exists(),
            "tauri.ios.conf.json must exist in application/src-tauri"
        )
        conf = WorkflowValidator.load_json(TAURI_IOS_CONF_PATH)
        self.assertIn("identifier", conf, "tauri.ios.conf.json must specify bundle identifier")

    def test_feat05_04_android_ndk_version_configured(self):
        """Authoritative Source: PROJECT.md Feature 4 & survey_report.md Observation 5."""
        rel = WorkflowValidator.get_release_workflow()
        android_job = rel.get("jobs", {}).get("build-release-android", {})
        job_str = str(android_job)
        self.assertIn(
            EXPECTED_ANDROID_NDK,
            job_str,
            f"Android release build must specify NDK {EXPECTED_ANDROID_NDK}"
        )
        self.assertIn(
            "ANDROID_NDK_ROOT",
            job_str,
            "Android release build must export ANDROID_NDK_ROOT environment variable"
        )

    def test_feat05_05_bundle_identifier_format(self):
        """Authoritative Source: Tauri 2 Mobile schema specification."""
        android_conf = WorkflowValidator.load_json(TAURI_ANDROID_CONF_PATH)
        ident = android_conf.get("identifier", "")
        self.assertTrue(
            ident.startswith("com."),
            f"Bundle identifier should follow reverse domain notation, got: {ident}"
        )


if __name__ == "__main__":
    unittest.main()
