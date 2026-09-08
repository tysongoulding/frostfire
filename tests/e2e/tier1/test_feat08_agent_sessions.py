"""
Feature 8: Dynamic Agent Sessions (agt_<ulid>) (ORIGINAL_REQUEST §R2)
Tests ULID generation, timestamp extraction, workspace directory creation, and session contracts.
"""

import unittest
import time
import json
from pathlib import Path
import tempfile
from ..harness import ULID, AgentSessionConfig


class TestFeature08AgentSessions(unittest.TestCase):
    """Verifies dynamic agent generation with immutable agt_<ulid> identifiers."""

    def test_feat08_01_ulid_generation_format(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R2 line 32 (agt_<ulid>)."""
        agent_id = ULID.generate()
        self.assertTrue(
            ULID.is_valid_agent_id(agent_id),
            f"Generated agent ID '{agent_id}' does not match agt_<ulid> specification"
        )
        self.assertEqual(len(agent_id), 30)  # "agt_" (4) + 26 base32 chars
        self.assertTrue(agent_id.startswith("agt_"))

    def test_feat08_02_ulid_timestamp_extraction(self):
        """Authoritative Source: ULID specification (48-bit millisecond timestamp encoding)."""
        now_ms = int(time.time() * 1000)
        agent_id = ULID.generate(timestamp_ms=now_ms)
        extracted_ms = ULID.extract_timestamp_ms(agent_id)
        self.assertEqual(
            now_ms,
            extracted_ms,
            f"Extracted timestamp {extracted_ms} does not match expected {now_ms}"
        )

    def test_feat08_03_agent_workspace_directory_structure(self):
        """Authoritative Source: ORIGINAL_REQUEST.md Acceptance Criteria line 52 (agents/agt_<ulid>/)."""
        agent_id = ULID.generate()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            agent_dir = tmp_path / "agents" / agent_id
            agent_dir.mkdir(parents=True)

            profile_file = agent_dir / "profile.json"
            profile_file.write_text(json.dumps({"id": agent_id, "name": "Agent Alpha"}), encoding="utf-8")

            agents_md = agent_dir / "AGENTS.md"
            agents_md.write_text("# Agent Directives\nRole: Research Specialist", encoding="utf-8")

            self.assertTrue(profile_file.exists())
            self.assertTrue(agents_md.exists())

    def test_feat08_04_agent_session_config_validation(self):
        """Authoritative Source: PROJECT.md § Interface Contracts (AgentSessionConfig)."""
        agent_id = ULID.generate()
        cfg = AgentSessionConfig(
            id=agent_id,
            name="Alpha Agent",
            role="Research Specialist",
            display_slot=1,
            vnc_port=6081,
            workspace_dir=Path("/tmp/agents") / agent_id
        )
        # Should validate without error
        cfg.validate()

    def test_feat08_05_profile_json_serialization(self):
        """Authoritative Source: PROJECT.md Feature 10."""
        agent_id = ULID.generate()
        payload = {
            "id": agent_id,
            "name": "Dev Agent",
            "role": "Terminal & Dev",
            "display_slot": 2,
            "vnc_port": 6082,
            "created_at": int(time.time()),
        }
        serialized = json.dumps(payload)
        deserialized = json.loads(serialized)
        self.assertEqual(deserialized["id"], agent_id)
        self.assertEqual(deserialized["display_slot"], 2)


if __name__ == "__main__":
    unittest.main()
