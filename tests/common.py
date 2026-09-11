"""
Frostfire Cloud E2E Test Suite — Common Utilities & Fixtures
Provides shared path definitions, schema validators, mock builders,
and base test cases for Tiers 1-4 opaque-box testing.
"""

import json
import os
import re
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
import yaml

# Authoritative Repository Root
ROOT_DIR = Path(__file__).resolve().parent.parent

# Key Component Paths
DEPLOY_POC_YAML = ROOT_DIR / "deploy" / "aws" / "poc-host.yaml"
CHECK_IDLE_SH = ROOT_DIR / "scripts" / "check-idle-shutdown.sh"
SETUP_HOST_SH = ROOT_DIR / "scripts" / "setup-host.sh"
DEPLOY_POC_PS1 = ROOT_DIR / "scripts" / "deploy-poc.ps1"
DEPLOY_POC_SH = ROOT_DIR / "scripts" / "deploy-poc.sh"
KERNEL_CONFIG = ROOT_DIR / "kernel" / "kernel.config"
BUILD_KERNEL_SH = ROOT_DIR / "kernel" / "build-kernel.sh"
BUILD_ROOTFS_SH = ROOT_DIR / "rootfs" / "build-rootfs.sh"
HYPERVISOR_DIR = ROOT_DIR / "crates" / "frostfire-hypervisor"
HYPERVISOR_MAIN = HYPERVISOR_DIR / "src" / "main.rs"
HYPERVISOR_CARGO = HYPERVISOR_DIR / "Cargo.toml"
ROOT_CARGO = ROOT_DIR / "Cargo.toml"
ROOT_AGENTS = ROOT_DIR / "AGENTS.md"
BOX_DOCTOR = ROOT_DIR / "usr-local-bin" / "box-doctor"
START_FROSTFIRE_BOX = ROOT_DIR / "usr-local-bin" / "start-frostfire-box"
BOX_CGROUPS_SH = ROOT_DIR / "usr-local-bin" / "box-cgroups.sh"
EXEC_DAEMON_DIR = ROOT_DIR / "exec-daemon"
HOME_BOX_DIR = ROOT_DIR / "home-box"
ETC_POLICIES_DIR = ROOT_DIR / "etc-policies"
USR_SHARE_BG_DIR = ROOT_DIR / "usr-share-backgrounds"
USR_LOCAL_SHARE_DIR = ROOT_DIR / "usr-local-share"


def read_text(path: Path) -> str:
    """Read full text content of a file using UTF-8 encoding."""
    if not path.exists():
        raise FileNotFoundError(f"Required path does not exist: {path}")
    return path.read_text(encoding="utf-8", errors="replace")


def load_cf_yaml(path: Path = DEPLOY_POC_YAML) -> Dict[str, Any]:
    """Parse CloudFormation YAML file handling AWS-specific intrinsic tags."""
    content = read_text(path)
    
    class CloudFormationLoader(yaml.SafeLoader):
        pass

    # Register constructors for AWS CloudFormation intrinsic functions
    for tag in [
        "!Ref", "!Sub", "!GetAtt", "!Join", "!Select", "!Split",
        "!FindInMap", "!Base64", "!GetAZs", "!ImportValue", "!Condition"
    ]:
        yaml.add_constructor(
            tag,
            lambda loader, node: (
                loader.construct_mapping(node)
                if isinstance(node, yaml.MappingNode)
                else (
                    loader.construct_sequence(node)
                    if isinstance(node, yaml.SequenceNode)
                    else loader.construct_scalar(node)
                )
            ),
            Loader=CloudFormationLoader
        )

    return yaml.load(content, Loader=CloudFormationLoader) or {}


def parse_kernel_config(path: Path = KERNEL_CONFIG) -> Dict[str, str]:
    """Parse a Linux kernel .config file into a dictionary of key: value."""
    content = read_text(path)
    config = {}
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            match = re.match(r"^#\s+([A-Za-z0-9_]+)\s+is not set", line)
            if match:
                config[match.group(1)] = "n"
            continue
        if "=" in line:
            key, val = line.split("=", 1)
            config[key.strip()] = val.strip()
    return config


def extract_bash_functions(script_content: str) -> Set[str]:
    """Extract all bash function definitions declared in a script."""
    pattern = re.compile(r"^\s*(?:function\s+)?([a-zA-Z0-9_-]+)\s*\(\)\s*\{", re.MULTILINE)
    return set(pattern.findall(script_content))


class FrostfireTestCase(unittest.TestCase):
    """Base test case providing Frostfire-specific assertion helpers."""

    def assertFileExists(self, path: Path, msg: Optional[str] = None):
        self.assertTrue(path.exists(), msg or f"Expected file to exist: {path}")

    def assertFileNonEmpty(self, path: Path, msg: Optional[str] = None):
        self.assertTrue(path.exists(), msg or f"Expected file to exist: {path}")
        self.assertGreater(path.stat().st_size, 0, msg or f"Expected file to be non-empty: {path}")

    def assertValidJsonFile(self, path: Path) -> Any:
        self.assertFileNonEmpty(path)
        content = read_text(path)
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            self.fail(f"File {path} is not valid JSON: {exc}")

    def assertBashSyntaxValid(self, content: str, script_name: str = "script"):
        """Verify basic bash syntax integrity (matched braces, quotes, control blocks)."""
        open_braces = content.count("{")
        close_braces = content.count("}")
        self.assertEqual(
            open_braces, close_braces,
            f"{script_name}: Unmatched braces: {open_braces} open vs {close_braces} close"
        )
        # Check fi/if matching
        ifs = len(re.findall(r"\bif\b", content))
        fis = len(re.findall(r"\bfi\b", content))
        self.assertEqual(ifs, fis, f"{script_name}: Unmatched if/fi blocks: {ifs} if vs {fis} fi")
