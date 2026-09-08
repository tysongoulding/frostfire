"""
GitHub Actions workflow parser and configuration validator.
Validates Requirements R1 multi-platform Tauri 2 CI/CD release pipeline definitions.
"""

from pathlib import Path
from typing import Dict, Any, List, Optional
import yaml
import json
import tomllib
from .config import (
    CI_WORKFLOW_PATH,
    RELEASE_WORKFLOW_PATH,
    DESKTOP_TARGETS,
    MOBILE_TARGETS,
    LINUX_SYS_DEPENDENCIES,
)


class WorkflowValidator:
    """Parses and validates CI/CD workflows and release configurations."""

    @staticmethod
    def load_yaml(file_path: Path) -> Dict[str, Any]:
        if not file_path.exists():
            raise FileNotFoundError(f"Workflow file does not exist: {file_path}")
        with open(file_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)

    @staticmethod
    def load_json(file_path: Path) -> Dict[str, Any]:
        if not file_path.exists():
            raise FileNotFoundError(f"JSON file does not exist: {file_path}")
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def load_toml(file_path: Path) -> Dict[str, Any]:
        if not file_path.exists():
            raise FileNotFoundError(f"TOML file does not exist: {file_path}")
        with open(file_path, "rb") as f:
            return tomllib.load(f)

    @classmethod
    def get_ci_workflow(cls) -> Dict[str, Any]:
        return cls.load_yaml(CI_WORKFLOW_PATH)

    @classmethod
    def get_release_workflow(cls) -> Dict[str, Any]:
        return cls.load_yaml(RELEASE_WORKFLOW_PATH)

    @classmethod
    def get_desktop_matrix_targets(cls) -> List[str]:
        rel = cls.get_release_workflow()
        job = rel.get("jobs", {}).get("build-release-desktop", {})
        strategy = job.get("strategy", {})
        matrix = strategy.get("matrix", {})
        include = matrix.get("include", [])
        if include:
            return [item.get("target") for item in include if "target" in item]
        return matrix.get("target", [])

    @classmethod
    def get_android_matrix_targets(cls) -> List[str]:
        rel = cls.get_release_workflow()
        job = rel.get("jobs", {}).get("build-release-android", {})
        strategy = job.get("strategy", {})
        matrix = strategy.get("matrix", {})
        return matrix.get("target", [])

    @classmethod
    def get_ios_matrix_targets(cls) -> List[str]:
        rel = cls.get_release_workflow()
        job = rel.get("jobs", {}).get("build-release-ios", {})
        strategy = job.get("strategy", {})
        matrix = strategy.get("matrix", {})
        return matrix.get("target", [])
