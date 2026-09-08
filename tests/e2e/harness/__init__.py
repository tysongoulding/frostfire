"""
Frostfire E2E Test Harness
Exports contracts, configuration, engines, and verifiers for opaque-box E2E testing.
"""

from .config import WORKSPACE_ROOT, CI_WORKFLOW_PATH, RELEASE_WORKFLOW_PATH, PROTO_TUNNEL_PATH
from .contracts import (
    AgentSessionConfig,
    TeamRuntimeConfig,
    RoutineJob,
    ULID,
    ProtobufContracts,
)
from .allocator import DisplaySlotAllocator
from .cdp_simulator import CDPCookie, CDPCookieSync
from .cron_engine import CronParser, RoutineStore
from .reaper_engine import StaleLockCleaner, CrashLoopWatchdog, PortReaper
from .crypto_bridge import InvertedWebAuthnBroker, WebAuthnCeremonyRequest, WebAuthnCeremonyResponse
from .workflow_parser import WorkflowValidator

__all__ = [
    "WORKSPACE_ROOT",
    "CI_WORKFLOW_PATH",
    "RELEASE_WORKFLOW_PATH",
    "PROTO_TUNNEL_PATH",
    "AgentSessionConfig",
    "TeamRuntimeConfig",
    "RoutineJob",
    "ULID",
    "ProtobufContracts",
    "DisplaySlotAllocator",
    "CDPCookie",
    "CDPCookieSync",
    "CronParser",
    "RoutineStore",
    "StaleLockCleaner",
    "CrashLoopWatchdog",
    "PortReaper",
    "InvertedWebAuthnBroker",
    "WebAuthnCeremonyRequest",
    "WebAuthnCeremonyResponse",
    "WorkflowValidator",
]
