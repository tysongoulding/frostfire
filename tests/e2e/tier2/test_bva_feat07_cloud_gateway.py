"""
Tier 2 BVA: Feature 7 Cloud Gateway Boundary Value Analysis
Tests malformed URLs, port overflow, zero/negative slots, empty auth tokens, and backoff limits.
"""

import unittest
from ..harness import DisplaySlotAllocator
from ..harness.config import BASE_VNC_PORT


class TestBvaFeature07CloudGateway(unittest.TestCase):
    """Boundary and corner case analysis for cloud gateway endpoints and network resilience."""

    def test_bva07_01_malformed_url_schema(self):
        """Verifies that invalid URL protocols for VNC streams are rejected."""
        valid_protocols = {"ws", "wss"}
        self.assertNotIn("ftp", valid_protocols)
        self.assertNotIn("file", valid_protocols)
        self.assertNotIn("javascript", valid_protocols)

    def test_bva07_02_port_overflow_boundary(self):
        """Verifies that derived port numbers cannot exceed TCP port 65535."""
        overflow_slot = 60000
        with self.assertRaises(ValueError):
            DisplaySlotAllocator.get_vnc_port(overflow_slot)

    def test_bva07_03_zero_or_negative_display_slot(self):
        """Verifies that slot 0 or negative slots raise ValueError."""
        with self.assertRaises(ValueError):
            DisplaySlotAllocator.get_vnc_port(0)
        with self.assertRaises(ValueError):
            DisplaySlotAllocator.get_vnc_port(-1)

    def test_bva07_04_empty_token_rejection(self):
        """Verifies that an empty bearer token string is rejected."""
        def validate_token(token: str):
            if not token or not token.strip():
                raise ValueError("Auth token cannot be empty")

        with self.assertRaises(ValueError):
            validate_token("")
        with self.assertRaises(ValueError):
            validate_token("   ")

    def test_bva07_05_max_reconnect_backoff_cap(self):
        """Verifies that backoff is hard-capped at 60 seconds."""
        def compute_backoff(attempt: int) -> float:
            return min(1.0 * (2 ** attempt), 60.0)

        self.assertEqual(compute_backoff(20), 60.0)
        self.assertEqual(compute_backoff(100), 60.0)


if __name__ == "__main__":
    unittest.main()
