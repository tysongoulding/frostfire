"""
Feature 2: Release-Please & Manifest Sync (ORIGINAL_REQUEST §R1)
Tests automated versioning, release-please manifest, and cross-workspace version synchronization.
"""

import unittest
from pathlib import Path
from ..harness import WorkflowValidator
from ..harness.config import (
    RELEASE_PLEASE_CONFIG_PATH,
    RELEASE_PLEASE_MANIFEST_PATH,
    CARGO_TOML_PATH,
    FROSTFIRE_TOML_PATH,
    PACKAGE_JSON_PATH,
    TAURI_CONF_PATH,
    EXPECTED_BASELINE_VERSION,
)


class TestFeature02ReleasePlease(unittest.TestCase):
    """Verifies that release-please configuration and workspace version manifest are fully aligned."""

    def test_feat02_01_config_json_schema_and_package(self):
        """Authoritative Source: PROJECT.md Feature 1 & survey_report.md."""
        self.assertTrue(
            RELEASE_PLEASE_CONFIG_PATH.exists(),
            ".release-please-config.json must exist in repository root"
        )
        config = WorkflowValidator.load_json(RELEASE_PLEASE_CONFIG_PATH)
        packages = config.get("packages", {})
        self.assertIn(".", packages, "Release-please config must define root package '.'")
        root_pkg = packages["."]
        self.assertEqual(root_pkg.get("release-type"), "simple")

    def test_feat02_02_manifest_json_version(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R1 & PROJECT.md Feature 1."""
        self.assertTrue(
            RELEASE_PLEASE_MANIFEST_PATH.exists(),
            ".release-please-manifest.json must exist in repository root"
        )
        manifest = WorkflowValidator.load_json(RELEASE_PLEASE_MANIFEST_PATH)
        self.assertIn(".", manifest, "Manifest must track root package '.'")
        self.assertEqual(
            manifest["."],
            EXPECTED_BASELINE_VERSION,
            f"Manifest initial version should be {EXPECTED_BASELINE_VERSION}"
        )

    def test_feat02_03_extra_files_targets(self):
        """Authoritative Source: survey_report.md & PROJECT.md Feature 1."""
        config = WorkflowValidator.load_json(RELEASE_PLEASE_CONFIG_PATH)
        extra_files = config.get("packages", {}).get(".", {}).get("extra-files", [])
        paths = [f.get("path") for f in extra_files if "path" in f]

        expected_paths = [
            "Cargo.toml",
            ".frostfire.toml",
            "application/package.json",
            "application/src-tauri/tauri.conf.json",
        ]
        for exp in expected_paths:
            self.assertIn(exp, paths, f"extra-files must target {exp}")

    def test_feat02_04_version_synchronization_across_workspace(self):
        """Authoritative Source: PROJECT.md Feature 6 (Version Alignment to 0.3.0)."""
        cargo = WorkflowValidator.load_toml(CARGO_TOML_PATH)
        cargo_ver = cargo.get("workspace", {}).get("package", {}).get("version")
        self.assertEqual(cargo_ver, EXPECTED_BASELINE_VERSION, "Cargo.toml workspace version mismatch")

        frostfire = WorkflowValidator.load_toml(FROSTFIRE_TOML_PATH)
        ff_ver = frostfire.get("project", {}).get("version")
        self.assertEqual(ff_ver, EXPECTED_BASELINE_VERSION, ".frostfire.toml version mismatch")

        pkg = WorkflowValidator.load_json(PACKAGE_JSON_PATH)
        self.assertEqual(pkg.get("version"), EXPECTED_BASELINE_VERSION, "package.json version mismatch")

        tauri = WorkflowValidator.load_json(TAURI_CONF_PATH)
        self.assertEqual(tauri.get("version"), EXPECTED_BASELINE_VERSION, "tauri.conf.json version mismatch")

    def test_feat02_05_tag_format_and_release_type(self):
        """Authoritative Source: casonadams/rho release workflow pattern."""
        config = WorkflowValidator.load_json(RELEASE_PLEASE_CONFIG_PATH)
        root_pkg = config.get("packages", {}).get(".", {})
        self.assertEqual(root_pkg.get("tag-format"), "v${version}")


if __name__ == "__main__":
    unittest.main()
