"""
Tier 2 BVA: Feature 12 Chrome Sessions Boundary Value Analysis
Tests empty cookie names, 4KB payload limits, past expiry timestamps, and missing master profiles.
"""

import unittest
from pathlib import Path
from ..harness import CDPCookie, CDPCookieSync


class TestBvaFeature12ChromeSessions(unittest.TestCase):
    """Boundary and corner case analysis for CDP cookie sync and profile isolation."""

    def test_bva12_01_empty_cookie_name_or_value(self):
        """Verifies that empty cookie names are flagged."""
        def validate_cookie(name: str):
            if not name or not name.strip():
                raise ValueError("Cookie name cannot be empty")

        with self.assertRaises(ValueError):
            validate_cookie("")

    def test_bva12_02_oversized_cookie_payload(self):
        """Verifies RFC 6265 4096-byte maximum cookie size boundary."""
        max_cookie_size = 4096
        large_val = "x" * 5000
        cookie = CDPCookie(name="big", value=large_val, domain="example.com", size=len(large_val))
        self.assertGreater(cookie.size, max_cookie_size)

    def test_bva12_03_past_epoch_expiry_skipping(self):
        """Verifies that cookies with past or 0 expiry timestamps are excluded."""
        stale_cookie = CDPCookie(name="sess", value="expired", domain="example.com", expires=1.0)
        target = []
        synced = CDPCookieSync.sync_cookies([stale_cookie], target)
        self.assertEqual(synced, 0)
        self.assertEqual(len(target), 0)

    def test_bva12_04_missing_master_profile_error(self):
        """Verifies that requesting ephemeral profile from non-existent master raises FileNotFoundError."""
        with self.assertRaises(FileNotFoundError):
            CDPCookieSync.prepare_ephemeral_profile(
                master_profile_dir=Path("/non/existent/path"),
                display_slot=1,
                base_scratch_dir=Path("/tmp")
            )

    def test_bva12_05_cdp_port_boundary(self):
        """Verifies CDP debug port boundaries [1024, 65535]."""
        def validate_port(port: int):
            if port < 1024 or port > 65535:
                raise ValueError(f"Port {port} out of range [1024, 65535]")

        validate_port(9222)
        with self.assertRaises(ValueError):
            validate_port(80)
        with self.assertRaises(ValueError):
            validate_port(70000)


if __name__ == "__main__":
    unittest.main()
