"""
Harness configuration and path management.
Provides authoritative workspace paths, expected constants, and specifications.
"""

from pathlib import Path
import os

# Root directory of the frostfire repository (tests/e2e/harness/config.py -> parents[3])
WORKSPACE_ROOT = Path(__file__).resolve().parents[3]

# Workflow Paths
CI_WORKFLOW_PATH = WORKSPACE_ROOT / ".github" / "workflows" / "ci.yml"
RELEASE_WORKFLOW_PATH = WORKSPACE_ROOT / ".github" / "workflows" / "release.yml"

# Config Paths
RELEASE_PLEASE_CONFIG_PATH = WORKSPACE_ROOT / ".release-please-config.json"
RELEASE_PLEASE_MANIFEST_PATH = WORKSPACE_ROOT / ".release-please-manifest.json"
CARGO_TOML_PATH = WORKSPACE_ROOT / "Cargo.toml"
FROSTFIRE_TOML_PATH = WORKSPACE_ROOT / ".frostfire.toml"
PACKAGE_JSON_PATH = WORKSPACE_ROOT / "application" / "package.json"
PACKAGE_LOCK_PATH = WORKSPACE_ROOT / "application" / "package-lock.json"
TAURI_CONF_PATH = WORKSPACE_ROOT / "application" / "src-tauri" / "tauri.conf.json"
TAURI_ANDROID_CONF_PATH = WORKSPACE_ROOT / "application" / "src-tauri" / "tauri.android.conf.json"
TAURI_IOS_CONF_PATH = WORKSPACE_ROOT / "application" / "src-tauri" / "tauri.ios.conf.json"
TAURI_LIB_RS_PATH = WORKSPACE_ROOT / "application" / "src-tauri" / "src" / "lib.rs"

# Protocol Buffer Contract Path
PROTO_TUNNEL_PATH = WORKSPACE_ROOT / "crates" / "frostfire-proto" / "proto" / "tunnel.proto"

# Authoritative Cloud Gateway & Ports (from ORIGINAL_REQUEST.md & PROJECT.md)
DEFAULT_CLOUD_GATEWAY_HOST = "44.242.94.86"
DEFAULT_EXEC_PORT = 3000
BASE_VNC_PORT = 6080
BASE_RFB_PORT = 5900
EXPECTED_BASELINE_VERSION = "0.3.0"

# Target Architectures from ORIGINAL_REQUEST.md §R1
DESKTOP_TARGETS = [
    "x86_64-pc-windows-msvc",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
]

MOBILE_TARGETS = [
    "aarch64-linux-android",
    "x86_64-linux-android",
    "aarch64-apple-ios",
    "aarch64-apple-ios-sim",
]

# Required Linux system dependencies
LINUX_SYS_DEPENDENCIES = [
    "libwebkit2gtk-4.1-dev",
    "libayatana-appindicator3-dev",
    "librsvg2-dev",
]

# Required Android NDK
EXPECTED_ANDROID_NDK = "26.1.10909125"
