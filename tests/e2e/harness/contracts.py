"""
Data contracts, schema models, and protocol buffer AST checkers.
Derived from PROJECT.md, ORIGINAL_REQUEST.md, and crates/frostfire-proto/proto/tunnel.proto.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict, Any
import time
import os
import re

# Crockford Base32 alphabet (excludes I, L, O, U to avoid visual ambiguity)
CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_REGEX = re.compile(r"^agt_([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26})$")


@dataclass
class AgentSessionConfig:
    id: str
    name: str
    role: str
    display_slot: int
    vnc_port: int
    workspace_dir: Path

    def validate(self) -> None:
        if not ULID.is_valid_agent_id(self.id):
            raise ValueError(f"Invalid agent ID format: {self.id}")
        if self.display_slot < 1:
            raise ValueError(f"Display slot must be >= 1, got {self.display_slot}")
        if self.vnc_port != 6080 + self.display_slot:
            raise ValueError(
                f"VNC port must be 6080 + slot ({6080 + self.display_slot}), got {self.vnc_port}"
            )


@dataclass
class TeamRuntimeConfig:
    team_id: str
    name: str
    display_slot_base: int
    member_agent_ids: List[str] = field(default_factory=list)
    shared_session_dir: Optional[Path] = None

    def validate(self) -> None:
        if not self.team_id or not self.name:
            raise ValueError("Team ID and name must be non-empty")
        if self.display_slot_base < 1:
            raise ValueError(f"Display slot base must be >= 1, got {self.display_slot_base}")
        for aid in self.member_agent_ids:
            if not ULID.is_valid_agent_id(aid):
                raise ValueError(f"Invalid member agent ID: {aid}")


@dataclass
class RoutineJob:
    id: str
    name: str
    cron_expr: str
    action_payload: str
    last_run_at: Optional[int] = None
    next_run_at: Optional[int] = None
    enabled: bool = True

    def validate(self) -> None:
        if not self.id or not self.name:
            raise ValueError("Routine ID and name must be non-empty")
        if not self.cron_expr:
            raise ValueError("Cron expression must be non-empty")


class ULID:
    """Authoritative ULID generator and parser for agt_<ulid> agent identifiers."""

    @staticmethod
    def generate(timestamp_ms: Optional[int] = None) -> str:
        if timestamp_ms is None:
            timestamp_ms = int(time.time() * 1000)

        # 48-bit timestamp encoded into 10 Crockford Base32 characters
        time_chars = []
        t = timestamp_ms
        for _ in range(10):
            time_chars.append(CROCKFORD_BASE32[t % 32])
            t //= 32
        time_chars.reverse()
        time_part = "".join(time_chars)

        # 80 bits of cryptographic randomness encoded into 16 Crockford Base32 characters
        rand_bytes = os.urandom(10)
        rand_int = int.from_bytes(rand_bytes, byteorder="big")
        rand_chars = []
        for _ in range(16):
            rand_chars.append(CROCKFORD_BASE32[rand_int % 32])
            rand_int //= 32
        rand_chars.reverse()
        rand_part = "".join(rand_chars)

        return f"agt_{time_part}{rand_part}"

    @staticmethod
    def is_valid_agent_id(agent_id: str) -> bool:
        if not isinstance(agent_id, str):
            return False
        return bool(ULID_REGEX.match(agent_id))

    @staticmethod
    def extract_timestamp_ms(agent_id: str) -> int:
        match = ULID_REGEX.match(agent_id)
        if not match:
            raise ValueError(f"Invalid agent ID: {agent_id}")
        ulid_str = match.group(1)
        time_str = ulid_str[:10]
        timestamp = 0
        for char in time_str:
            val = CROCKFORD_BASE32.index(char)
            timestamp = timestamp * 32 + val
        return timestamp


class ProtobufContracts:
    """Verifies that tunnel.proto defines the required gRPC service and message contracts."""

    @staticmethod
    def parse_proto(proto_path: Path) -> Dict[str, Any]:
        if not proto_path.exists():
            raise FileNotFoundError(f"Protocol buffer file not found at {proto_path}")
        content = proto_path.read_text(encoding="utf-8")

        # Extract services
        services = re.findall(r"service\s+(\w+)\s*\{([^}]+)\}", content)
        # Extract messages
        messages = re.findall(r"message\s+(\w+)\s*\{([^}]+)\}", content)

        service_dict = {}
        for s_name, s_body in services:
            rpcs = re.findall(r"rpc\s+(\w+)\s*\(([^)]+)\)\s*returns\s*\(([^)]+)\)", s_body)
            service_dict[s_name] = rpcs

        message_names = [m[0] for m in messages]
        return {
            "services": service_dict,
            "messages": message_names,
            "raw": content,
        }
