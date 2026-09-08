"""
Feature 12: Chrome Shared Sessions & CDP Cookies (ORIGINAL_REQUEST §R3)
Tests CDP cookie serialization, cross-display session sync, and ephemeral profile directory creation.
"""

import unittest
import tempfile
from pathlib import Path
import time
from ..harness import CDPCookie, CDPCookieSync


class TestFeature12ChromeSessions(unittest.TestCase):
    """Verifies CDP cookie extraction, injection, and per-display profile isolation."""

    def test_feat12_01_cdp_cookie_model_structure(self):
        """Authoritative Source: Chrome DevTools Protocol Network.Cookie contract."""
        cookie = CDPCookie(
            name="auth_token",
            value="sec_val_123",
            domain=".frostfire.cloud",
            path="/",
            httpOnly=True,
            secure=True,
            sameSite="Lax"
        )
        d = cookie.to_cdp_dict()
        self.assertEqual(d["name"], "auth_token")
        self.assertEqual(d["domain"], ".frostfire.cloud")
        self.assertTrue(d["httpOnly"])
        self.assertTrue(d["secure"])

    def test_feat12_02_cdp_cookie_sync_propagation(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R3 line 37 & Acceptance Criteria line 56."""
        source = [
            CDPCookie(name="session_id", value="sess_alpha", domain="github.com"),
            CDPCookie(name="theme", value="dark", domain="github.com"),
        ]
        target = [
            CDPCookie(name="theme", value="light", domain="github.com"),
        ]

        synced = CDPCookieSync.sync_cookies(source, target)
        self.assertEqual(synced, 2)
        # Theme should be updated to "dark", session_id should be added
        target_dict = {(c.name, c.domain): c.value for c in target}
        self.assertEqual(target_dict[("session_id", "github.com")], "sess_alpha")
        self.assertEqual(target_dict[("theme", "github.com")], "dark")

    def test_feat12_03_cookie_expiry_filtering(self):
        """Authoritative Source: RFC 6265 Cookie Expiration semantics."""
        now = time.time()
        expired_cookie = CDPCookie(
            name="old_token",
            value="stale",
            domain="example.com",
            expires=now - 3600  # Expired 1 hour ago
        )
        valid_cookie = CDPCookie(
            name="fresh_token",
            value="active",
            domain="example.com",
            expires=now + 3600  # Valid for 1 hour
        )
        target = []
        synced = CDPCookieSync.sync_cookies([expired_cookie, valid_cookie], target)
        self.assertEqual(synced, 1)
        self.assertEqual(len(target), 1)
        self.assertEqual(target[0].name, "fresh_token")

    def test_feat12_04_ephemeral_profile_directory_isolation(self):
        """Authoritative Source: survey_report.md Observation 2 (SingletonLock avoidance)."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            master = tmp_path / "master_profile"
            master_default = master / "Default" / "Network"
            master_default.mkdir(parents=True)
            (master_default / "Cookies").write_text("COOKIE_DATA_SQLITE", encoding="utf-8")

            # Prepare ephemeral profile for display :1
            ephemeral = CDPCookieSync.prepare_ephemeral_profile(
                master_profile_dir=master,
                display_slot=1,
                base_scratch_dir=tmp_path
            )
            self.assertTrue(ephemeral.exists())
            self.assertTrue((ephemeral / "Default" / "Cookies").exists())
            self.assertEqual(
                (ephemeral / "DISPLAY_SLOT").read_text(encoding="utf-8").strip(),
                "1"
            )

    def test_feat12_05_cdp_jsonrpc_request_formatting(self):
        """Authoritative Source: CDP Network.setCookies specification."""
        cookies = [CDPCookie(name="test", value="1", domain="localhost")]
        req = CDPCookieSync.build_set_cookies_request(cookies)
        self.assertEqual(req["method"], "Network.setCookies")
        self.assertIn("cookies", req["params"])
        self.assertEqual(len(req["params"]["cookies"]), 1)


if __name__ == "__main__":
    unittest.main()
