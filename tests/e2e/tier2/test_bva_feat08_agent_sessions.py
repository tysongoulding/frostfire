"""
Tier 2 BVA: Feature 8 Agent Sessions Boundary Value Analysis
Tests invalid ULID length, forbidden Crockford characters, missing agt_ prefix, path traversal, and epoch limits.
"""

import unittest
from ..harness import ULID


class TestBvaFeature08AgentSessions(unittest.TestCase):
    """Boundary and corner case analysis for dynamic agent session IDs."""

    def test_bva08_01_invalid_ulid_length(self):
        """Verifies that ULID strings shorter or longer than 26 characters are rejected."""
        short_id = "agt_01ARZ3NDEKTSV4RRFFQ69G5FA"    # 25 chars
        long_id = "agt_01ARZ3NDEKTSV4RRFFQ69G5FAVV"  # 27 chars
        self.assertFalse(ULID.is_valid_agent_id(short_id))
        self.assertFalse(ULID.is_valid_agent_id(long_id))

    def test_bva08_02_forbidden_crockford_characters(self):
        """Verifies that Crockford base32 forbidden characters (I, L, O, U) are rejected."""
        forbidden_ids = [
            "agt_01ARZ3NDEKTSV4RRFFQ69G5FAI",  # Contains 'I'
            "agt_01ARZ3NDEKTSV4RRFFQ69G5FAL",  # Contains 'L'
            "agt_01ARZ3NDEKTSV4RRFFQ69G5FAO",  # Contains 'O'
            "agt_01ARZ3NDEKTSV4RRFFQ69G5FAU",  # Contains 'U'
        ]
        for fid in forbidden_ids:
            self.assertFalse(ULID.is_valid_agent_id(fid), f"ID '{fid}' with forbidden char should fail")

    def test_bva08_03_missing_agt_prefix(self):
        """Verifies that identifiers lacking the 'agt_' prefix are rejected."""
        raw_ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        wrong_prefix = "usr_01ARZ3NDEKTSV4RRFFQ69G5FAV"
        self.assertFalse(ULID.is_valid_agent_id(raw_ulid))
        self.assertFalse(ULID.is_valid_agent_id(wrong_prefix))

    def test_bva08_04_path_traversal_in_agent_id(self):
        """Verifies that directory traversal payloads in agent IDs fail validation."""
        traversal_ids = [
            "agt_../../../etc/passwd",
            "agt_..\\..\\windows\\system32",
            "agt_01ARZ3NDEKTSV4/../../root",
        ]
        for tid in traversal_ids:
            self.assertFalse(ULID.is_valid_agent_id(tid), f"Traversal ID '{tid}' must be rejected")

    def test_bva08_05_max_timestamp_boundary(self):
        """Verifies ULID 48-bit timestamp boundary (up to 281474976710655 ms / year 10889)."""
        max_ts_ms = 281474976710655
        agent_id = ULID.generate(timestamp_ms=max_ts_ms)
        self.assertTrue(ULID.is_valid_agent_id(agent_id))
        extracted = ULID.extract_timestamp_ms(agent_id)
        self.assertEqual(extracted, max_ts_ms)


if __name__ == "__main__":
    unittest.main()
